/**
 * MIPS assembly parser.
 *
 * Consumes lexed tokens and produces a {@link MipsProgram}: a flat instruction
 * list with addresses, resolved labels, a `.data` segment with computed
 * addresses, and a source map connecting instructions back to source lines.
 *
 * Pseudo-instructions (`li`, `move`, `la`, `b`, `not`) are kept as first-class
 * ops (one source line == one instruction) so the visual mapping stays 1:1.
 */

import { groupByLine } from "../lexer/lexer";
import type { Token } from "../lexer/lexer";
import type {
  DataDirective,
  DataEntry,
  Instruction,
  MipsParseError,
  MipsProgram,
  Operand,
  RegisterName,
  SourceMap,
} from "../types";
import { resolveRegisterName } from "../registers";
import { parseInteger } from "../int32";
import { lex } from "../lexer/lexer";

export type ParseResult = {
  program: MipsProgram | null;
  errors: MipsParseError[];
};

const TEXT_BASE = 0x00400000;
const DATA_BASE = 0x10010000;

export function parse(source: string): ParseResult {
  const { tokens, errors: lexErrors } = lex(source);
  const errors: MipsParseError[] = lexErrors.map((e) => ({
    line: e.line,
    column: e.column,
    message: e.message,
    source: sourceForLine(source, e.line),
  }));

  const lines = groupByLine(tokens);

  type Segment = "text" | "data";
  let segment: Segment = "text";

  // Pass 1: collect raw items (labels resolve later once we know addresses).
  type RawInstruction = { op: string; operands: Operand[]; line: number; raw: string };
  type RawData = { label: string | null; directive: DataDirective; line: number };

  const rawInstructions: RawInstruction[] = [];
  const rawData: RawData[] = [];

  // pending labels accumulated before an instruction/data directive on the same or next line
  let pendingTextLabels: string[] = [];
  let pendingDataLabels: string[] = [];

  // Map label -> target (filled on pass 2). Track label order of appearance per segment.
  const textLabelIndices: Record<string, number> = {}; // label -> instruction index
  const dataLabelSizes: { label: string | null; directive: DataDirective; line: number; size: number }[] = [];

  for (const lineTokens of lines) {
    if (lineTokens.length === 0) continue;
    const lineNo = lineTokens[0].line;
    const rawText = sourceForLine(source, lineNo).trim();

    let idx = 0;

    // Leading labels: identifier ':' (possibly several before the real content).
    while (
      idx + 1 < lineTokens.length &&
      lineTokens[idx].type === "identifier" &&
      lineTokens[idx + 1].type === "colon"
    ) {
      const label = lineTokens[idx].value;
      if (segment === "text") pendingTextLabels.push(label);
      else pendingDataLabels.push(label);
      idx += 2;
    }

    const rest = lineTokens.slice(idx);
    if (rest.length === 0) continue; // label-only line

    const first = rest[0];

    if (first.type === "directive") {
      const directive = first.value;
      if (directive === ".data") {
        segment = "data";
        continue;
      }
      if (directive === ".text") {
        segment = "text";
        continue;
      }
      if (directive === ".globl" || directive === ".global" || directive === ".align" || directive === ".extern") {
        // accepted but ignored for the MVP
        continue;
      }

      // data directives
      const parsed = parseDataDirective(directive, rest.slice(1));
      if (parsed.error || !parsed.directive) {
        errors.push({ line: lineNo, column: first.column, message: parsed.error ?? "Invalid data directive", source: rawText });
        continue;
      }
      const directiveValue = parsed.directive;
      const size = dataDirectiveSize(directiveValue);
      const entry: RawData = {
        label: segment === "data" ? takeSingleLabel(pendingDataLabels, errors, lineNo, rawText) : null,
        directive: directiveValue,
        line: lineNo,
      };
      rawData.push(entry);
      dataLabelSizes.push({ label: entry.label, directive: directiveValue, line: lineNo, size });
      pendingDataLabels = [];
      continue;
    }

    if (first.type === "identifier") {
      // instruction
      const op = first.value.toLowerCase();
      const operandTokens = rest.slice(1);
      const operandResult = parseInstructionOperands(op, operandTokens);
      if (operandResult.error || !operandResult.operands) {
        errors.push({ line: lineNo, column: first.column, message: operandResult.error ?? "Invalid operands", source: rawText });
        continue;
      }
      rawInstructions.push({ op, operands: operandResult.operands, line: lineNo, raw: rawText });

      // attach pending text labels to this instruction index
      const instructionIndex = rawInstructions.length - 1;
      for (const label of pendingTextLabels) {
        textLabelIndices[label] = instructionIndex;
      }
      pendingTextLabels = [];
    } else {
      errors.push({
        line: lineNo,
        column: first.column,
        message: `Unexpected ${first.type} "${first.value}"`,
        source: rawText,
      });
    }
  }

  if (errors.length > 0) {
    return { program: null, errors };
  }

  // Build resolved program.
  const instructions: Instruction[] = rawInstructions.map((raw, i) => ({
    id: `inst_${i}`,
    op: raw.op,
    operands: raw.operands,
    sourceLine: raw.line,
    raw: raw.raw,
    address: TEXT_BASE + i * 4,
  }));

  // labels: text labels -> address; data labels -> data address.
  const labels: Record<string, number> = {};
  for (const [label, instructionIndex] of Object.entries(textLabelIndices)) {
    labels[label] = TEXT_BASE + instructionIndex * 4;
  }

  // data entries with addresses
  const dataEntries: DataEntry[] = [];
  let dataCursor = DATA_BASE;
  for (const item of dataLabelSizes) {
    dataCursor = alignFor(dataCursor, item.directive);
    if (item.label) labels[item.label] = dataCursor;
    dataEntries.push({
      label: item.label,
      address: dataCursor,
      directive: item.directive,
      sourceLine: item.line,
    });
    dataCursor += item.size;
  }

  // resolve label/immediate operands now that addresses are known
  for (const inst of instructions) {
    inst.operands = inst.operands.map((operand) => resolveOperand(operand, labels));
  }

  // source map
  const sourceMap = buildSourceMap(instructions, source);

  const entryIndex = labels.main !== undefined
    ? (labels.main - TEXT_BASE) / 4
    : instructions.length > 0
      ? 0
      : null;

  return {
    program: {
      instructions,
      data: dataEntries,
      labels,
      sourceMap,
      entryIndex,
      textBase: TEXT_BASE,
      dataBase: DATA_BASE,
    },
    errors,
  };
}

function alignFor(address: number, directive: DataDirective): number {
  const align = directive.type === "word" ? 4 : directive.type === "half" ? 2 : 1;
  return (address + align - 1) & ~(align - 1);
}

function buildSourceMap(instructions: Instruction[], source: string): SourceMap {
  const lineCount = source.split(/\r?\n/).length;
  const byLine: (number | null)[] = new Array(lineCount).fill(null);
  const byIndex: number[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    byIndex.push(inst.sourceLine);
    byLine[inst.sourceLine] = i;
  }
  return { byIndex, byLine };
}

function takeSingleLabel(
  pending: string[],
  errors: MipsParseError[],
  line: number,
  source: string,
): string | null {
  if (pending.length === 0) return null;
  if (pending.length > 1) {
    errors.push({ line, column: 0, message: "Only one label may precede a data directive", source });
  }
  const label = pending[0];
  pending.length = 0;
  return label;
}

function sourceForLine(source: string, line: number): string {
  return source.split(/\r?\n/)[line] ?? "";
}

// ─── Data directives ────────────────────────────────────────────────────────

function parseDataDirective(
  directive: string,
  args: Token[],
): { directive?: DataDirective; error?: string } {
  switch (directive) {
    case ".word":
      return numbersFrom(args, 4, (values) => ({ type: "word", values }));
    case ".half":
      return numbersFrom(args, 2, (values) => ({ type: "half", values }));
    case ".byte":
      return numbersFrom(args, 1, (values) => ({ type: "byte", values }));
    case ".space": {
      if (args.length !== 1 || args[0].type !== "number") {
        return { error: ".space expects a single size" };
      }
      const size = parseInteger(args[0].value);
      if (size === null || size < 0) return { error: "Invalid .space size" };
      return { directive: { type: "space", size } };
    }
    case ".asciiz": {
      if (args.length !== 1 || args[0].type !== "string") return { error: ".asciiz expects a string" };
      return { directive: { type: "asciiz", text: args[0].value } };
    }
    case ".ascii": {
      if (args.length !== 1 || args[0].type !== "string") return { error: ".ascii expects a string" };
      return { directive: { type: "ascii", text: args[0].value } };
    }
    default:
      return { error: `Unknown directive "${directive}"` };
  }
}

function numbersFrom(
  args: Token[],
  _width: number,
  build: (values: number[]) => DataDirective,
): { directive?: DataDirective; error?: string } {
  const values: number[] = [];
  for (const arg of args) {
    if (arg.type === "comma") continue;
    if (arg.type === "number") {
      const n = parseInteger(arg.value);
      if (n === null) return { error: `Invalid number "${arg.value}"` };
      values.push(n);
    } else if (arg.type === "char") {
      values.push(arg.value.charCodeAt(0));
    } else if (arg.type === "identifier") {
      // label placeholder — resolved at runtime load time; store sentinel
      values.push(encodeLabelRef(arg.value));
    } else {
      return { error: `Unexpected ${arg.type} in data` };
    }
  }
  return { directive: build(values) };
}

/** Encode a label reference inside a .word as a negative sentinel to resolve later. */
function encodeLabelRef(name: string): number {
  return LABEL_REF_BASE + labelRefIndex(name);
}

const LABEL_REF_BASE = -1_000_000;
const labelRefMap = new Map<string, number>();
function labelRefIndex(name: string): number {
  let idx = labelRefMap.get(name);
  if (idx === undefined) {
    idx = labelRefMap.size;
    labelRefMap.set(name, idx);
  }
  return idx;
}

function dataDirectiveSize(directive: DataDirective): number {
  switch (directive.type) {
    case "word":
      return directive.values.length * 4;
    case "half":
      return directive.values.length * 2;
    case "byte":
      return directive.values.length;
    case "space":
      return directive.size;
    case "asciiz":
      return encodeString(directive.text).length + 1;
    case "ascii":
      return encodeString(directive.text).length;
  }
}

export function dataDirectiveBytes(directive: DataDirective, labelAddresses: Record<string, number>): number[] {
  switch (directive.type) {
    case "word":
      return directive.values.flatMap((v) => resolveWordBytes(v, labelAddresses));
    case "half":
      return directive.values.flatMap((v) => {
        const n = v & 0xffff;
        return [n & 0xff, (n >>> 8) & 0xff];
      });
    case "byte":
      return directive.values.map((v) => v & 0xff);
    case "space":
      return new Array(directive.size).fill(0);
    case "asciiz":
      return [...encodeString(directive.text), 0];
    case "ascii":
      return encodeString(directive.text);
  }
}

function resolveWordBytes(value: number, labelAddresses: Record<string, number>): number[] {
  let resolved = value;
  if (value <= LABEL_REF_BASE) {
    const refIndex = value - LABEL_REF_BASE;
    const labelName = [...labelRefMap.keys()].find((k) => labelRefMap.get(k) === refIndex);
    if (labelName && labelAddresses[labelName] !== undefined) {
      resolved = labelAddresses[labelName];
    } else {
      resolved = 0;
    }
  }
  const u = resolved >>> 0;
  return [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff];
}

function encodeString(text: string): number[] {
  return Array.from(text).map((c) => c.charCodeAt(0) & 0xff);
}

// ─── Instruction operands ───────────────────────────────────────────────────

function parseInstructionOperands(
  op: string,
  tokens: Token[],
): { operands?: Operand[]; error?: string } {
  // Split tokens on commas.
  const groups: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type === "comma") {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) groups.push(current);

  const isLoadStore = ["lw", "lh", "lb", "lhu", "lbu", "sw", "sh", "sb"].includes(op);

  const operands: Operand[] = [];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const result = isLoadStore && g >= 1 ? parseMemoryOperand(group) : parseSimpleOperand(group);
    if (result.error) return result;
    if (!result.operand) return { error: "Missing operand" };
    operands.push(result.operand);
  }

  return { operands };
}

function parseSimpleOperand(tokens: Token[]): { operand?: Operand; error?: string } {
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t.type === "register") {
      const name = resolveRegisterName(t.value);
      if (!name) return { error: `Unknown register "${t.value}"` };
      return { operand: { type: "register", value: name as RegisterName } };
    }
    if (t.type === "number") {
      const n = parseInteger(t.value);
      if (n === null) return { error: `Invalid number "${t.value}"` };
      return { operand: { type: "immediate", value: n } };
    }
    if (t.type === "char") {
      return { operand: { type: "immediate", value: t.value.charCodeAt(0) } };
    }
    if (t.type === "identifier") {
      return { operand: { type: "label", value: t.value } };
    }
  }
  return { error: `Unexpected operand near "${tokens.map((t) => t.value).join("")}"` };
}

/** Parse an offset(base) memory reference, or a bare label/number for absolute. */
function parseMemoryOperand(tokens: Token[]): { operand?: Operand; error?: string } {
  // offset ( base )
  const lparenIndex = tokens.findIndex((t) => t.type === "lparen");
  if (lparenIndex !== -1) {
    const offsetTokens = tokens.slice(0, lparenIndex);
    const after = tokens.slice(lparenIndex + 1);
    if (after.length < 2 || after[0].type !== "register" || after[1].type !== "rparen") {
      return { error: "Malformed memory operand" };
    }
    const base = resolveRegisterName(after[0].value);
    if (!base) return { error: `Unknown register "${after[0].value}"` };

    let offset = 0;
    if (offsetTokens.length === 0) {
      offset = 0;
    } else if (offsetTokens.length === 1) {
      const t = offsetTokens[0];
      if (t.type === "number") {
        const n = parseInteger(t.value);
        if (n === null) return { error: `Invalid offset "${t.value}"` };
        offset = n;
      } else if (t.type === "identifier") {
        // label as offset — resolved later
        return { operand: { type: "offset", value: encodeLabelRef(t.value), base: base as RegisterName, label: t.value } } as { operand: Operand };
      } else if (t.type === "char") {
        offset = t.value.charCodeAt(0);
      } else {
        return { error: "Invalid offset" };
      }
    } else {
      return { error: "Invalid offset" };
    }
    return { operand: { type: "offset", value: offset, base: base as RegisterName } };
  }

  // bare label or number -> absolute address with base $zero
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t.type === "identifier") {
      return { operand: { type: "offset", value: encodeLabelRef(t.value), base: "$zero", label: t.value } as Operand };
    }
    if (t.type === "number") {
      const n = parseInteger(t.value);
      if (n === null) return { error: `Invalid address "${t.value}"` };
      return { operand: { type: "offset", value: n, base: "$zero" } };
    }
  }
  return { error: "Invalid memory operand" };
}

/** Second pass: resolve label references into concrete addresses. */
function resolveOperand(operand: Operand, labels: Record<string, number>): Operand {
  if (operand.type === "label") {
    return operand;
  }
  if (operand.type === "offset" && operand.label) {
    const address = labels[operand.label];
    if (address === undefined) {
      // unresolved label — keep as-is; interpreter will error
      return operand;
    }
    return { type: "offset", value: address, base: operand.base };
  }
  return operand;
}

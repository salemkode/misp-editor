/**
 * Instruction specifications and executors.
 *
 * Every supported op has one entry in {@link INSTRUCTION_SPECS} that pairs the
 * mnemonic with its executor + operand pattern + description. The spec table is
 * the single source of truth that powers: execution, autocomplete, hover docs,
 * and (eventually) parser operand-count validation.
 */

import type { RegisterName } from "../types";
import type { StepBuilder } from "../runtime/builder";
import { executeSyscall } from "../syscalls/syscalls";
import { toInt32 } from "../int32";

// Registries (declared first so the executor loops below can populate them).
const INSTRUCTION_SPECS_REGISTRY: InstructionSpec[] = [];
const mnemonicUsed = new Set<string>();

export type Executor = (b: StepBuilder) => void;

export type InstructionSpec = {
  pattern: string;
  description: string;
  category:
    | "arithmetic"
    | "logical"
    | "shift"
    | "data"
    | "load"
    | "store"
    | "branch"
    | "jump"
    | "pseudo"
    | "system";
  execute: Executor;
};

// ─── operand helpers ────────────────────────────────────────────────────────

function reg(b: StepBuilder, index: number): RegisterName {
  const operand = b.instruction.operands[index];
  if (!operand || operand.type !== "register") {
    throw new Error(`Expected register at operand ${index} in "${b.instruction.raw}"`);
  }
  return operand.value;
}

function imm(b: StepBuilder, index: number): number {
  const operand = b.instruction.operands[index];
  if (!operand) throw new Error(`Missing operand ${index} in "${b.instruction.raw}"`);
  if (operand.type === "immediate") return operand.value;
  if (operand.type === "label") return resolveLabelAddress(b, operand.value);
  throw new Error(`Expected immediate at operand ${index} in "${b.instruction.raw}"`);
}

function mem(b: StepBuilder, index: number): { base: RegisterName; offset: number; address: number } {
  const operand = b.instruction.operands[index];
  if (!operand || operand.type !== "offset") {
    throw new Error(`Expected memory operand at operand ${index} in "${b.instruction.raw}"`);
  }
  const address = b.computeAddress(operand.base, operand.value);
  return { base: operand.base, offset: operand.value, address };
}

function resolveLabelAddress(b: StepBuilder, label: string): number {
  const addr = b.state.program?.labels[label];
  if (addr === undefined) {
    throw new Error(`Undefined label "${label}"`);
  }
  return addr;
}

function resolveLabelTarget(b: StepBuilder, label: string): { index: number; pc: number } {
  const pc = resolveLabelAddress(b, label);
  const index = Math.round((pc - (b.state.program?.textBase ?? 0x00400000)) / 4);
  return { index, pc };
}

function labelOperand(b: StepBuilder, index: number): string {
  const operand = b.instruction.operands[index];
  if (!operand) throw new Error(`Missing operand ${index} in "${b.instruction.raw}"`);
  if (operand.type === "label") return operand.value;
  if (operand.type === "offset" && operand.label) return operand.label;
  throw new Error(`Expected label at operand ${index} in "${b.instruction.raw}"`);
}

// ─── arithmetic / logical (R-type: rd, rs, rt) ──────────────────────────────

const arithmeticOps: Array<[string, "add" | "sub" | "and" | "or" | "xor" | "nor" | "slt" | "sltu", string]> = [
  ["add", "add", "rd = rs + rt"],
  ["addu", "add", "rd = rs + rt (unsigned, no overflow trap)"],
  ["sub", "sub", "rd = rs - rt"],
  ["subu", "sub", "rd = rs - rt (unsigned)"],
  ["and", "and", "rd = rs & rt"],
  ["or", "or", "rd = rs | rt"],
  ["xor", "xor", "rd = rs ^ rt"],
  ["nor", "nor", "rd = ~(rs | rt)"],
  ["slt", "slt", "rd = (rs < rt) ? 1 : 0 (signed)"],
  ["sltu", "sltu", "rd = (rs < rt) ? 1 : 0 (unsigned)"],
];

for (const [mnemonic, aluOp, description] of arithmeticOps) {
  INSTRUCTION_SPECS_REGISTRY.push({
    pattern: `${mnemonic} rd, rs, rt`,
    description,
    category: mnemonic === "slt" || mnemonic === "sltu" ? "arithmetic" : aluOp === "add" || aluOp === "sub" ? "arithmetic" : "logical",
    execute: (b) => {
      const rs = reg(b, 1);
      const rt = reg(b, 2);
      const a = b.readRegisterToAlu(rs);
      const c = b.readRegisterToAlu(rt);
      const result = b.aluCompute(aluOp, a, c);
      b.writeRegisterFromAlu(reg(b, 0), result);
      b.explanation = `${description}: ${a} ${aluSymbol(aluOp)} ${c} = ${result}`;
    },
  });
  mnemonicUsed.add(mnemonic);
}

// ─── immediate arithmetic / logical (rt, rs, imm) ───────────────────────────

const immediateOps: Array<[string, "add" | "and" | "or" | "xor" | "slt" | "sltu", string, boolean]> = [
  ["addi", "add", "rt = rs + imm", false],
  ["addiu", "add", "rt = rs + imm (unsigned)", false],
  ["andi", "and", "rt = rs & imm (zero-extended)", true],
  ["ori", "or", "rt = rs | imm (zero-extended)", true],
  ["xori", "xor", "rt = rs ^ imm (zero-extended)", true],
  ["slti", "slt", "rt = (rs < imm) ? 1 : 0 (signed)", false],
  ["sltiu", "sltu", "rt = (rs < imm) ? 1 : 0 (unsigned)", false],
];

for (const [mnemonic, aluOp, description, zeroExtend] of immediateOps) {
  INSTRUCTION_SPECS_REGISTRY.push({
    pattern: `${mnemonic} rt, rs, imm`,
    description,
    category: aluOp === "add" ? "arithmetic" : aluOp === "slt" || aluOp === "sltu" ? "arithmetic" : "logical",
    execute: (b) => {
      const rs = reg(b, 1);
      const a = b.readRegisterToAlu(rs);
      const rawImm = imm(b, 2);
      const c = b.immediateToAlu(zeroExtend ? rawImm & 0xffff : rawImm);
      const result = b.aluCompute(aluOp, a, c);
      b.writeRegisterFromAlu(reg(b, 0), result);
      b.explanation = `${description}: ${a} ${aluSymbol(aluOp)} ${c} = ${result}`;
    },
  });
  mnemonicUsed.add(mnemonic);
}

// ─── shifts (rd, rt, sa) ────────────────────────────────────────────────────

const shiftOps: Array<[string, "sll" | "srl" | "sra", string]> = [
  ["sll", "sll", "rd = rt << sa"],
  ["srl", "srl", "rd = rt >> sa (logical)"],
  ["sra", "sra", "rd = rt >> sa (arithmetic)"],
];

for (const [mnemonic, aluOp, description] of shiftOps) {
  INSTRUCTION_SPECS_REGISTRY.push({
    pattern: `${mnemonic} rd, rt, sa`,
    description,
    category: "shift",
    execute: (b) => {
      const rt = reg(b, 1);
      const a = b.readRegisterToAlu(rt);
      const sa = b.immediateToAlu(imm(b, 2));
      const result = b.aluCompute(aluOp, a, sa);
      b.writeRegisterFromAlu(reg(b, 0), result);
      b.explanation = `${description}`;
    },
  });
  mnemonicUsed.add(mnemonic);
}

// variable shifts: sllv/srlv/srav rd, rt, rs
const varShiftOps: Array<[string, "sll" | "srl" | "sra", string]> = [
  ["sllv", "sll", "rd = rt << (rs & 31)"],
  ["srlv", "srl", "rd = rt >> (rs & 31) logical"],
  ["srav", "sra", "rd = rt >> (rs & 31) arithmetic"],
];
for (const [mnemonic, aluOp, description] of varShiftOps) {
  INSTRUCTION_SPECS_REGISTRY.push({
    pattern: `${mnemonic} rd, rt, rs`,
    description,
    category: "shift",
    execute: (b) => {
      const rt = reg(b, 1);
      const rs = reg(b, 2);
      const a = b.readRegisterToAlu(rt);
      const sa = b.readRegisterToAlu(rs) & 31;
      const result = b.aluCompute(aluOp, a, sa);
      b.writeRegisterFromAlu(reg(b, 0), result);
      b.explanation = `${description}`;
    },
  });
  mnemonicUsed.add(mnemonic);
}

// ─── load / store ───────────────────────────────────────────────────────────

function loadExecutor(size: Parameters<typeof loadSize>[0], signed: boolean): Executor {
  const sizeInfo = loadSize(size);
  return (b) => {
    const { address } = mem(b, 1);
    const raw = b.readMemory(address, sizeInfo.size);
    const value = signed ? signExtend(raw, sizeInfo.size) : raw;
    b.writeRegisterFromMemory(reg(b, 0), value, address, sizeInfo.size);
    b.explanation = `Load ${sizeInfo.size} from 0x${(address >>> 0).toString(16)} into ${b.instruction.operands[0].value}`;
  };
}

function loadSize(kind: "word" | "half" | "halfu" | "byte" | "byteu"): { size: "word" | "half" | "byte" } {
  switch (kind) {
    case "word":
      return { size: "word" };
    case "half":
    case "halfu":
      return { size: "half" };
    case "byte":
    case "byteu":
      return { size: "byte" };
  }
}

function signExtend(value: number, size: "word" | "half" | "byte"): number {
  if (size === "word") return toInt32(value);
  const bits = size === "half" ? 16 : 8;
  const mask = 1 << (bits - 1);
  return toInt32((value & ((1 << bits) - 1)) ^ mask) - mask;
}

function storeExecutor(kind: "word" | "half" | "byte"): Executor {
  const size = kind;
  return (b) => {
    const rt = reg(b, 0);
    const value = b.readRegister(rt);
    const { address } = mem(b, 1);
    b.writeMemoryFromRegister(address, rt, value, size);
    b.explanation = `Store ${size} from ${rt} (${value}) into 0x${(address >>> 0).toString(16)}`;
  };
}

for (const [mnemonic, kind, signed, pattern, description] of [
  ["lw", "word", true, "lw rt, offset(base)", "load word"] as const,
  ["lh", "half", true, "lh rt, offset(base)", "load half (signed)"] as const,
  ["lhu", "halfu", false, "lhu rt, offset(base)", "load half (unsigned)"] as const,
  ["lb", "byte", true, "lb rt, offset(base)", "load byte (signed)"] as const,
  ["lbu", "byteu", false, "lbu rt, offset(base)", "load byte (unsigned)"] as const,
  ["sw", "word", true, "sw rt, offset(base)", "store word"] as const,
  ["sh", "half", true, "sh rt, offset(base)", "store half"] as const,
  ["sb", "byte", true, "sb rt, offset(base)", "store byte"] as const,
]) {
  if (mnemonic.startsWith("s")) {
    INSTRUCTION_SPECS_REGISTRY.push({
      pattern,
      description,
      category: "store",
      execute: storeExecutor(kind as "word" | "half" | "byte"),
    });
  } else {
    INSTRUCTION_SPECS_REGISTRY.push({
      pattern,
      description,
      category: "load",
      execute: loadExecutor(kind as "word" | "half" | "halfu" | "byte" | "byteu", signed),
    });
  }
  mnemonicUsed.add(mnemonic);
}

// ─── multiply / divide ──────────────────────────────────────────────────────

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "mul rd, rs, rt",
  description: "rd = rs * rt (low 32 bits)",
  category: "arithmetic",
  execute: (b) => {
    const a = b.readRegister(reg(b, 1));
    const c = b.readRegister(reg(b, 2));
    const product = toInt32(a * c);
    b.writeRegister(reg(b, 0), product);
    b.explanation = `rd = ${a} * ${c} = ${product}`;
  },
});

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "mult rs, rt",
  description: "{hi, lo} = rs * rt (signed 64-bit)",
  category: "arithmetic",
  execute: (b) => {
    const a = b.readRegisterToAlu(reg(b, 0));
    const c = b.readRegisterToAlu(reg(b, 1));
    const product = BigInt(a) * BigInt(c);
    const lo = Number(product & 0xffffffffn);
    const hi = Number((product >> 32n) & 0xffffffffn);
    b.setLo(toInt32(lo));
    b.setHi(toInt32(hi));
    b.explanation = `mult: ${a} * ${c} -> hi:lo`;
  },
});

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "div rs, rt",
  description: "lo = rs / rt, hi = rs % rt (signed)",
  category: "arithmetic",
  execute: (b) => {
    const a = b.readRegisterToAlu(reg(b, 0));
    const c = b.readRegisterToAlu(reg(b, 1));
    if (c === 0) throw new Error("division by zero");
    // MIPS truncates toward zero
    const quotient = Math.trunc(a / c);
    const remainder = a - quotient * c;
    b.setLo(toInt32(quotient));
    b.setHi(toInt32(remainder));
    b.explanation = `div: ${a} / ${c} = ${quotient} (rem ${remainder})`;
  },
});

for (const [mnemonic, which, description] of [
  ["mfhi", "hi", "rd = hi"] as const,
  ["mflo", "lo", "rd = lo"] as const,
]) {
  INSTRUCTION_SPECS_REGISTRY.push({
    pattern: `${mnemonic} rd`,
    description,
    category: "arithmetic",
    execute: (b) => {
      const value = which === "hi" ? b.readHi() : b.readLo();
      b.writeRegister(reg(b, 0), value);
      b.explanation = `${description} (${value})`;
    },
  });
  mnemonicUsed.add(mnemonic);
}
mnemonicUsed.add("mul").add("mult").add("div");

// ─── branches ───────────────────────────────────────────────────────────────

function branchOnCondition(mnemonic: string, compare: (a: number, c: number) => boolean, description: string, usesRsRt: boolean): void {
  INSTRUCTION_SPECS_REGISTRY.push({
    pattern: usesRsRt ? `${mnemonic} rs, rt, label` : `${mnemonic} rs, label`,
    description,
    category: "branch",
    execute: (b) => {
      const rs = reg(b, 0);
      const a = b.readRegister(rs);
      let c: number;
      let cName: RegisterName = "$zero";
      if (usesRsRt) {
        cName = reg(b, 1);
        c = b.readRegister(cName);
      } else {
        c = 0;
      }
      const taken = compare(a, c);
      b.emitCompare(rs, cName, a, c, taken);
      const label = labelOperand(b, usesRsRt ? 2 : 1);
      const target = resolveLabelTarget(b, label);
      b.branchDecision(taken, target.index, target.pc, label);
      b.explanation = `${description}: ${a} vs ${c} -> ${taken ? "taken" : "not taken"}`;
    },
  });
  mnemonicUsed.add(mnemonic);
}

branchOnCondition("beq", (a, c) => a === c, "branch if equal", true);
branchOnCondition("bne", (a, c) => a !== c, "branch if not equal", true);
branchOnCondition("blez", (a) => a <= 0, "branch if <= 0", false);
branchOnCondition("bgtz", (a) => a > 0, "branch if > 0", false);
branchOnCondition("bltz", (a) => a < 0, "branch if < 0", false);
branchOnCondition("bgez", (a) => a >= 0, "branch if >= 0", false);

// signed comparison pseudo-branches: rs vs rt
branchOnCondition("bgt", (a, c) => a > c, "branch if greater than (pseudo)", true);
branchOnCondition("blt", (a, c) => a < c, "branch if less than (pseudo)", true);
branchOnCondition("bge", (a, c) => a >= c, "branch if greater or equal (pseudo)", true);
branchOnCondition("ble", (a, c) => a <= c, "branch if less or equal (pseudo)", true);

// ─── jumps ──────────────────────────────────────────────────────────────────

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "j label",
  description: "jump to label",
  category: "jump",
  execute: (b) => {
    const label = labelOperand(b, 0);
    const target = resolveLabelTarget(b, label);
    b.jump(target.index, target.pc, label);
    b.explanation = `jump to ${label}`;
  },
});
mnemonicUsed.add("j");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "jal label",
  description: "jump and link ($ra = pc + 8 in real MIPS; here pc of next inst)",
  category: "jump",
  execute: (b) => {
    const label = labelOperand(b, 0);
    const target = resolveLabelTarget(b, label);
    const returnPc = b.instruction.address + 4;
    b.writeRegister("$ra", returnPc);
    b.jump(target.index, target.pc, label);
    b.explanation = `call ${label}; $ra = 0x${(returnPc >>> 0).toString(16)}`;
  },
});
mnemonicUsed.add("jal");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "jr rs",
  description: "jump to address in rs",
  category: "jump",
  execute: (b) => {
    const rs = reg(b, 0);
    const targetPc = b.readRegister(rs);
    const textBase = b.state.program?.textBase ?? 0x00400000;
    const targetIndex = Math.round((targetPc - textBase) / 4);
    b.jump(targetIndex, targetPc, undefined);
    b.explanation = `return to ${rs} (0x${(targetPc >>> 0).toString(16)})`;
  },
});
mnemonicUsed.add("jr");

// ─── pseudo-instructions ────────────────────────────────────────────────────

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "li rt, imm",
  description: "load immediate (pseudo)",
  category: "pseudo",
  execute: (b) => {
    const value = imm(b, 1);
    b.immediateToAlu(value);
    b.writeRegisterFromAlu(reg(b, 0), value);
    b.explanation = `load ${value} into ${b.instruction.operands[0].value}`;
  },
});
mnemonicUsed.add("li");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "move rt, rs",
  description: "copy rs into rt (pseudo)",
  category: "pseudo",
  execute: (b) => {
    const rs = reg(b, 1);
    const value = b.readRegister(rs);
    b.writeRegister(reg(b, 0), value);
    b.explanation = `move ${value} from ${rs}`;
  },
});
mnemonicUsed.add("move");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "la rt, label",
  description: "load address of label (pseudo)",
  category: "pseudo",
  execute: (b) => {
    const label = labelOperand(b, 1);
    const address = resolveLabelAddress(b, label);
    b.writeRegister(reg(b, 0), address);
    b.explanation = `load address of ${label} (0x${(address >>> 0).toString(16)})`;
  },
});
mnemonicUsed.add("la");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "b label",
  description: "unconditional branch (pseudo)",
  category: "branch",
  execute: (b) => {
    const label = labelOperand(b, 0);
    const target = resolveLabelTarget(b, label);
    b.branchDecision(true, target.index, target.pc, label);
    b.explanation = `branch to ${label}`;
  },
});
mnemonicUsed.add("b");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "not rd, rs",
  description: "rd = ~rs (pseudo)",
  category: "logical",
  execute: (b) => {
    const a = b.readRegisterToAlu(reg(b, 1));
    const result = b.aluCompute("nor", a, 0);
    b.writeRegisterFromAlu(reg(b, 0), result);
    b.explanation = `not: ~${a} = ${result}`;
  },
});
mnemonicUsed.add("not");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "neg rd, rs",
  description: "rd = -rs (pseudo)",
  category: "arithmetic",
  execute: (b) => {
    const a = b.readRegisterToAlu(reg(b, 1));
    const result = b.aluCompute("sub", 0, a);
    b.writeRegisterFromAlu(reg(b, 0), result);
    b.explanation = `neg: -${a} = ${result}`;
  },
});
mnemonicUsed.add("neg");

// ─── system ─────────────────────────────────────────────────────────────────

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "syscall",
  description: "invoke a system service (selected by $v0)",
  category: "system",
  execute: (b) => {
    executeSyscall(b);
  },
});
mnemonicUsed.add("syscall");

INSTRUCTION_SPECS_REGISTRY.push({
  pattern: "nop",
  description: "no operation",
  category: "system",
  execute: (b) => {
    b.explanation = "no operation";
  },
});
mnemonicUsed.add("nop");

// ─── registry ───────────────────────────────────────────────────────────────

// Note: specs are pushed above via the array, then frozen here.
export const INSTRUCTION_SPECS: Record<string, InstructionSpec> = (() => {
  const map: Record<string, InstructionSpec> = {};
  for (const spec of INSTRUCTION_SPECS_REGISTRY) {
    const mnemonic = spec.pattern.split(" ")[0];
    map[mnemonic] = spec;
  }
  return map;
})();

export const ALL_MNEMONICS: string[] = Array.from(mnemonicUsed).sort();

export function getExecutor(op: string): Executor | null {
  return INSTRUCTION_SPECS[op]?.execute ?? null;
}

export function isKnownInstruction(op: string): boolean {
  return op in INSTRUCTION_SPECS;
}

// ─── misc ───────────────────────────────────────────────────────────────────

function aluSymbol(op: string): string {
  switch (op) {
    case "add":
      return "+";
    case "sub":
      return "-";
    case "and":
      return "&";
    case "or":
      return "|";
    case "xor":
      return "^";
    case "nor":
      return "~|";
    case "slt":
      return "<";
    case "sltu":
      return "<u";
    default:
      return op;
  }
}

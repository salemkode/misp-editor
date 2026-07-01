/**
 * Core type model for the virtual MIPS CPU.
 *
 * Everything the interpreter does is expressed through these types so that the
 * UI can animate execution purely from the {@link ExecutionTrace} + visual
 * events, without needing to understand MIPS itself.
 */

import type { NumberFormat } from "./int32";

// ─── Registers ───────────────────────────────────────────────────────────────

export const REGISTER_NAMES = [
  "$zero", "$at", "$v0", "$v1",
  "$a0", "$a1", "$a2", "$a3",
  "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
  "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
  "$t8", "$t9",
  "$k0", "$k1",
  "$gp", "$sp", "$fp", "$ra",
] as const;

export type RegisterName = (typeof REGISTER_NAMES)[number];

export type RegisterFile = Record<RegisterName, number>;

/** Map of register index -> symbolic name, for `numeric` register access. */
export const REGISTER_BY_NUMBER: RegisterName[] = [
  "$zero", "$at", "$v0", "$v1",
  "$a0", "$a1", "$a2", "$a3",
  "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
  "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
  "$t8", "$t9", "$k0", "$k1", "$gp", "$sp", "$fp", "$ra",
];

// ─── Operands & instructions ─────────────────────────────────────────────────

export type Operand =
  | { type: "register"; value: RegisterName }
  | { type: "immediate"; value: number }
  | { type: "label"; value: string }
  | { type: "offset"; value: number; base: RegisterName; label?: string }; // e.g. 4($sp) or bare label

export type SourceMap = {
  /** instruction index -> 0-based source line */
  byIndex: number[];
  /** 0-based source line -> instruction index (or null if line is not code) */
  byLine: (number | null)[];
};

export type Instruction = {
  id: string;
  op: string;
  operands: Operand[];
  sourceLine: number;
  raw: string;
  address: number;
};

// ─── Program (assembler output) ──────────────────────────────────────────────

export type DataDirective =
  | { type: "word"; values: number[] }
  | { type: "half"; values: number[] }
  | { type: "byte"; values: number[] }
  | { type: "space"; size: number }
  | { type: "asciiz"; text: string }
  | { type: "ascii"; text: string };

export type DataEntry = {
  label: string | null;
  address: number;
  directive: DataDirective;
  sourceLine: number;
};

export type MipsProgram = {
  instructions: Instruction[];
  data: DataEntry[];
  labels: Record<string, number>;
  sourceMap: SourceMap;
  entryIndex: number | null;
  textBase: number;
  dataBase: number;
};

export type MipsParseError = {
  line: number;
  column: number;
  message: string;
  source: string;
};

// ─── Memory ──────────────────────────────────────────────────────────────────

export type MemoryLayout = {
  textBase: number;
  dataBase: number;
  heapBase: number;
  stackBase: number; // top of stack (grows down)
};

export const DEFAULT_MEMORY_LAYOUT: MemoryLayout = {
  textBase: 0x00400000,
  dataBase: 0x10010000,
  heapBase: 0x10040000,
  stackBase: 0x7fffeffc,
};

export type MemoryWord = {
  address: number;
  /** 4 signed bytes, little-endian: [low ... high] */
  bytes: [number, number, number, number];
};

export type MemoryRecord = {
  address: number;
  /** which source label/region this address belongs to, if known */
  region: "data" | "stack" | "heap" | "text";
  word: number;
};

// ─── Traces ─────────────────────────────────────────────────────────────────

export type TraceRead =
  | { type: "register"; name: RegisterName; value: number }
  | { type: "immediate"; value: number }
  | { type: "memory"; address: number; value: number; size: MemorySize };

export type TraceWrite =
  | { type: "register"; name: RegisterName; oldValue: number; newValue: number }
  | { type: "memory"; address: number; oldValue: number; newValue: number; size: MemorySize };

export type MemorySize = "byte" | "half" | "word";

export type AluOperation = "add" | "sub" | "and" | "or" | "xor" | "nor" | "slt" | "sltu" | "sll" | "srl" | "sra";

export type AluTrace = {
  operation: AluOperation;
  inputA: number;
  inputB: number;
  result: number;
};

export type MemoryTrace = {
  action: "read" | "write";
  address: number;
  value: number;
  size: MemorySize;
};

export type BranchTrace = {
  condition: boolean;
  targetLabel?: string;
  targetPc: number;
  taken: boolean;
};

export type ConsoleTrace = {
  action: "print" | "read";
  value?: string | number;
};

// ─── Visual events ──────────────────────────────────────────────────────────

export type VisualEvent =
  | { type: "REGISTER_READ"; register: RegisterName; value: number }
  | { type: "REGISTER_WRITE"; register: RegisterName; value: number }
  | { type: "REGISTER_TO_ALU"; from: RegisterName; value: number }
  | { type: "IMMEDIATE_TO_ALU"; value: number }
  | { type: "ALU_COMPUTE"; operation: AluOperation; inputA: number; inputB: number; result: number }
  | { type: "ALU_TO_REGISTER"; to: RegisterName; value: number }
  | { type: "REGISTER_COMPARE"; left: RegisterName; right: RegisterName; leftValue: number; rightValue: number; result: boolean }
  | { type: "ADDRESS_CALCULATION"; base: RegisterName; baseValue: number; offset: number; result: number }
  | { type: "MEMORY_READ"; address: number; value: number; size: MemorySize }
  | { type: "MEMORY_WRITE"; address: number; value: number; size: MemorySize }
  | { type: "MEMORY_TO_REGISTER"; address: number; to: RegisterName; value: number; size: MemorySize }
  | { type: "REGISTER_TO_MEMORY"; from: RegisterName; address: number; value: number; size: MemorySize }
  | { type: "PC_MOVE"; fromLine: number; toLine: number }
  | { type: "BRANCH_DECISION"; taken: boolean; fromLine: number; toLine: number; targetLabel?: string }
  | { type: "STACK_POINTER_MOVE"; oldValue: number; newValue: number }
  | { type: "CONSOLE_OUTPUT"; value: string }
  | { type: "JUMP"; fromLine: number; toLine: number; targetLabel?: string };

// ─── Execution trace (one per instruction) ───────────────────────────────────

export type ExecutionTrace = {
  instruction: {
    raw: string;
    op: string;
    sourceLine: number;
    pcBefore: number;
    pcAfter: number;
  };
  reads: TraceRead[];
  writes: TraceWrite[];
  alu?: AluTrace;
  memory?: MemoryTrace;
  branch?: BranchTrace;
  console?: ConsoleTrace;
  visualEvents: VisualEvent[];
  explanation: string;
};

// ─── Runtime state ───────────────────────────────────────────────────────────

export type RuntimeStatus =
  | "empty"
  | "ready"
  | "running"
  | "paused"
  | "finished"
  | "error";

export type RuntimeErrorInfo = {
  message: string;
  sourceLine: number | null;
  instructionRaw: string | null;
};

export type MipsRuntimeState = {
  status: RuntimeStatus;
  program: MipsProgram | null;
  pc: number;
  registers: RegisterFile;
  /** hi/lo special registers (multiply/divide results). */
  hi: number;
  lo: number;
  memory: MemoryState;
  consoleOutput: string[];
  currentInstructionIndex: number | null;
  history: RuntimeSnapshot[];
  lastTrace: ExecutionTrace | null;
  error: RuntimeErrorInfo | null;
  stepCount: number;
};

export type RuntimeSnapshot = {
  stepNumber: number;
  pc: number;
  registers: RegisterFile;
  hi: number;
  lo: number;
  /** addresses -> word values that were touched, plus the full set is in `memory`. */
  memory: MemoryState;
  currentInstructionIndex: number | null;
  consoleOutput: string[];
  trace: ExecutionTrace | null;
};

// Memory is stored sparsely: only addresses that have been written to.
export type MemoryState = {
  layout: MemoryLayout;
  /** address (word-aligned key) -> 4-byte tuple little-endian */
  bytes: Map<number, [number, number, number, number]>;
};

// ─── Result of a single step ─────────────────────────────────────────────────

export type StepResult = {
  nextState: MipsRuntimeState;
  trace: ExecutionTrace;
};

export type NumberFormatOption = NumberFormat;
export type { NumberFormat } from "./int32";

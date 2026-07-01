/**
 * Step builder.
 *
 * Each instruction is executed through a builder that mutates a working copy of
 * the runtime state while simultaneously recording the {@link TraceRead}s,
 * {@link TraceWrite}s and {@link VisualEvent}s that the animation layer plays
 * back. This keeps the "fake CPU" and the "visual story" perfectly in sync.
 */

import type {
  AluOperation,
  ExecutionTrace,
  MipsRuntimeState,
  MemorySize,
  RegisterName,
  TraceRead,
  TraceWrite,
  VisualEvent,
} from "../types";
import type { Instruction } from "../types";
import { readRegister, writeRegister } from "../registers";
import { readMemory, writeMemory, isAligned } from "../memory";
import { toInt32, toUint32 } from "../int32";

export class StepBuilder {
  readonly state: MipsRuntimeState;
  readonly instruction: Instruction;

  readonly reads: TraceRead[] = [];
  readonly writes: TraceWrite[] = [];
  readonly visualEvents: VisualEvent[] = [];

  alu: ExecutionTrace["alu"];
  memory: ExecutionTrace["memory"];
  branch: ExecutionTrace["branch"];
  console: ExecutionTrace["console"];
  explanation: string;

  /** Set by control-flow executors; runtime uses current+1 when left null. */
  nextInstructionIndex: number | null = null;
  nextPc: number | null = null;
  private pcHandled = false;
  private finished = false;

  constructor(state: MipsRuntimeState, instruction: Instruction) {
    this.state = state;
    this.instruction = instruction;
    this.explanation = "";
  }

  // ─── reads ──────────────────────────────────────────────────────────────

  /** Plain register read (no ALU involvement). Emits REGISTER_READ. */
  readRegister(name: RegisterName): number {
    const value = readRegister(this.state.registers, name);
    this.reads.push({ type: "register", name, value });
    this.emit({ type: "REGISTER_READ", register: name, value });
    return value;
  }

  immediate(value: number): number {
    this.reads.push({ type: "immediate", value });
    return value;
  }

  /** Register read feeding the ALU. Emits REGISTER_READ + REGISTER_TO_ALU. */
  readRegisterToAlu(name: RegisterName): number {
    const value = readRegister(this.state.registers, name);
    this.reads.push({ type: "register", name, value });
    this.emit({ type: "REGISTER_READ", register: name, value });
    this.emit({ type: "REGISTER_TO_ALU", from: name, value });
    return value;
  }

  /** Immediate feeding the ALU. Emits IMMEDIATE_TO_ALU. */
  immediateToAlu(value: number): number {
    this.reads.push({ type: "immediate", value });
    this.emit({ type: "IMMEDIATE_TO_ALU", value });
    return value;
  }

  // ─── ALU ────────────────────────────────────────────────────────────────

  /** Run an ALU operation and emit ALU_COMPUTE. Returns the signed result. */
  aluCompute(operation: AluOperation, inputA: number, inputB: number): number {
    const result = computeAlu(operation, inputA, inputB);
    this.alu = { operation, inputA, inputB, result };
    this.emit({ type: "ALU_COMPUTE", operation, inputA, inputB, result });
    return result;
  }

  /** Write a register straight from the ALU. Emits ALU_TO_REGISTER + REGISTER_WRITE. */
  writeRegisterFromAlu(name: RegisterName, value: number): void {
    const oldValue = readRegister(this.state.registers, name);
    this.state.registers = writeRegister(this.state.registers, name, value);
    this.writes.push({ type: "register", name, oldValue, newValue: toInt32(value) });
    this.emit({ type: "ALU_TO_REGISTER", to: name, value: toInt32(value) });
    this.emit({ type: "REGISTER_WRITE", register: name, value: toInt32(value) });
  }

  // ─── plain register write ───────────────────────────────────────────────

  /** Write a register (not from ALU, e.g. li / move / lw result). */
  writeRegister(name: RegisterName, value: number): void {
    const oldValue = readRegister(this.state.registers, name);
    this.state.registers = writeRegister(this.state.registers, name, value);
    this.writes.push({ type: "register", name, oldValue, newValue: toInt32(value) });
    this.emit({ type: "REGISTER_WRITE", register: name, value: toInt32(value) });
  }

  /** Move a value straight into a register from memory (lw/lh/lb). */
  writeRegisterFromMemory(name: RegisterName, value: number, address: number, size: MemorySize): void {
    const oldValue = readRegister(this.state.registers, name);
    this.state.registers = writeRegister(this.state.registers, name, value);
    this.writes.push({ type: "register", name, oldValue, newValue: toInt32(value) });
    this.emit({ type: "MEMORY_TO_REGISTER", address, to: name, value: toInt32(value), size });
    this.emit({ type: "REGISTER_WRITE", register: name, value: toInt32(value) });
  }

  // ─── compare ────────────────────────────────────────────────────────────

  compareRegisters(left: RegisterName, right: RegisterName): boolean {
    const leftValue = readRegister(this.state.registers, left);
    const rightValue = readRegister(this.state.registers, right);
    this.reads.push(
      { type: "register", name: left, value: leftValue },
      { type: "register", name: right, value: rightValue },
    );
    const result = leftValue === rightValue; // specialised by executors when needed
    this.emit({ type: "REGISTER_READ", register: left, value: leftValue });
    this.emit({ type: "REGISTER_READ", register: right, value: rightValue });
    this.emit({ type: "REGISTER_COMPARE", left, right, leftValue, rightValue, result });
    return result;
  }

  /** Emit a custom boolean comparison between two already-read registers. */
  emitCompare(left: RegisterName, right: RegisterName, leftValue: number, rightValue: number, result: boolean): void {
    this.emit({ type: "REGISTER_COMPARE", left, right, leftValue, rightValue, result });
  }

  // ─── memory ─────────────────────────────────────────────────────────────

  /** Compute base + offset and emit ADDRESS_CALCULATION. */
  computeAddress(base: RegisterName, offset: number): number {
    const baseValue = readRegister(this.state.registers, base);
    const result = toInt32(baseValue + offset);
    this.reads.push({ type: "register", name: base, value: baseValue });
    this.emit({ type: "REGISTER_READ", register: base, value: baseValue });
    this.emit({ type: "ADDRESS_CALCULATION", base, baseValue, offset, result });
    return result;
  }

  readMemory(address: number, size: MemorySize): number {
    if (!isAligned(address, size)) {
      throw runtimeError(this.state, this.instruction, `Unaligned ${size} access at 0x${(address >>> 0).toString(16)}`);
    }
    const value = readMemory(this.state.memory, address, size);
    this.reads.push({ type: "memory", address, value, size });
    this.memory = { action: "read", address, value, size };
    this.emit({ type: "MEMORY_READ", address, value, size });
    return value;
  }

  writeMemoryFromRegister(address: number, from: RegisterName, value: number, size: MemorySize): void {
    if (!isAligned(address, size)) {
      throw runtimeError(this.state, this.instruction, `Unaligned ${size} access at 0x${(address >>> 0).toString(16)}`);
    }
    const oldValue = readMemory(this.state.memory, address, size);
    this.state.memory = writeMemory(this.state.memory, address, value, size);
    this.writes.push({ type: "memory", address, oldValue, newValue: value, size });
    this.memory = { action: "write", address, value, size };
    this.emit({ type: "REGISTER_TO_MEMORY", from, address, value, size });
    this.emit({ type: "MEMORY_WRITE", address, value, size });
  }

  // ─── control flow ───────────────────────────────────────────────────────

  /** Record a taken/not-taken branch and set the next PC. */
  branchDecision(taken: boolean, targetInstructionIndex: number, targetPc: number, targetLabel?: string): void {
    this.branch = { condition: taken, targetLabel, targetPc, taken };
    this.pcHandled = true;
    this.nextInstructionIndex = taken ? targetInstructionIndex : this.currentIndex() + 1;
    this.nextPc = taken ? targetPc : this.instruction.address + 4;
    const toLine = taken ? this.lineForIndex(targetInstructionIndex) : this.instruction.sourceLine + 1;
    this.emit({
      type: "BRANCH_DECISION",
      taken,
      fromLine: this.instruction.sourceLine,
      toLine,
      targetLabel,
    });
    this.emit({ type: "PC_MOVE", fromLine: this.instruction.sourceLine, toLine });
  }

  /** Unconditional jump. */
  jump(targetInstructionIndex: number, targetPc: number, targetLabel?: string): void {
    this.pcHandled = true;
    this.nextInstructionIndex = targetInstructionIndex;
    this.nextPc = targetPc;
    const toLine = this.lineForIndex(targetInstructionIndex);
    this.emit({ type: "JUMP", fromLine: this.instruction.sourceLine, toLine, targetLabel });
    this.emit({ type: "PC_MOVE", fromLine: this.instruction.sourceLine, toLine });
  }

  /** Plain advance to the next instruction (default when no control flow). */
  markPcAdvancedToNext(): void {
    this.pcHandled = true;
  }

  /** Emit a PC_MOVE for a default (non-control-flow) advance. */
  emitPcMove(fromLine: number, toLine: number): void {
    this.emit({ type: "PC_MOVE", fromLine, toLine });
  }

  /** Mark the program as finished (e.g. exit syscall). */
  markProgramFinished(): void {
    this.finished = true;
    this.pcHandled = true;
    this.nextInstructionIndex = null;
    this.nextPc = null;
  }

  get shouldFinish(): boolean {
    return this.finished;
  }

  // ─── console ────────────────────────────────────────────────────────────

  emitConsole(value: string): void {
    this.console = { action: "print", value };
    this.emit({ type: "CONSOLE_OUTPUT", value });
    this.state.consoleOutput = [...this.state.consoleOutput, value];
  }

  // ─── hi / lo special registers ──────────────────────────────────────────

  setHi(value: number): void {
    this.state.hi = toInt32(value);
  }

  setLo(value: number): void {
    this.state.lo = toInt32(value);
  }

  readHi(): number {
    return this.state.hi;
  }

  readLo(): number {
    return this.state.lo;
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private emit(event: VisualEvent): void {
    this.visualEvents.push(event);
  }

  private currentIndex(): number {
    return this.state.currentInstructionIndex ?? 0;
  }

  private lineForIndex(index: number): number {
    const inst = this.state.program?.instructions[index];
    return inst ? inst.sourceLine : this.instruction.sourceLine + 1;
  }

  get pcHandledFlag(): boolean {
    return this.pcHandled;
  }

  /** Build the final immutable trace object. */
  buildTrace(): ExecutionTrace {
    const pcBefore = this.instruction.address;
    const pcAfter = this.nextPc ?? pcBefore + 4;
    return {
      instruction: {
        raw: this.instruction.raw,
        op: this.instruction.op,
        sourceLine: this.instruction.sourceLine,
        pcBefore,
        pcAfter,
      },
      reads: this.reads,
      writes: this.writes,
      alu: this.alu,
      memory: this.memory,
      branch: this.branch,
      console: this.console,
      visualEvents: this.visualEvents,
      explanation: this.explanation || this.instruction.raw,
    };
  }
}

export function computeAlu(operation: AluOperation, a: number, b: number): number {
  switch (operation) {
    case "add":
      return toInt32(a + b);
    case "sub":
      return toInt32(a - b);
    case "and":
      return toInt32(toUint32(a) & toUint32(b));
    case "or":
      return toInt32(toUint32(a) | toUint32(b));
    case "xor":
      return toInt32(toUint32(a) ^ toUint32(b));
    case "nor":
      return toInt32(~(toUint32(a) | toUint32(b)));
    case "slt":
      return a < b ? 1 : 0;
    case "sltu":
      return toUint32(a) < toUint32(b) ? 1 : 0;
    case "sll":
      return toInt32(toUint32(a) << (b & 31));
    case "srl":
      return toInt32(toUint32(a) >>> (b & 31));
    case "sra":
      return toInt32(a >> (b & 31));
    default:
      return 0;
  }
}

/** Construct a thrown runtime error carrying source location. */
export function runtimeError(_state: MipsRuntimeState, instruction: Instruction | null, message: string): RuntimeFault {
  return new RuntimeFault({
    message,
    sourceLine: instruction?.sourceLine ?? null,
    instructionRaw: instruction?.raw ?? null,
  });
}

export type RuntimeFaultData = {
  message: string;
  sourceLine: number | null;
  instructionRaw: string | null;
};

export class RuntimeFault extends Error {
  readonly data: RuntimeFaultData;
  constructor(data: RuntimeFaultData) {
    super(data.message);
    this.name = "RuntimeFault";
    this.data = data;
  }
}

/**
 * The virtual MIPS CPU.
 *
 * Pure functions over immutable {@link MipsRuntimeState}. The runtime owns the
 * real CPU state (registers, memory, PC) — every other "machine" in the UI is a
 * view/animation over the state produced here.
 */

import type {
  ExecutionTrace,
  MipsProgram,
  MipsRuntimeState,
  RuntimeSnapshot,
  StepResult,
} from "../types";
import { createRegisterFile, cloneRegisterFile } from "../registers";
import { createMemory, cloneMemory, loadBytes } from "../memory";
import { dataDirectiveBytes } from "../parser/parser";
import { StepBuilder, RuntimeFault } from "./builder";
import { getExecutor, isKnownInstruction } from "../instructions/instructions";

export function createInitialState(): MipsRuntimeState {
  return {
    status: "empty",
    program: null,
    pc: 0,
    registers: createRegisterFile(),
    hi: 0,
    lo: 0,
    memory: createMemory(),
    consoleOutput: [],
    currentInstructionIndex: null,
    history: [],
    lastTrace: null,
    error: null,
    stepCount: 0,
  };
}

/** Load a freshly-parsed program: reset registers/memory, seed `.data`, set PC. */
export function loadProgram(program: MipsProgram): MipsRuntimeState {
  let memory = createMemory();
  for (const entry of program.data) {
    const bytes = dataDirectiveBytes(entry.directive, program.labels);
    memory = loadBytes(memory, entry.address, bytes);
  }

  const entryIndex = program.entryIndex ?? 0;
  const registers = createRegisterFile();

  return {
    status: program.instructions.length > 0 ? "ready" : "empty",
    program,
    pc: program.instructions[entryIndex]?.address ?? program.textBase,
    registers,
    hi: 0,
    lo: 0,
    memory,
    consoleOutput: [],
    currentInstructionIndex: program.instructions.length > 0 ? entryIndex : null,
    history: [],
    lastTrace: null,
    error: null,
    stepCount: 0,
  };
}

export function cloneState(state: MipsRuntimeState): MipsRuntimeState {
  return {
    ...state,
    registers: cloneRegisterFile(state.registers),
    memory: cloneMemory(state.memory),
    consoleOutput: [...state.consoleOutput],
    history: [...state.history],
  };
}

export function canStep(state: MipsRuntimeState): boolean {
  if (!state.program) return false;
  if (state.status === "finished" || state.status === "error" || state.status === "empty") return false;
  if (state.currentInstructionIndex === null) return false;
  return state.currentInstructionIndex < state.program.instructions.length;
}

/** Execute exactly one instruction. Never mutates the input state. */
export function step(state: MipsRuntimeState): StepResult {
  if (!state.program) {
    throw new Error("Cannot step: no program loaded");
  }
  if (state.currentInstructionIndex === null) {
    throw new Error("Cannot step: no current instruction");
  }

  const currentIndex = state.currentInstructionIndex;
  const instructions = state.program.instructions;
  const instruction = instructions[currentIndex];

  // Fell off the end of the program.
  if (!instruction) {
    const finished = { ...cloneState(state), status: "finished" as const };
    return { nextState: finished, trace: emptyTrace(state) };
  }

  const executor = getExecutor(instruction.op);

  // Unknown instruction -> runtime error.
  if (!executor) {
    const errorState = cloneState(state);
    errorState.status = "error";
    errorState.error = {
      message: `Unknown instruction "${instruction.op}"`,
      sourceLine: instruction.sourceLine,
      instructionRaw: instruction.raw,
    };
    return { nextState: errorState, trace: errorTrace(instruction.raw, instruction.op, instruction.sourceLine, `Unknown instruction "${instruction.op}"`) };
  }

  const builder = new StepBuilder(cloneState(state), instruction);

  try {
    executor(builder);
  } catch (fault) {
    const errorState = builder.state;
    const message = fault instanceof RuntimeFault ? fault.data.message : fault instanceof Error ? fault.message : String(fault);
    errorState.status = "error";
    errorState.error = {
      message,
      sourceLine: instruction.sourceLine,
      instructionRaw: instruction.raw,
    };
    return {
      nextState: errorState,
      trace: errorTrace(instruction.raw, instruction.op, instruction.sourceLine, message, builder.buildTrace()),
    };
  }

  // Determine next PC / instruction index.
  let nextIndex: number | null;
  let nextPc: number;
  let finished = false;

  if (builder.shouldFinish) {
    nextIndex = null;
    nextPc = instruction.address;
    finished = true;
  } else if (builder.pcHandledFlag) {
    nextIndex = builder.nextInstructionIndex ?? currentIndex + 1;
    nextPc = builder.nextPc ?? instruction.address + 4;
  } else {
    nextIndex = currentIndex + 1;
    nextPc = instruction.address + 4;
    const toLine = instructions[nextIndex]?.sourceLine ?? instruction.sourceLine + 1;
    builder.emitPcMove(instruction.sourceLine, toLine);
  }

  // Stepping past the last instruction finishes the program.
  if (!finished && nextIndex !== null && nextIndex >= instructions.length) {
    finished = true;
    nextIndex = null;
  }

  const trace = builder.buildTrace();
  const snapshot = makeSnapshot(state, trace);

  const nextState: MipsRuntimeState = {
    ...builder.state,
    pc: finished ? instruction.address : nextPc,
    currentInstructionIndex: nextIndex,
    status: finished ? "finished" : state.status === "running" ? "running" : "ready",
    lastTrace: trace,
    history: [...builder.state.history, snapshot],
    stepCount: state.stepCount + 1,
    error: null,
  };

  return { nextState, trace };
}

/** Re-load the current program from scratch (clears history + console). */
export function reset(state: MipsRuntimeState): MipsRuntimeState {
  if (!state.program) return state;
  return loadProgram(state.program);
}

/** Restore the full machine state to a previously captured snapshot. */
export function restoreSnapshot(state: MipsRuntimeState, snapshot: RuntimeSnapshot): MipsRuntimeState {
  return {
    ...state,
    pc: snapshot.pc,
    registers: cloneRegisterFile(snapshot.registers),
    hi: snapshot.hi,
    lo: snapshot.lo,
    memory: cloneMemory(snapshot.memory),
    consoleOutput: [...snapshot.consoleOutput],
    currentInstructionIndex: snapshot.currentInstructionIndex,
    status: "ready",
    lastTrace: snapshot.trace,
    error: null,
  };
}

function makeSnapshot(state: MipsRuntimeState, trace: ExecutionTrace): RuntimeSnapshot {
  return {
    stepNumber: state.stepCount,
    pc: state.pc,
    registers: cloneRegisterFile(state.registers),
    hi: state.hi,
    lo: state.lo,
    memory: cloneMemory(state.memory),
    currentInstructionIndex: state.currentInstructionIndex,
    consoleOutput: [...state.consoleOutput],
    trace,
  };
}

function emptyTrace(state: MipsRuntimeState): ExecutionTrace {
  return {
    instruction: { raw: "", op: "", sourceLine: -1, pcBefore: state.pc, pcAfter: state.pc },
    reads: [],
    writes: [],
    visualEvents: [],
    explanation: "program finished",
  };
}

function errorTrace(
  raw: string,
  op: string,
  sourceLine: number,
  message: string,
  base?: ExecutionTrace,
): ExecutionTrace {
  return {
    instruction: { raw, op, sourceLine, pcBefore: 0, pcAfter: 0 },
    reads: base?.reads ?? [],
    writes: base?.writes ?? [],
    alu: base?.alu,
    memory: base?.memory,
    branch: base?.branch,
    console: base?.console,
    visualEvents: base?.visualEvents ?? [],
    explanation: `error: ${message}`,
  };
}

export { isKnownInstruction };

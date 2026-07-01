/**
 * Reactive runtime controller (the "RuntimeMachine").
 *
 * The interpreter is pure; this store is the only piece of mutable UI state. It
 * owns the source, the current {@link MipsRuntimeState}, and the run loop. Every
 * panel reads from here, so there is a single source of truth — exactly as the
 * architecture spec requires.
 */

import { createStore, produce } from "solid-js/store";
import { parse } from "~/core/parser/parser";
import {
  loadProgram,
  step as runtimeStep,
  reset as runtimeReset,
  restoreSnapshot,
  createInitialState,
} from "~/core/runtime/runtime";
import type { MipsParseError, MipsRuntimeState, NumberFormat } from "~/core/types";
import { DEFAULT_PROGRAM } from "./sampleProgram";

export type ControllerState = {
  source: string;
  runtime: MipsRuntimeState;
  parseErrors: MipsParseError[];
  numberFormat: NumberFormat;
  /** milliseconds between steps while running */
  stepDelayMs: number;
  isRunning: boolean;
  /** last-committed program source (used to decide if a reload is needed) */
  loadedSource: string;
};

// Parse + load the default program eagerly so the store starts ready (no effect
// needed — createStore does not require a reactive root).
function bootstrap(): { runtime: MipsRuntimeState; errors: MipsParseError[] } {
  const { program, errors } = parse(DEFAULT_PROGRAM);
  if (errors.length > 0 || !program) {
    return { runtime: createInitialState(), errors };
  }
  return { runtime: loadProgram(program), errors };
}

const booted = bootstrap();

const [state, setState] = createStore<ControllerState>({
  source: DEFAULT_PROGRAM,
  runtime: booted.runtime,
  parseErrors: booted.errors,
  numberFormat: "dec",
  stepDelayMs: 450,
  isRunning: false,
  loadedSource: DEFAULT_PROGRAM,
});

let runTimer: ReturnType<typeof setTimeout> | null = null;

export const controller = {
  state,
  setState,

  setSource(source: string): void {
    setState("source", source);
  },

  setNumberFormat(format: NumberFormat): void {
    setState("numberFormat", format);
  },

  setStepDelay(ms: number): void {
    setState("stepDelayMs", Math.max(0, ms));
  },

  /** Parse the current source and load it into the runtime. */
  load(): void {
    const { program, errors } = parse(state.source);
    setState("parseErrors", errors);
    if (errors.length > 0 || !program) {
      setState("runtime", createInitialState());
      setState("loadedSource", state.source);
      return;
    }
    setState("runtime", loadProgram(program));
    setState("loadedSource", state.source);
  },

  step(): void {
    ensureLoaded();
    if (!canStep()) return;
    setState("runtime", runtimeStep(state.runtime).nextState);
  },

  /** Step backwards through history (time-travel). */
  stepBack(): void {
    const history = state.runtime.history;
    if (history.length === 0) return;
    // history[i] = machine state after i steps (a pre-step snapshot of step i+1).
    const previous = history[history.length - 1];
    const restored = restoreSnapshot(state.runtime, previous);
    restored.history = history.slice(0, -1);
    restored.stepCount = restored.history.length;
    restored.lastTrace = lastTraceOf(restored.history);
    setState("runtime", restored);
  },

  /** Restore execution to a specific step in history (timeline jump). */
  goToStep(stepNumber: number): void {
    const history = state.runtime.history;
    if (stepNumber < 0 || stepNumber >= history.length) return;
    stopRun();
    const target = history[stepNumber]; // state after `stepNumber` steps
    const restored = restoreSnapshot(state.runtime, target);
    restored.history = history.slice(0, stepNumber);
    restored.stepCount = stepNumber;
    restored.lastTrace = lastTraceOf(restored.history);
    restored.status = "ready";
    setState("runtime", restored);
  },

  reset(): void {
    stopRun();
    setState("runtime", runtimeReset(state.runtime));
  },

  /** Jump the execution cursor to a given source line (debugger feature). */
  jumpToLine(line: number): void {
    if (!state.runtime.program) return;
    const index = state.runtime.program.sourceMap.byLine[line];
    if (index === null || index === undefined) return;
    setState(
      produce((s) => {
        s.runtime.currentInstructionIndex = index;
        s.runtime.pc = state.runtime.program!.instructions[index].address;
        s.runtime.status = "ready";
        s.runtime.error = null;
      }),
    );
  },

  run(): void {
    if (state.isRunning) return;
    ensureLoaded();
    if (!canStep()) return;
    setState("isRunning", true);
    scheduleStep();
  },

  pause(): void {
    stopRun();
  },

  toggleRun(): void {
    if (state.isRunning) this.pause();
    else this.run();
  },
};

function ensureLoaded(): void {
  if (state.loadedSource !== state.source || state.runtime.status === "empty") {
    controller.load();
  }
}

/** Pure check — safe to call during render (no setState side effects). */
function canStep(): boolean {
  const s = state.runtime.status;
  if (s === "finished" || s === "error" || s === "empty") return false;
  if (state.runtime.currentInstructionIndex === null) return false;
  if (!state.runtime.program) return false;
  return state.runtime.currentInstructionIndex < state.runtime.program.instructions.length;
}

function scheduleStep(): void {
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => {
    if (!state.isRunning) return;
    if (!canStep()) {
      stopRun();
      return;
    }
    setState("runtime", runtimeStep(state.runtime).nextState);
    if (state.runtime.status === "finished" || state.runtime.status === "error") {
      stopRun();
      return;
    }
    scheduleStep();
  }, state.stepDelayMs);
}

function stopRun(): void {
  if (runTimer) {
    clearTimeout(runTimer);
    runTimer = null;
  }
  setState("isRunning", false);
}

function lastTraceOf(history: MipsRuntimeState["history"]): MipsRuntimeState["lastTrace"] {
  return history.length > 0 ? history[history.length - 1].trace : null;
}

export { DEFAULT_PROGRAM };

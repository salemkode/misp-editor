import { controller } from "~/state/runtimeStore";
import { formatValue } from "~/core/int32";
import type { NumberFormat } from "~/core/int32";

/** Whether the Step button should be enabled right now. */
export function canStep(): boolean {
  const s = controller.state.runtime.status;
  const idx = controller.state.runtime.currentInstructionIndex;
  const program = controller.state.runtime.program;
  if (s === "finished" || s === "error" || s === "empty") return false;
  if (idx === null || !program) return false;
  return idx < program.instructions.length;
}

export function fmt(value: number): string {
  return formatValue(value, controller.state.numberFormat as NumberFormat);
}

/** Register names changed by the last executed instruction. */
export function recentlyWrittenRegisters(): Set<string> {
  const writes = controller.state.runtime.lastTrace?.writes ?? [];
  const set = new Set<string>();
  for (const w of writes) if (w.type === "register") set.add(w.name);
  return set;
}

/** Memory addresses touched by the last executed instruction. */
export function recentlyWrittenAddresses(): Set<number> {
  const writes = controller.state.runtime.lastTrace?.writes ?? [];
  const set = new Set<number>();
  for (const w of writes) if (w.type === "memory") set.add(w.address);
  return set;
}

/** Registers read by the last instruction. */
export function recentlyReadRegisters(): Set<string> {
  const reads = controller.state.runtime.lastTrace?.reads ?? [];
  const set = new Set<string>();
  for (const r of reads) if (r.type === "register") set.add(r.name);
  return set;
}

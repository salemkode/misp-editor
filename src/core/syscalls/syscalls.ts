/**
 * MIPS syscall handlers (SPIM/MARS-compatible subset).
 *
 * `$v0` selects the service. We support the most common print/read services
 * used in introductory courses. Each handler drives the {@link StepBuilder}
 * console + visual events.
 */

import type { StepBuilder } from "../runtime/builder";
import type { RegisterName } from "../types";
import { toInt32 } from "../int32";

export function executeSyscall(b: StepBuilder): void {
  const service = b.state.registers.$v0;

  switch (service) {
    case 1: // print integer in $a0
      b.emitConsole(String(toInt32(b.state.registers.$a0)));
      b.explanation = `syscall ${service}: print integer $a0`;
      return;
    case 4: {
      // print null-terminated string at address $a0
      const text = readCString(b, b.state.registers.$a0);
      b.emitConsole(text);
      b.explanation = `syscall ${service}: print string at $a0`;
      return;
    }
    case 11: // print character in $a0
      b.emitConsole(String.fromCharCode(b.state.registers.$a0 & 0xff));
      b.explanation = `syscall ${service}: print char $a0`;
      return;
    case 10: // exit
      b.markProgramFinished();
      b.explanation = `syscall ${service}: exit`;
      return;
    case 17: // exit2 with code in $a0
      b.markProgramFinished();
      b.explanation = `syscall ${service}: exit2`;
      return;
    default:
      b.explanation = `syscall ${service}: (unsupported service, ignored)`;
      return;
  }
}

function readCString(b: StepBuilder, address: number): string {
  let result = "";
  let cursor = address;
  const max = 1 << 16;
  for (let i = 0; i < max; i++) {
    // read byte directly from state without recording (console read is conceptual here)
    const byte = readByteDirect(b, cursor);
    if (byte === 0) break;
    result += String.fromCharCode(byte);
    cursor++;
  }
  return result;
}

function readByteDirect(b: StepBuilder, address: number): number {
  const key = address & ~0x3;
  const offset = address & 0x3;
  const word = b.state.memory.bytes.get(key >>> 0) ?? [0, 0, 0, 0];
  return word[offset] & 0xff;
}

// re-export for instruction executors that need argument registers
export type { RegisterName };

/**
 * Register file operations.
 *
 * Registers live on the runtime state. Reading and writing go through these
 * helpers so that the `$zero` invariant (always 0, writes ignored) and 32-bit
 * normalisation are enforced in exactly one place.
 */

import { DEFAULT_MEMORY_LAYOUT } from "./types";
import type { RegisterFile, RegisterName } from "./types";
import { toInt32 } from "./int32";
import { REGISTER_BY_NUMBER, REGISTER_NAMES } from "./types";

export function createRegisterFile(): RegisterFile {
  const file = {} as RegisterFile;
  for (const name of REGISTER_NAMES) {
    file[name] = 0;
  }
  // Stack pointer starts at the top of the stack.
  file.$sp = DEFAULT_MEMORY_LAYOUT.stackBase;
  file.$gp = 0x10008000;
  return file;
}

export function cloneRegisterFile(file: RegisterFile): RegisterFile {
  return { ...file };
}

export function readRegister(file: RegisterFile, name: RegisterName): number {
  return file[name] ?? 0;
}

/**
 * Write a register, honouring the `$zero` invariant. Returns a NEW register
 * file object (structural sharing) so React/Solid signals stay immutable.
 */
export function writeRegister(file: RegisterFile, name: RegisterName, value: number): RegisterFile {
  if (name === "$zero") return file;
  return { ...file, [name]: toInt32(value) };
}

/** Resolve a possibly-numeric register token (e.g. "$8") to its symbolic name. */
export function resolveRegisterName(token: string): RegisterName | null {
  const lower = token.toLowerCase();
  if ((REGISTER_NAMES as readonly string[]).includes(lower)) {
    return lower as RegisterName;
  }
  // $0 .. $31
  const numericMatch = /^\$(\d{1,2})$/.exec(lower);
  if (numericMatch) {
    const index = parseInt(numericMatch[1], 10);
    if (index >= 0 && index < REGISTER_BY_NUMBER.length) {
      return REGISTER_BY_NUMBER[index];
    }
  }
  return null;
}

/** Human-friendly display names for the register table. */
export const REGISTER_DISPLAY: { name: RegisterName; alias: string; description: string }[] = [
  { name: "$zero", alias: "0", description: "constant 0" },
  { name: "$at", alias: "1", description: "assembler temporary" },
  { name: "$v0", alias: "2", description: "return value / syscall code" },
  { name: "$v1", alias: "3", description: "return value" },
  { name: "$a0", alias: "4", description: "argument 0" },
  { name: "$a1", alias: "5", description: "argument 1" },
  { name: "$a2", alias: "6", description: "argument 2" },
  { name: "$a3", alias: "7", description: "argument 3" },
  { name: "$t0", alias: "8", description: "temporary" },
  { name: "$t1", alias: "9", description: "temporary" },
  { name: "$t2", alias: "10", description: "temporary" },
  { name: "$t3", alias: "11", description: "temporary" },
  { name: "$t4", alias: "12", description: "temporary" },
  { name: "$t5", alias: "13", description: "temporary" },
  { name: "$t6", alias: "14", description: "temporary" },
  { name: "$t7", alias: "15", description: "temporary" },
  { name: "$s0", alias: "16", description: "saved" },
  { name: "$s1", alias: "17", description: "saved" },
  { name: "$s2", alias: "18", description: "saved" },
  { name: "$s3", alias: "19", description: "saved" },
  { name: "$s4", alias: "20", description: "saved" },
  { name: "$s5", alias: "21", description: "saved" },
  { name: "$s6", alias: "22", description: "saved" },
  { name: "$s7", alias: "23", description: "saved" },
  { name: "$t8", alias: "24", description: "temporary" },
  { name: "$t9", alias: "25", description: "temporary" },
  { name: "$k0", alias: "26", description: "kernel" },
  { name: "$k1", alias: "27", description: "kernel" },
  { name: "$gp", alias: "28", description: "global pointer" },
  { name: "$sp", alias: "29", description: "stack pointer" },
  { name: "$fp", alias: "30", description: "frame pointer" },
  { name: "$ra", alias: "31", description: "return address" },
];

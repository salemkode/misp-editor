/**
 * Sparse byte-addressable memory with little-endian word/half/byte access.
 *
 * Memory is stored as a `Map<wordAddress, [b0, b1, b2, b3]>` (little-endian).
 * Only written words are stored; unwritten addresses read as zero. All public
 * helpers return NEW memory objects so runtime state stays immutable.
 */

import { DEFAULT_MEMORY_LAYOUT } from "./types";
import type { MemoryState, MemoryLayout, MemorySize } from "./types";
import { toInt32, toUint32 } from "./int32";

export function createMemory(layout: MemoryLayout = DEFAULT_MEMORY_LAYOUT): MemoryState {
  return {
    layout,
    bytes: new Map(),
  };
}

export function cloneMemory(memory: MemoryState): MemoryState {
  return {
    layout: memory.layout,
    bytes: new Map(memory.bytes),
  };
}

function wordKey(address: number): number {
  return address >>> 0;
}

function ensureWord(bytes: Map<number, [number, number, number, number]>, key: number): [number, number, number, number] {
  const existing = bytes.get(key);
  if (existing) return existing;
  const fresh: [number, number, number, number] = [0, 0, 0, 0];
  bytes.set(key, fresh);
  return fresh;
}

function readByte(memory: MemoryState, address: number): number {
  const key = wordKey(address & ~0x3);
  const offset = address & 0x3;
  const word = memory.bytes.get(key) ?? [0, 0, 0, 0];
  return word[offset] & 0xff;
}

function writeByte(memory: MemoryState, address: number, value: number): void {
  const key = wordKey(address & ~0x3);
  const offset = address & 0x3;
  const word = ensureWord(memory.bytes, key);
  word[offset] = value & 0xff;
}

function readHalf(memory: MemoryState, address: number): number {
  const lo = readByte(memory, address);
  const hi = readByte(memory, address + 1);
  return ((hi & 0xff) << 8) | (lo & 0xff);
}

function writeHalf(memory: MemoryState, address: number, value: number): void {
  writeByte(memory, address, value & 0xff);
  writeByte(memory, address + 1, (value >>> 8) & 0xff);
}

function readWord(memory: MemoryState, address: number): number {
  const key = wordKey(address);
  // require alignment handled by callers; if not aligned, fall back to bytes.
  if ((address & 0x3) === 0) {
    const word = memory.bytes.get(key) ?? [0, 0, 0, 0];
    return (
      ((word[3] & 0xff) << 24) |
      ((word[2] & 0xff) << 16) |
      ((word[1] & 0xff) << 8) |
      (word[0] & 0xff)
    );
  }
  return (
    (readByte(memory, address)) |
    (readByte(memory, address + 1) << 8) |
    (readByte(memory, address + 2) << 16) |
    (readByte(memory, address + 3) << 24)
  );
}

function writeWord(memory: MemoryState, address: number, value: number): void {
  const u = toUint32(value);
  writeByte(memory, address, u & 0xff);
  writeByte(memory, address + 1, (u >>> 8) & 0xff);
  writeByte(memory, address + 2, (u >>> 16) & 0xff);
  writeByte(memory, address + 3, (u >>> 24) & 0xff);
}

/** Alignment-check an address for a given access size. Returns true if aligned. */
export function isAligned(address: number, size: MemorySize): boolean {
  if (size === "byte") return true;
  if (size === "half") return (address & 0x1) === 0;
  return (address & 0x3) === 0;
}

export function readMemory(memory: MemoryState, address: number, size: MemorySize): number {
  switch (size) {
    case "byte":
      return readByte(memory, address) & 0xff;
    case "half":
      return readHalf(memory, address) & 0xffff;
    case "word":
    default:
      return toInt32(readWord(memory, address));
  }
}

/** Write memory, returning a NEW memory object. */
export function writeMemory(
  memory: MemoryState,
  address: number,
  value: number,
  size: MemorySize,
): MemoryState {
  const next = cloneMemory(memory);
  switch (size) {
    case "byte":
      writeByte(next, address, value);
      break;
    case "half":
      writeHalf(next, address, value);
      break;
    case "word":
    default:
      writeWord(next, address, value);
      break;
  }
  return next;
}

/** Bulk-load initial bytes (used by the assembler for `.data`). Returns new memory. */
export function loadBytes(memory: MemoryState, address: number, bytes: number[]): MemoryState {
  const next = cloneMemory(memory);
  for (let i = 0; i < bytes.length; i++) {
    writeByte(next, address + i, bytes[i] & 0xff);
  }
  return next;
}

export type MemoryRegion = {
  name: string;
  start: number;
  size: number;
};

/** All non-empty word addresses, sorted ascending. */
export function touchedWordAddresses(memory: MemoryState): number[] {
  return Array.from(memory.bytes.keys()).sort((a, b) => a - b);
}

export function formatAddress(address: number): string {
  return "0x" + (address >>> 0).toString(16).padStart(8, "0");
}

/**
 * Signed 32-bit integer helpers.
 *
 * MIPS registers are 32-bit. We keep all register/memory word values as signed
 * 32-bit integers in TypeScript's number space and normalise after every write
 * so arithmetic behaves like real hardware (two's-complement wrap-around).
 */

export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;
export const UINT_MAX = 0xffffffff;

/** Wrap an arbitrary JS number into the signed 32-bit range (two's complement). */
export function toInt32(value: number): number {
  return (value | 0);
}

/** Interpret a signed 32-bit value as unsigned. */
export function toUint32(value: number): number {
  return value >>> 0;
}

/** Parse an integer literal the way an assembler would: decimal or 0x hex. */
export function parseInteger(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed.replace(/^\+/, "");

  let value: number;
  if (/^0x[0-9a-f]+$/i.test(body)) {
    value = parseInt(body, 16);
  } else if (/^[0-9]+$/.test(body)) {
    value = parseInt(body, 10);
  } else if (/^'[\\?'a-z]'$/i.test(body)) {
    // char literal like 'a' or '\n'
    return null;
  } else {
    return null;
  }

  if (Number.isNaN(value)) return null;
  return negative ? -value : value;
}

/** Format a signed value as decimal. */
export function formatDecimal(value: number): string {
  return String(toInt32(value));
}

/** Format a value as 0x-prefixed hex (8 digits). */
export function formatHex(value: number): string {
  return "0x" + (value >>> 0).toString(16).padStart(8, "0");
}

/** Format a value as 32 zero/one bits. */
export function formatBinary(value: number): string {
  return (value >>> 0).toString(2).padStart(32, "0");
}

export type NumberFormat = "dec" | "hex" | "bin";

export function formatValue(value: number, format: NumberFormat): string {
  switch (format) {
    case "hex":
      return formatHex(value);
    case "bin":
      return formatBinary(value);
    case "dec":
    default:
      return formatDecimal(value);
  }
}

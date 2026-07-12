/**
 * Response sanitizer (defense-in-depth). Anything coming back from the extension
 * / node is untrusted: a hostile or buggy contract can return oversized strings,
 * bidi-spoofed symbols, negative or absurd numbers, or wrong types. Everything
 * rendered to the DOM or used in math flows through here first.
 */

import { stripHostileKeepInner } from "./sanitize";
import { ADDRESS_RE } from "./sanitize";

export const MAX_SYMBOL_LEN = 16;
export const MAX_NAME_LEN = 48;

/** Coerce an unknown value to a non-negative bigint, or null. */
export function toBigIntOrNull(value: unknown): bigint | null {
  try {
    if (typeof value === "bigint") return value >= 0n ? value : null;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) return null;
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string") {
      const s = value.trim();
      if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
      if (/^\d+$/.test(s)) return BigInt(s);
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Coerce an unknown hex-or-decimal value to a JS number, or null. */
export function toNumberOrNull(value: unknown): number | null {
  const big = toBigIntOrNull(value);
  if (big === null) return null;
  const n = Number(big);
  return Number.isFinite(n) ? n : null;
}

/** Validate decimals in the ERC-20 range [0, 36]. Defaults to 18 on garbage. */
export function sanitizeDecimals(value: unknown, fallback = 18): number {
  const n = toNumberOrNull(value);
  if (n === null || n < 0 || n > 36) return fallback;
  return Math.trunc(n);
}

/** Truncate + strip a token symbol for safe display. */
export function sanitizeSymbol(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = stripHostileKeepInner(value);
  return cleaned.slice(0, MAX_SYMBOL_LEN);
}

/** Truncate + strip a token name for safe display. */
export function sanitizeName(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = stripHostileKeepInner(value);
  return cleaned.slice(0, MAX_NAME_LEN);
}

/** Validate an address returned by the chain (shape only). */
export function sanitizeAddressResponse(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return ADDRESS_RE.test(s) ? s : null;
}

/** Validate a 32-byte transaction hash. */
export function sanitizeTxHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(s) ? s : null;
}

/**
 * Normalize a getReserves() tuple into { reserve0, reserve1, blockTimestampLast }.
 * Returns null if the tuple is malformed.
 */
export function sanitizeReserves(
  value: unknown,
): { reserve0: bigint; reserve1: bigint; blockTimestampLast: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const reserve0 = toBigIntOrNull(value[0]);
  const reserve1 = toBigIntOrNull(value[1]);
  if (reserve0 === null || reserve1 === null) return null;
  const ts = toNumberOrNull(value[2]) ?? 0;
  return { reserve0, reserve1, blockTimestampLast: ts };
}

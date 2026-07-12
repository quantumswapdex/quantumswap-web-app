/**
 * Input choke point (defense-in-depth). Every user-supplied value - pasted
 * addresses, typed amounts, route params, localStorage reads - passes through
 * here before it reaches the chain layer or the DOM. Address/amount primitives
 * are delegated to the `quantumcoin` SDK; we never hand-roll them.
 *
 * QuantumCoin addresses are 32 bytes: 0x + 64 hex chars. 20-byte Ethereum
 * addresses are rejected.
 */

import qc from "quantumcoin";

/** 0x + 64 hex characters (32 bytes). */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

// Zero-width, control, and bidirectional-override characters that could be used
// to visually spoof a token symbol/name or smuggle content past a filter.
// eslint-disable-next-line no-control-regex
const HOSTILE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Remove control, zero-width, and bidi characters and collapse whitespace. */
export function stripHostile(input: string): string {
  return input.replace(HOSTILE_CHARS, "").replace(/\s+/g, " ").trim();
}

/** Strip hostile chars without collapsing internal spacing (for symbols/names). */
export function stripHostileKeepInner(input: string): string {
  return input.replace(HOSTILE_CHARS, "").trim();
}

/**
 * Validate + normalize a QuantumCoin address. Returns the checksummed address,
 * or null if the input is not a valid 32-byte address.
 */
export function sanitizeAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = stripHostile(input).replace(/\s+/g, "");
  if (!ADDRESS_RE.test(cleaned)) return null;
  try {
    if (!qc.isAddress(cleaned)) return null;
    return qc.getAddress(cleaned);
  } catch {
    return null;
  }
}

/** True if the string has the shape of a 32-byte address (no checksum check). */
export function looksLikeAddress(input: string): boolean {
  return ADDRESS_RE.test(stripHostile(input).replace(/\s+/g, ""));
}

/**
 * Normalize a decimal amount string to a canonical "digits[.digits]" form.
 * Rejects anything that is not digits + a single dot, and caps fractional
 * digits at `decimals`. Returns null if invalid or empty.
 */
export function sanitizeAmountString(input: unknown, decimals: number): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  let s = String(input);
  s = stripHostile(s).replace(/\s+/g, "").replace(/,/g, "");
  if (s === "" || s === ".") return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  if ((s.match(/\./g) || []).length > 1) return null;
  // Split and clamp fractional length to the token's decimals.
  let [intPart, fracPart = ""] = s.split(".");
  intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
  if (decimals <= 0) {
    fracPart = "";
  } else if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  }
  const normalized = fracPart.length ? `${intPart}.${fracPart}` : intPart;
  if (!/\d/.test(normalized)) return null;
  return normalized;
}

/** Parse a user amount into base units (bigint) using the SDK. */
export function parseAmount(input: unknown, decimals: number): bigint | null {
  const normalized = sanitizeAmountString(input, decimals);
  if (normalized === null) return null;
  try {
    const parsed = qc.parseUnits(normalized, decimals);
    if (parsed < 0n) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Sanitize a free-text search query (name/symbol or address). */
export function sanitizeQuery(input: unknown): string {
  if (typeof input !== "string") return "";
  return stripHostile(input).slice(0, 80);
}

/** Clamp a slippage percentage to a sane range. */
export function sanitizeSlippage(input: unknown): number | null {
  const n = Number(typeof input === "string" ? stripHostile(input) : input);
  if (!Number.isFinite(n) || n < 0 || n > 50) return null;
  return n;
}

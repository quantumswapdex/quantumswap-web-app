/**
 * Display formatting helpers. All numeric formatting goes through the SDK's
 * formatUnits so base-unit bigints render consistently.
 */

import qc from "quantumcoin";

/** Format a base-unit bigint amount as a human string, trimming trailing zeros. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 6): string {
  let s: string;
  try {
    s = qc.formatUnits(value, decimals);
  } catch {
    return "0";
  }
  if (!s.includes(".")) return s;
  const [intPart, fracPart] = s.split(".");
  const trimmedFrac = fracPart.slice(0, maxFrac).replace(/0+$/, "");
  return trimmedFrac.length ? `${intPart}.${trimmedFrac}` : intPart;
}

/** Compact display for large numbers (e.g. reserves): 1.23M, 4.5K. */
export function formatCompact(value: bigint, decimals: number): string {
  let num: number;
  try {
    num = Number(qc.formatUnits(value, decimals));
  } catch {
    return "0";
  }
  if (!Number.isFinite(num)) return "0";
  const abs = Math.abs(num);
  if (abs >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (num / 1e3).toFixed(2) + "K";
  if (abs === 0) return "0";
  if (abs < 0.0001) return "<0.0001";
  return num.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Truncate a 32-byte address for display: 0x1234...abcd. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

/** Format a ratio (number) as a price string with adaptive precision. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.0001) return value.toFixed(6);
  return value.toExponential(2);
}

/** Format a fraction (0..1) as a percentage string. */
export function formatPercent(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return "0%";
  return (fraction * 100).toFixed(digits) + "%";
}

/** Convert a bigint to a 0x-hex wei string for qc_sendTransaction value. */
export function toHexWei(value: bigint): string {
  return "0x" + value.toString(16);
}

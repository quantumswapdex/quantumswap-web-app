/**
 * Hardcoded known-pairs seed loader. The embedded `pairs.json` lets explorers
 * start with zero getPair/metadata calls; entries are validated on load and the
 * live registry (pairRegistry.ts) absorbs user-discovered pairs on top.
 */

import seed from "./pairs.json";
import { sanitizeAddress } from "../lib/sanitize";
import { sanitizeDecimals, sanitizeSymbol } from "../lib/sanitizeResponse";

export interface PairTokenRef {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PairRecord {
  pairAddress: string;
  token0: PairTokenRef;
  token1: PairTokenRef;
  /** True for entries confirmed on-chain during this or a prior session. */
  discovered?: boolean;
}

function validateTokenRef(value: unknown): PairTokenRef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const address = sanitizeAddress(v.address);
  if (!address) return null;
  return {
    address,
    symbol: sanitizeSymbol(v.symbol) || "TKN",
    decimals: sanitizeDecimals(v.decimals),
  };
}

export function validatePairRecord(value: unknown): PairRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const pairAddress = sanitizeAddress(v.pairAddress);
  const token0 = validateTokenRef(v.token0);
  const token1 = validateTokenRef(v.token1);
  if (!pairAddress || !token0 || !token1) return null;
  if (token0.address.toLowerCase() === token1.address.toLowerCase()) return null;
  return { pairAddress, token0, token1, discovered: v.discovered === true };
}

/** Parse + validate the embedded seed. */
export function loadSeedPairs(): PairRecord[] {
  if (!Array.isArray(seed)) return [];
  const out: PairRecord[] = [];
  for (const entry of seed) {
    const record = validatePairRecord(entry);
    if (record) out.push(record);
  }
  return out;
}

import { describe, it, expect, beforeEach } from "vitest";
import { findPairRecord, mergePair, registryStore } from "./pairRegistry";
import type { PairRecord } from "../config/pairs";

const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const PAIR = "0x" + "c".repeat(64);

function record(pairAddress: string, t0: string, t1: string): PairRecord {
  return {
    pairAddress,
    token0: { address: t0, symbol: "T0", decimals: 18 },
    token1: { address: t1, symbol: "T1", decimals: 18 },
    discovered: true,
  };
}

describe("pairRegistry merge/dedupe", () => {
  beforeEach(() => {
    registryStore.set([]);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("adds a new pair", () => {
    mergePair(record(PAIR, A, B));
    expect(registryStore.get()).toHaveLength(1);
    expect(findPairRecord(A, B)?.pairAddress).toBe(PAIR);
  });

  it("dedupes the same pair regardless of token order", () => {
    mergePair(record(PAIR, A, B));
    mergePair(record(PAIR, B, A));
    expect(registryStore.get()).toHaveLength(1);
  });

  it("looks up a pair by either token ordering", () => {
    mergePair(record(PAIR, A, B));
    expect(findPairRecord(A, B)?.pairAddress).toBe(PAIR);
    expect(findPairRecord(B, A)?.pairAddress).toBe(PAIR);
    expect(findPairRecord(A, "0x" + "d".repeat(64))).toBeNull();
  });
});

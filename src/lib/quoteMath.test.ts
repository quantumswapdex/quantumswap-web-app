import { describe, it, expect } from "vitest";
import { DEADLINE_OFFSET_SECONDS } from "../config/chain";
import {
  deadlineFrom,
  getAmountIn,
  getAmountOut,
  maxWithSlippage,
  minWithSlippage,
  priceImpact,
  quote,
} from "./quoteMath";

describe("getAmountOut", () => {
  it("applies the 0.3% fee (matches the constant-product reference numbers)", () => {
    // amountIn 1000, reserves 1e6 / 1e6 -> 996 with fee
    expect(getAmountOut(1000n, 1_000_000n, 1_000_000n)).toBe(996n);
  });

  it("returns 0 for non-positive or empty reserves", () => {
    expect(getAmountOut(0n, 1n, 1n)).toBe(0n);
    expect(getAmountOut(10n, 0n, 1n)).toBe(0n);
    expect(getAmountOut(10n, 1n, 0n)).toBe(0n);
  });
});

describe("getAmountIn", () => {
  it("round-trips approximately with getAmountOut", () => {
    const reserveIn = 5_000_000n;
    const reserveOut = 3_000_000n;
    const out = getAmountOut(10_000n, reserveIn, reserveOut);
    const inNeeded = getAmountIn(out, reserveIn, reserveOut);
    // Should require at least the original input (rounding up).
    expect(inNeeded).toBeGreaterThanOrEqual(10_000n);
    expect(inNeeded).toBeLessThanOrEqual(10_010n);
  });

  it("returns 0 when amountOut exceeds reserves", () => {
    expect(getAmountIn(2_000_000n, 1_000_000n, 1_000_000n)).toBe(0n);
  });
});

describe("quote", () => {
  it("is proportional and fee-free", () => {
    expect(quote(100n, 1000n, 2000n)).toBe(200n);
  });
});

describe("slippage helpers", () => {
  it("reduces the minimum received by the tolerance", () => {
    expect(minWithSlippage(1000n, 0.5)).toBe(995n);
    expect(minWithSlippage(1000n, 1)).toBe(990n);
    expect(minWithSlippage(1000n, 0)).toBe(1000n);
  });

  it("increases the maximum sold by the tolerance", () => {
    expect(maxWithSlippage(1000n, 0.5)).toBe(1005n);
    expect(maxWithSlippage(1000n, 1)).toBe(1010n);
  });
});

describe("deadlineFrom", () => {
  it("adds the fixed offset to the base timestamp", () => {
    expect(deadlineFrom(1_000_000)).toBe(1_000_000n + BigInt(DEADLINE_OFFSET_SECONDS));
  });

  it("falls back to now for invalid base timestamps", () => {
    const before = BigInt(Math.floor(Date.now() / 1000));
    const result = deadlineFrom(0);
    expect(result).toBeGreaterThanOrEqual(before + BigInt(DEADLINE_OFFSET_SECONDS) - 2n);
  });
});

describe("priceImpact", () => {
  it("is near zero for tiny trades and grows for large ones", () => {
    const small = priceImpact(1n, 1_000_000n, 1_000_000n);
    const large = priceImpact(500_000n, 1_000_000n, 1_000_000n);
    expect(small).toBeLessThan(0.01);
    expect(large).toBeGreaterThan(0.2);
  });
});

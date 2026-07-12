/**
 * Pure constant-product (x*y=k) math with the 0.30% fee, plus slippage and
 * deadline helpers. No I/O here so it is fully unit-testable. On-chain quotes
 * still come from the router (getAmountsOut/In); these mirror the formulas for
 * price-impact display and local estimates.
 */

import { DEADLINE_OFFSET_SECONDS } from "../config/chain";

const FEE_NUMERATOR = 997n; // 1000 - 3 (0.30% fee)
const FEE_DENOMINATOR = 1000n;

/** getAmountOut: amount received for `amountIn` given reserves (0.30% fee). */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * FEE_NUMERATOR;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  return numerator / denominator;
}

/** getAmountIn: amount required to receive `amountOut` given reserves. */
export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (amountOut >= reserveOut) return 0n;
  const numerator = reserveIn * amountOut * FEE_DENOMINATOR;
  const denominator = (reserveOut - amountOut) * FEE_NUMERATOR;
  return numerator / denominator + 1n;
}

/** Proportional quote (no fee): amountB for amountA at the current ratio. */
export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (amountA <= 0n || reserveA <= 0n || reserveB <= 0n) return 0n;
  return (amountA * reserveB) / reserveA;
}

/**
 * Apply slippage tolerance to compute a minimum-received (for exact-in) amount.
 * slippagePercent e.g. 0.5 means tolerate 0.5%. Uses basis points to stay in
 * integer math.
 */
export function minWithSlippage(amount: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100)); // percent -> basis points
  if (bps <= 0n) return amount;
  return (amount * (10000n - bps)) / 10000n;
}

/** Apply slippage tolerance to compute a maximum-sold (for exact-out) amount. */
export function maxWithSlippage(amount: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100));
  if (bps <= 0n) return amount;
  return (amount * (10000n + bps)) / 10000n;
}

/**
 * Price impact as a fraction (0..1): how far the executed price deviates from
 * the mid price implied by reserves. Computed in floating point for display.
 */
export function priceImpact(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;
  const out = getAmountOut(amountIn, reserveIn, reserveOut);
  if (out <= 0n) return 0;
  const midPrice = Number(reserveOut) / Number(reserveIn);
  const execPrice = Number(out) / Number(amountIn);
  const impact = 1 - execPrice / midPrice;
  return impact > 0 ? impact : 0;
}

/**
 * Deadline as a unix timestamp (seconds): base time (the latest chain block
 * timestamp) plus the fixed DEADLINE_OFFSET_SECONDS - the QuantumSwap.js
 * pattern (router checks block.timestamp <= deadline).
 */
export function deadlineFrom(baseTimestampSec: number): bigint {
  const base = Number.isFinite(baseTimestampSec) && baseTimestampSec > 0 ? baseTimestampSec : Math.floor(Date.now() / 1000);
  return BigInt(Math.floor(base) + DEADLINE_OFFSET_SECONDS);
}

/** Pool share fraction (0..1) for adding `liquidityMinted` to `totalSupply`. */
export function poolShare(liquidityMinted: bigint, totalSupplyAfter: bigint): number {
  if (totalSupplyAfter <= 0n) return 1;
  return Number(liquidityMinted) / Number(totalSupplyAfter);
}

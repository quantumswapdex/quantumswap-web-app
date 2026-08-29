/**
 * Router-method encoding contract for the swap and remove-liquidity views.
 *
 * Tokens that burn or tax on transfer deliver less than the requested amount,
 * so the router's standard exact-in swaps (which trust the pre-computed
 * amounts) revert with the pair's K check, and plain removeLiquidityETH (which
 * forwards the pre-fee token amount from the router) reverts too. The
 * ...SupportingFeeOnTransferTokens variants derive amounts from actual balance
 * deltas and are equally correct for normal tokens, so the views must encode
 * those. No fee-safe exact-out form exists; the exact-out calls stay as they
 * are.
 *
 * This is a source-shape test: the swap view builds its steps inside a closure
 * that needs a live wallet, so the encoded method names are asserted on the
 * source text instead.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const swapSrc = readFileSync(resolve(__dirname, "swap.ts"), "utf8");
const removeSrc = readFileSync(resolve(__dirname, "removeLiquidity.ts"), "utf8");

function encoded(src: string): string[] {
  return [...src.matchAll(/encodeRouter\("([A-Za-z]+)"/g)].map((m) => m[1]);
}

describe("swap view router encoding", () => {
  it("uses the fee-on-transfer-safe exact-in variants", () => {
    const names = encoded(swapSrc);
    for (const fee of [
      "swapExactETHForTokensSupportingFeeOnTransferTokens",
      "swapExactTokensForETHSupportingFeeOnTransferTokens",
      "swapExactTokensForTokensSupportingFeeOnTransferTokens",
    ]) {
      expect(names, `missing ${fee}`).toContain(fee);
    }
  });

  it("never encodes a standard exact-in swap (they revert for fee-on-transfer inputs)", () => {
    const names = encoded(swapSrc);
    for (const bare of ["swapExactETHForTokens", "swapExactTokensForETH", "swapExactTokensForTokens"]) {
      expect(names, `${bare} must not be encoded`).not.toContain(bare);
    }
  });

  it("keeps the exact-out calls (no fee-safe exact-out exists)", () => {
    const names = encoded(swapSrc);
    for (const exactOut of ["swapETHForExactTokens", "swapTokensForExactETH", "swapTokensForExactTokens"]) {
      expect(names).toContain(exactOut);
    }
  });
});

describe("swap view exact-output guard", () => {
  it("keeps comment lines out of the data assignment", () => {
    expect(swapSrc).not.toMatch(/^\s*data = \/\//m);
    expect(removeSrc).not.toMatch(/^\s*data = \/\//m);
  });

  it("gates exact-out on the fee-on-transfer flag", () => {
    expect(swapSrc).toMatch(/const isExactOut = \(\): boolean =>[^\n]*feeOnTransfer/);
    expect(swapSrc).toContain("setReadonly(");
  });

  it("pre-flights the exact-out call from the account and falls back to exact-in", () => {
    expect(swapSrc).toMatch(/extensionProvider\.call\(\{[^}]*from: account/);
  });
});

describe("remove-liquidity view router encoding", () => {
  it("uses removeLiquidityETHSupportingFeeOnTransferTokens for a WQ side", () => {
    const names = encoded(removeSrc);
    expect(names).toContain("removeLiquidityETHSupportingFeeOnTransferTokens");
    expect(names, "plain removeLiquidityETH reverts for fee-on-transfer tokens").not.toContain(
      "removeLiquidityETH",
    );
    expect(names).toContain("removeLiquidity");
  });
});

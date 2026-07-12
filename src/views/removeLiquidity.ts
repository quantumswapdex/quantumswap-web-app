/**
 * Remove liquidity: percentage slider, estimated token amounts, LP-token
 * approval, and removeLiquidity / removeLiquidityETH.
 */

import qc from "quantumcoin";
import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { card, errText, errorState, loadingState, pageHeader, statRow } from "./shared";
import { showToast } from "../ui/components/toast";
import { ROUTER_ADDRESS, WQ_ADDRESS, type TokenInfo } from "../config/chain";
import { PAIR_ABI, ROUTER_ABI, encodeErc20, encodeRouter, pair as pairContract } from "../lib/contracts";
import { findToken, readTokenMetadata, toPathAddress } from "../tokens/tokenList";
import { sanitizeAddress } from "../lib/sanitize";
import { sanitizeAddressResponse, sanitizeReserves } from "../lib/sanitizeResponse";
import { formatAmount } from "../lib/format";
import { deadlineFrom, minWithSlippage } from "../lib/quoteMath";
import { getLatestBlockTimestamp } from "../lib/extensionProvider";
import { sendTx, waitForReceipt } from "../lib/tx";
import { recordTx } from "../lib/txStore";
import { settingsStore } from "../config/settings";
import { connectWallet, walletStore } from "../wallet/wallet";

export function removeLiquidityView(ctx: RouteContext): ViewResult {
  const pairAddress = sanitizeAddress(ctx.params.pairAddress);
  const container = el("div", { class: "page narrow", style: { maxWidth: "460px" } });

  if (!pairAddress) {
    container.appendChild(pageHeader("Remove liquidity"));
    container.appendChild(errorState("Invalid pair address."));
    return { node: container, theme: "nebula", title: "Remove liquidity" };
  }

  container.appendChild(pageHeader("Remove liquidity"));
  const body = el("div", {});
  container.appendChild(body);
  clear(body);
  body.appendChild(loadingState("Loading position..."));

  let percent = 50;
  let tokenA: TokenInfo | null = null;
  let tokenB: TokenInfo | null = null;
  let reserveA = 0n;
  let reserveB = 0n;
  let totalSupply = 0n;
  let lpBalance = 0n;

  async function load(): Promise<void> {
    const account = walletStore.get().account;
    if (!account) {
      clear(body);
      body.appendChild(
        card(
          el("p", {}, "Connect your wallet to manage this position."),
          el("button", { class: "cta", on: { click: () => void connectWallet() } }, "Connect wallet"),
        ),
      );
      return;
    }
    try {
      const p = pairContract(pairAddress!);
      const [t0Raw, t1Raw, reservesRaw, totalSupplyRaw, balRaw] = await Promise.all([
        p.token0(),
        p.token1(),
        p.getReserves(),
        p.totalSupply(),
        p.balanceOf(account),
      ]);
      const t0 = sanitizeAddressResponse(t0Raw);
      const t1 = sanitizeAddressResponse(t1Raw);
      const parsed = sanitizeReserves(reservesRaw);
      if (!t0 || !t1 || !parsed) throw new Error("Could not read pair state");
      tokenA = await resolveToken(t0);
      tokenB = await resolveToken(t1);
      reserveA = parsed.reserve0;
      reserveB = parsed.reserve1;
      totalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
      lpBalance = typeof balRaw === "bigint" ? balRaw : BigInt(balRaw ?? 0);
      render();
    } catch (err) {
      clear(body);
      body.appendChild(errorState(errText(err)));
    }
  }

  function render(): void {
    clear(body);
    if (!tokenA || !tokenB) return;
    if (lpBalance <= 0n) {
      body.appendChild(card(el("p", {}, "You have no LP tokens for this pair.")));
      return;
    }

    const liquidity = (lpBalance * BigInt(percent)) / 100n;
    const amountA = totalSupply > 0n ? (liquidity * reserveA) / totalSupply : 0n;
    const amountB = totalSupply > 0n ? (liquidity * reserveB) / totalSupply : 0n;

    const percentLabel = el("div", { class: "pct" }, `${percent}%`);
    const slider = el("input", {
      type: "range",
      min: "1",
      max: "100",
      value: String(percent),
      class: "range",
      style: { margin: "10px 0 12px" },
      on: {
        input: (e: Event) => {
          percent = Number((e.target as HTMLInputElement).value);
          render();
        },
      },
    }) as HTMLInputElement;

    const presets = el(
      "div",
      { class: "seg" },
      ...[25, 50, 75, 100].map((v) =>
        el(
          "button",
          { class: `chip${percent === v ? " active" : ""}`, on: { click: () => { percent = v; render(); } } },
          `${v}%`,
        ),
      ),
    );

    body.appendChild(
      card(
        percentLabel,
        slider,
        presets,
        el(
          "div",
          { class: "details", style: { marginTop: "14px" } },
          statRow("LP tokens burned", formatAmount(liquidity, 18, 6)),
          statRow(`You receive ${tokenA.symbol}`, `${formatAmount(amountA, tokenA.decimals, 6)}`),
          statRow(`You receive ${tokenB.symbol}`, `${formatAmount(amountB, tokenB.decimals, 6)}`),
          statRow("Your LP balance", formatAmount(lpBalance, 18, 6)),
        ),
        el("p", { class: "cf-note" }, "The router needs a one-time approval to spend your LP tokens before removing."),
        el(
          "button",
          { class: "dlg-cta", on: { click: () => void doRemove(liquidity, amountA, amountB) } },
          "Approve & remove",
        ),
      ),
    );
  }

  async function doRemove(liquidity: bigint, amountA: bigint, amountB: bigint): Promise<void> {
    const account = walletStore.get().account;
    if (!account || !tokenA || !tokenB || liquidity <= 0n) return;
    const slippage = settingsStore.get().slippagePercent;
    const amountAMin = minWithSlippage(amountA, slippage);
    const amountBMin = minWithSlippage(amountB, slippage);
    const ts = await getLatestBlockTimestamp();
    const deadline = deadlineFrom(ts);

    try {
      // Approve the router to burn the LP tokens.
      await ensureLpApproval(account, liquidity);

      const aAddr = toPathAddress(tokenA);
      const bAddr = toPathAddress(tokenB);
      const aIsWq = aAddr.toLowerCase() === WQ_ADDRESS.toLowerCase();
      const bIsWq = bAddr.toLowerCase() === WQ_ADDRESS.toLowerCase();

      let data: string;
      if (aIsWq || bIsWq) {
        // Return native Q for the WQ side.
        const token = aIsWq ? bAddr : aAddr;
        const tokenMin = aIsWq ? amountBMin : amountAMin;
        const ethMin = aIsWq ? amountAMin : amountBMin;
        data = encodeRouter("removeLiquidityETH", [token, liquidity, tokenMin, ethMin, account, deadline]);
      } else {
        data = encodeRouter("removeLiquidity", [aAddr, bAddr, liquidity, amountAMin, amountBMin, account, deadline]);
      }
      const hash = await sendTx({ to: ROUTER_ADDRESS, data, value: 0n, abi: ROUTER_ABI });
      recordTx(hash, `Remove ${percent}% ${tokenA.symbol}/${tokenB.symbol} liquidity`);
      showToast({ kind: "pending", title: "Removal submitted", link: { href: "#/activity", label: "View activity" }, autoDismissMs: 8000 });
    } catch (err) {
      showToast({ kind: "error", title: "Remove liquidity failed", message: errText(err), autoDismissMs: 7000 });
    }
  }

  async function ensureLpApproval(owner: string, liquidity: bigint): Promise<void> {
    const p = pairContract(pairAddress!);
    const allowanceRaw = await p.allowance(owner, ROUTER_ADDRESS);
    const allowance = typeof allowanceRaw === "bigint" ? allowanceRaw : BigInt(allowanceRaw ?? 0);
    if (allowance >= liquidity) return;
    const toast = showToast({ kind: "pending", title: "Approve LP tokens", message: "Waiting for confirmation." });
    const data = encodeErc20("approve", [ROUTER_ADDRESS, qc.MaxUint256]);
    const hash = await sendTx({ to: pairAddress!, data, value: 0n, abi: PAIR_ABI });
    recordTx(hash, "Approve LP tokens");
    const receipt = await waitForReceipt(hash);
    if (!receipt || receipt.status !== 1) throw new Error("LP approval was not confirmed");
    toast.update({ kind: "success", title: "LP tokens approved" });
  }

  const unsub = walletStore.subscribe(() => void load());
  void load();

  return { node: container, theme: "nebula", title: "Remove liquidity", cleanup: () => unsub() };
}

async function resolveToken(address: string): Promise<TokenInfo> {
  if (address.toLowerCase() === WQ_ADDRESS.toLowerCase()) {
    return findToken(WQ_ADDRESS) ?? { address: WQ_ADDRESS, symbol: "WQ", name: "Wrapped QuantumCoin", decimals: 18 };
  }
  const known = findToken(address);
  if (known) return known;
  try {
    const meta = await readTokenMetadata(address);
    return { address: meta.address, symbol: meta.symbol, name: meta.name, decimals: meta.decimals };
  } catch {
    return { address, symbol: "TKN", name: "Unknown Token", decimals: 18 };
  }
}

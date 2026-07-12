/**
 * Swap view: exact-in quotes via the router, price/impact/min-received, 0.30%
 * fee + route, pair-missing CTA, approve + swap, and native Q <-> WQ wrap/unwrap.
 */

import qc from "quantumcoin";
import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { errText, statRow } from "./shared";
import { createTokenAmountInput } from "../ui/components/tokenAmountInput";
import { flipIcon, gearIcon } from "../ui/components/icons";
import { openSettingsPopover } from "./settingsPopover";
import { showToast } from "../ui/components/toast";
import {
  NATIVE_TOKEN,
  WQ_TOKEN,
  WQ_ADDRESS,
  ROUTER_ADDRESS,
  LP_FEE_BPS,
  type TokenInfo,
} from "../config/chain";
import {
  ERC20_ABI,
  ROUTER_ABI,
  WQ_ABI,
  encodeErc20,
  encodeRouter,
  encodeWq,
  erc20,
  router as routerContract,
} from "../lib/contracts";
import { toPathAddress } from "../tokens/tokenList";
import { parseAmount } from "../lib/sanitize";
import { formatAmount, formatPrice } from "../lib/format";
import { deadlineFrom, minWithSlippage } from "../lib/quoteMath";
import { getLatestBlockTimestamp } from "../lib/extensionProvider";
import { sendTx, waitForReceipt } from "../lib/tx";
import { recordTx } from "../lib/txStore";
import { settingsStore } from "../config/settings";
import { connectWallet, walletStore } from "../wallet/wallet";

export function swapView(): ViewResult {
  let fromToken: TokenInfo = NATIVE_TOKEN;
  let toToken: TokenInfo = WQ_TOKEN;
  let quotedOut = 0n;
  let pairMissing = false;
  let quoteToken = 0; // increments to guard against out-of-order async quotes

  const detailBox = el("div", { class: "details" });
  const actionBox = el("div", {});

  const fromInput = createTokenAmountInput({
    label: "From",
    initialToken: fromToken,
    excludeAddress: () => toToken.address,
    onAmountChange: () => refreshQuote(),
    onTokenChange: (t) => {
      fromToken = t;
      refreshQuote();
    },
  });

  const toInput = createTokenAmountInput({
    label: "To (estimated)",
    initialToken: toToken,
    excludeAddress: () => fromToken.address,
    showMax: false,
    onTokenChange: (t) => {
      toToken = t;
      refreshQuote();
    },
  });
  toInput.setReadonly(true);

  const flipBtn = el(
    "button",
    {
      title: "Flip",
      "aria-label": "Flip tokens",
      on: {
        click: () => {
          const f = fromInput.getToken();
          const t = toInput.getToken();
          fromInput.setToken(t);
          toInput.setToken(f);
          fromToken = t ?? fromToken;
          toToken = f ?? toToken;
          fromInput.setAmount("", true);
          toInput.setAmount("", true);
          refreshQuote();
        },
      },
    },
    flipIcon(18),
  );

  const settingsBtn = el(
    "button",
    {
      class: "gear",
      "aria-label": "Settings",
      "aria-haspopup": "dialog",
      title: "Transaction settings",
      on: { click: (e: Event) => openSettingsPopover(e.currentTarget as HTMLElement) },
    },
    gearIcon(18),
  );

  // Swap-only landing: the card carries its own title, no page header above it.
  const node = el(
    "section",
    { class: "swap-card" },
    el("div", { class: "swap-head" }, el("h1", {}, "Swap"), settingsBtn),
    fromInput.root,
    el("div", { class: "flip" }, flipBtn),
    toInput.root,
    detailBox,
    actionBox,
  );

  const isWrap = (): boolean => Boolean(fromToken.isNative) && toToken.address === WQ_ADDRESS;
  const isUnwrap = (): boolean => fromToken.address === WQ_ADDRESS && Boolean(toToken.isNative);

  async function refreshQuote(): Promise<void> {
    const token = ++quoteToken;
    clear(detailBox);
    pairMissing = false;
    quotedOut = 0n;

    const decimals = fromToken.decimals;
    const amountIn = parseAmount(fromInput.getAmount(), decimals);
    if (amountIn === null || amountIn <= 0n) {
      toInput.setAmount("", true);
      renderAction();
      return;
    }

    // Native Q <-> WQ is a 1:1 wrap/unwrap; no router needed.
    if (isWrap() || isUnwrap()) {
      quotedOut = amountIn;
      toInput.setAmount(formatAmount(amountIn, toToken.decimals, toToken.decimals), true);
      detailBox.appendChild(statRow("Rate", "1 : 1 (wrap/unwrap)"));
      renderAction();
      return;
    }

    if (walletStore.get().status !== "connected") {
      detailBox.appendChild(el("p", { class: "cf-note" }, "Connect your wallet to fetch a live quote."));
      renderAction();
      return;
    }

    const path = [toPathAddress(fromToken), toPathAddress(toToken)];
    try {
      const amounts = (await routerContract().getAmountsOut(amountIn, path)) as unknown as bigint[];
      if (token !== quoteToken) return;
      const out = amounts && amounts.length ? BigInt(amounts[amounts.length - 1]) : 0n;
      quotedOut = out;
      toInput.setAmount(formatAmount(out, toToken.decimals, toToken.decimals), true);

      const price = Number(formatAmount(out, toToken.decimals, 18)) / Number(formatAmount(amountIn, fromToken.decimals, 18));
      const slippage = settingsStore.get().slippagePercent;
      const minOut = minWithSlippage(out, slippage);
      clear(detailBox);
      detailBox.appendChild(statRow("Price", `1 ${fromToken.symbol} = ${formatPrice(price)} ${toToken.symbol}`));
      detailBox.appendChild(statRow("Minimum received", `${formatAmount(minOut, toToken.decimals, 6)} ${toToken.symbol}`));
      detailBox.appendChild(statRow(`LP fee (${(LP_FEE_BPS / 100).toFixed(2)}%)`, `${formatAmount((amountIn * BigInt(LP_FEE_BPS)) / 10000n, fromToken.decimals, 6)} ${fromToken.symbol}`));
      detailBox.appendChild(statRow("Route", path.map((p) => (p === WQ_ADDRESS ? "WQ" : tokenSymbol(p))).join(" \u203a ")));
    } catch (err) {
      if (token !== quoteToken) return;
      pairMissing = true;
      quotedOut = 0n;
      toInput.setAmount("", true);
      clear(detailBox);
      detailBox.appendChild(
        el(
          "div",
          { class: "warn-box", style: { marginTop: "12px" } },
          "No liquidity pool exists for this pair yet. ",
          el(
            "a",
            { class: "link", href: `#/pools/add/${fromToken.address}/${toToken.address}` },
            "Create it / add liquidity",
          ),
          el("p", { style: { marginTop: "4px", fontSize: "11.5px" } }, errText(err)),
        ),
      );
    }
    renderAction();
  }

  function renderAction(): void {
    clear(actionBox);
    const state = walletStore.get();
    if (state.status !== "connected") {
      actionBox.appendChild(
        el("button", { class: "cta", on: { click: () => void connectWallet() } }, "Connect wallet"),
      );
      return;
    }
    const amountIn = parseAmount(fromInput.getAmount(), fromToken.decimals);
    const label = isWrap() ? "Wrap" : isUnwrap() ? "Unwrap" : "Swap";
    const disabled = !amountIn || amountIn <= 0n || (pairMissing && !isWrap() && !isUnwrap()) || (!isWrap() && !isUnwrap() && quotedOut <= 0n);
    actionBox.appendChild(
      el(
        "button",
        {
          class: "cta",
          disabled: disabled ? true : undefined,
          on: { click: () => void doSwap() },
        },
        label,
      ),
    );
  }

  async function doSwap(): Promise<void> {
    const account = walletStore.get().account;
    if (!account) return;
    const amountIn = parseAmount(fromInput.getAmount(), fromToken.decimals);
    if (!amountIn || amountIn <= 0n) return;

    try {
      if (isWrap()) {
        const hash = await sendTx({ to: WQ_ADDRESS, data: encodeWq("deposit", []), value: amountIn, abi: WQ_ABI });
        recordTx(hash, `Wrap ${fromInput.getAmount()} Q`);
        toastSubmitted();
        return;
      }
      if (isUnwrap()) {
        const hash = await sendTx({ to: WQ_ADDRESS, data: encodeWq("withdraw", [amountIn]), value: 0n, abi: WQ_ABI });
        recordTx(hash, `Unwrap ${fromInput.getAmount()} WQ`);
        toastSubmitted();
        return;
      }

      const slippage = settingsStore.get().slippagePercent;
      const minOut = minWithSlippage(quotedOut, slippage);
      const path = [toPathAddress(fromToken), toPathAddress(toToken)];
      const ts = await getLatestBlockTimestamp();
      const deadline = deadlineFrom(ts);

      // Approvals for non-native inputs.
      if (!fromToken.isNative) {
        await ensureApproval(toPathAddress(fromToken), account, amountIn);
      }

      let data: string;
      let value = 0n;
      if (fromToken.isNative) {
        data = encodeRouter("swapExactETHForTokens", [minOut, path, account, deadline]);
        value = amountIn;
      } else if (toToken.isNative) {
        data = encodeRouter("swapExactTokensForETH", [amountIn, minOut, path, account, deadline]);
      } else {
        data = encodeRouter("swapExactTokensForTokens", [amountIn, minOut, path, account, deadline]);
      }

      const hash = await sendTx({ to: ROUTER_ADDRESS, data, value, abi: ROUTER_ABI });
      recordTx(hash, `Swap ${fromInput.getAmount()} ${fromToken.symbol} for ${toToken.symbol}`);
      toastSubmitted();
    } catch (err) {
      showToast({ kind: "error", title: "Swap failed", message: errText(err), autoDismissMs: 7000 });
    }
  }

  async function ensureApproval(tokenAddr: string, owner: string, amount: bigint): Promise<void> {
    const allowanceRaw = await erc20(tokenAddr).allowance(owner, ROUTER_ADDRESS);
    const allowance = typeof allowanceRaw === "bigint" ? allowanceRaw : BigInt(allowanceRaw ?? 0);
    if (allowance >= amount) return;
    const toast = showToast({ kind: "pending", title: "Approval required", message: "Approve the router to spend your token." });
    const data = encodeErc20("approve", [ROUTER_ADDRESS, qc.MaxUint256]);
    const hash = await sendTx({ to: tokenAddr, data, value: 0n, abi: ERC20_ABI });
    recordTx(hash, `Approve ${fromToken.symbol}`);
    toast.update({ kind: "pending", title: "Approving...", message: "Waiting for confirmation." });
    const receipt = await waitForReceipt(hash);
    if (!receipt || receipt.status !== 1) throw new Error("Token approval was not confirmed");
    toast.update({ kind: "success", title: "Approved", message: "Router can now spend your token." });
  }

  function toastSubmitted(): void {
    fromInput.setAmount("", true);
    toInput.setAmount("", true);
    clear(detailBox);
    showToast({
      kind: "pending",
      title: "Transaction submitted",
      message: "Track it in Activity.",
      link: { href: `#/activity`, label: "View activity" },
      autoDismissMs: 8000,
    });
    fromInput.refreshBalance();
    toInput.refreshBalance();
  }

  const unsub = walletStore.subscribe(() => {
    fromInput.refreshBalance();
    toInput.refreshBalance();
    renderAction();
  });

  renderAction();

  return { node, theme: "violet", title: "Swap", cleanup: () => unsub() };
}

function tokenSymbol(pathAddr: string): string {
  return pathAddr === WQ_ADDRESS ? "WQ" : pathAddr.slice(0, 6);
}

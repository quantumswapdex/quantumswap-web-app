/**
 * Swap view: exact-in quotes via the router, price/impact/min-received, 0.30%
 * fee + route, pair-missing CTA, approve + swap, and native Q <-> WQ wrap/unwrap.
 */

import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { approvalStep, errText, statRow } from "./shared";
import { createTokenAmountInput } from "../ui/components/tokenAmountInput";
import { flipIcon, gearIcon } from "../ui/components/icons";
import { openSettingsPopover } from "./settingsPopover";
import { trackTxToast } from "../ui/components/txToast";
import { openTxStepsDialog, type TxStep } from "../ui/components/txSteps";
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
  encodeRouter,
  encodeWq,
} from "../lib/contracts";
import { checkImport, findToken, importToken, toPathAddress } from "../tokens/tokenList";
import { confirmImportToken } from "../tokens/addWarning";
import { findBestRoute } from "../lib/routeFinder";
import { getRegistry } from "../lib/pairRegistry";
import { parseAmount, sanitizeAddress } from "../lib/sanitize";
import { formatAmount, formatPrice } from "../lib/format";
import { deadlineFrom, minWithSlippage } from "../lib/quoteMath";
import { getLatestBlockTimestamp } from "../lib/extensionProvider";
import { sendTx, waitForReceiptSuccess } from "../lib/tx";
import { onTxSettled, recordTx } from "../lib/txStore";
import { settingsStore } from "../config/settings";
import { connectWallet, walletStore } from "../wallet/wallet";

export function swapView(ctx: RouteContext): ViewResult {
  const fromParam = (ctx.params.from ?? ctx.query.get("from") ?? "").trim();
  const toParam = (ctx.params.to ?? ctx.query.get("to") ?? "").trim();
  let fromToken: TokenInfo = resolveParamSync(fromParam) ?? NATIVE_TOKEN;
  let toToken: TokenInfo = resolveParamSync(toParam) ?? WQ_TOKEN;
  // Avoid both sides resolving to the same token; keep the "to" side distinct.
  if (fromToken.address === toToken.address) {
    toToken = fromToken.address === WQ_TOKEN.address ? NATIVE_TOKEN : WQ_TOKEN;
  }
  let quotedOut = 0n;
  let pairMissing = false;
  let routePath: string[] = []; // best multi-hop path from the last successful quote
  let quoteToken = 0; // increments to guard against out-of-order async quotes
  let submitting = false; // locks the CTA while the extension is signing/submitting
  let routeImportAttempted = false; // gates the deep-link import-once

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
      syncUrl();
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
      syncUrl();
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
          // Carry the estimated "To" value over as the new "From" amount so
          // the form repopulates and re-quotes in the flipped direction.
          const prevToAmount = toInput.getAmount();
          const f = fromInput.getToken();
          const t = toInput.getToken();
          fromInput.setToken(t);
          toInput.setToken(f);
          fromToken = t ?? fromToken;
          toToken = f ?? toToken;
          fromInput.setAmount(prevToAmount, true);
          toInput.setAmount("", true);
          refreshQuote();
          syncUrl();
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
    routePath = [];

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

    try {
      const route = await findBestRoute(amountIn, fromToken, toToken, 5);
      if (token !== quoteToken) return;
      if (!route || route.out <= 0n) throw new Error("No route found");
      routePath = route.path;
      const out = route.out;
      quotedOut = out;
      toInput.setAmount(formatAmount(out, toToken.decimals, toToken.decimals), true);

      const price = Number(formatAmount(out, toToken.decimals, 18)) / Number(formatAmount(amountIn, fromToken.decimals, 18));
      const slippage = settingsStore.get().slippagePercent;
      const minOut = minWithSlippage(out, slippage);
      const hops = route.path.length - 1;
      clear(detailBox);
      detailBox.appendChild(statRow("Price", `1 ${fromToken.symbol} = ${formatPrice(price)} ${toToken.symbol}`));
      detailBox.appendChild(statRow("Minimum received", `${formatAmount(minOut, toToken.decimals, 6)} ${toToken.symbol}`));
      detailBox.appendChild(statRow(`LP fee (${(LP_FEE_BPS / 100).toFixed(2)}% / hop)`, `${formatAmount((amountIn * BigInt(LP_FEE_BPS)) / 10000n, fromToken.decimals, 6)} ${fromToken.symbol}`));
      detailBox.appendChild(statRow("Route", `${route.path.map((p) => tokenSymbol(p)).join(" \u203a ")} \u00b7 ${hops} hop${hops > 1 ? "s" : ""}`));
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
    const disabled = submitting || !amountIn || amountIn <= 0n || (pairMissing && !isWrap() && !isUnwrap()) || (!isWrap() && !isUnwrap() && quotedOut <= 0n);
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

  function doSwap(): void {
    const account = walletStore.get().account;
    if (!account) return;
    const amountIn = parseAmount(fromInput.getAmount(), fromToken.decimals);
    if (!amountIn || amountIn <= 0n) return;

    submitting = true;
    renderAction();
    openTxStepsDialog({
      title: isWrap() ? "Wrap" : isUnwrap() ? "Unwrap" : "Swap",
      buildSteps: () => buildSwapSteps(account, amountIn),
      onClose: () => {
        submitting = false;
        renderAction();
      },
    });
  }

  async function buildSwapSteps(account: string, amountIn: bigint): Promise<TxStep[]> {
    if (isWrap()) {
      const amount = fromInput.getAmount();
      return [
        {
          label: "Wrap",
          run: async (onAccepted) => {
            const hash = await sendTx({ to: WQ_ADDRESS, data: encodeWq("deposit", []), value: amountIn, abi: WQ_ABI });
            recordTx(hash, `Wrap ${amount} Q`);
            trackTxToast(hash, "wrap", { pending: "Wrapping", success: "Wrap complete", failure: "Wrap failed" }, `${amount} Q \u2192 WQ`);
            onAccepted(hash);
            await waitForReceiptSuccess(hash);
            onSubmitted(hash);
          },
        },
      ];
    }
    if (isUnwrap()) {
      const amount = fromInput.getAmount();
      return [
        {
          label: "Unwrap",
          run: async (onAccepted) => {
            const hash = await sendTx({ to: WQ_ADDRESS, data: encodeWq("withdraw", [amountIn]), value: 0n, abi: WQ_ABI });
            recordTx(hash, `Unwrap ${amount} WQ`);
            trackTxToast(hash, "wrap", { pending: "Unwrapping", success: "Unwrap complete", failure: "Unwrap failed" }, `${amount} WQ \u2192 Q`);
            onAccepted(hash);
            await waitForReceiptSuccess(hash);
            onSubmitted(hash);
          },
        },
      ];
    }

    const steps: TxStep[] = [];
    if (!fromToken.isNative) {
      const ap = await approvalStep({
        tokenAddr: toPathAddress(fromToken),
        symbol: fromToken.symbol,
        abi: ERC20_ABI,
        owner: account,
        amount: amountIn,
      });
      if (ap) steps.push(ap);
    }
    steps.push({
      label: "Swap",
      run: async (onAccepted) => {
        const slippage = settingsStore.get().slippagePercent;
        const minOut = minWithSlippage(quotedOut, slippage);
        const path = routePath.length >= 2 ? [...routePath] : [toPathAddress(fromToken), toPathAddress(toToken)];
        const ts = await getLatestBlockTimestamp();
        const deadline = deadlineFrom(ts);
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
        const amount = fromInput.getAmount();
        const outAmount = toInput.getAmount();
        const hash = await sendTx({ to: ROUTER_ADDRESS, data, value, abi: ROUTER_ABI });
        recordTx(hash, `Swap ${amount} ${fromToken.symbol} for ${toToken.symbol}`);
        trackTxToast(
          hash,
          "swap",
          { pending: "Swapping", success: "Swap complete", failure: "Swap failed" },
          `${amount} ${fromToken.symbol} \u2192 ${outAmount ? `~${outAmount} ` : ""}${toToken.symbol}`,
        );
        onAccepted(hash);
        await waitForReceiptSuccess(hash);
        onSubmitted(hash);
      },
    });
    return steps;
  }

  /** Clear the form after a submitted tx; the status toast is handled per action. */
  function onSubmitted(hash: string): void {
    fromInput.setAmount("", true);
    toInput.setAmount("", true);
    clear(detailBox);
    fromInput.refreshBalance();
    toInput.refreshBalance();
    // Refresh balances again once the tx settles on-chain.
    onTxSettled(hash, () => {
      fromInput.refreshBalance();
      toInput.refreshBalance();
    });
  }

  // Deep-link auto-populate: if from/to were passed in the route but refer to
  // tokens not yet imported, prompt the user to import (at their own risk) and
  // only then populate the selector. Runs once, after the wallet connects.
  function applyFrom(t: TokenInfo): void {
    if (t.address === toToken.address) return;
    fromInput.setToken(t);
    fromToken = t;
    refreshQuote();
  }
  function applyTo(t: TokenInfo): void {
    if (t.address === fromToken.address) return;
    toInput.setToken(t);
    toToken = t;
    refreshQuote();
  }
  // Reflect the current from/to tokens in the address bar + history so the
  // browser back button can return to a previous pair. Uses pushState (no
  // hashchange event), so the live view/amount is not torn down on each change.
  function syncUrl(): void {
    const target = `#/swap/${tokenToUrlAddr(fromToken)}/${tokenToUrlAddr(toToken)}`;
    if (location.hash === target) return;
    try {
      history.pushState({ qsSwapRoute: target }, "", target);
    } catch {
      /* sandboxed or history unavailable - URL sync is best-effort */
    }
  }
  function tryRouteImport(): void {
    if (routeImportAttempted) return;
    if (walletStore.get().status !== "connected") return;
    routeImportAttempted = true;
    void maybeImportFromRoute();
  }
  async function maybeImportFromRoute(): Promise<void> {
    const tasks: { addr: string; apply: (t: TokenInfo) => void }[] = [];
    if (fromParam && !resolveParamSync(fromParam)) {
      const a = sanitizeAddress(fromParam);
      if (a) tasks.push({ addr: a, apply: applyFrom });
    }
    if (toParam && !resolveParamSync(toParam)) {
      const a = sanitizeAddress(toParam);
      if (a) tasks.push({ addr: a, apply: applyTo });
    }
    const imported = new Map<string, TokenInfo>();
    for (const { addr, apply } of tasks) {
      let token: TokenInfo | null = imported.get(addr.toLowerCase()) ?? null;
      if (!token) {
        token = await importUnrecognized(addr);
        if (!token) continue;
        imported.set(addr.toLowerCase(), token);
      }
      apply(token);
    }
    // Sync the URL once after the import flow so a declined/failed import
    // updates the address bar to match what's actually shown (a single history
    // entry, not one per applied token).
    syncUrl();
  }

  const unsub = walletStore.subscribe(() => {
    fromInput.refreshBalance();
    toInput.refreshBalance();
    renderAction();
    tryRouteImport();
  });

  renderAction();
  tryRouteImport();

  return { node, theme: "violet", title: "Swap", cleanup: () => unsub() };
}

function tokenSymbol(pathAddr: string): string {
  const a = pathAddr.toLowerCase();
  const known = findToken(a);
  if (known) return known.symbol;
  // Fall back to symbols recorded in the pair registry (e.g. discovered pairs
  // whose tokens the user hasn't imported).
  for (const rec of getRegistry()) {
    if (rec.token0.address.toLowerCase() === a) return rec.token0.symbol || shortAddr(a);
    if (rec.token1.address.toLowerCase() === a) return rec.token1.symbol || shortAddr(a);
  }
  return shortAddr(a);
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

/** Token -> URL segment: the native coin is represented as "native" (not the
 * "native:Q" sentinel) for clean, shareable deep links. */
function tokenToUrlAddr(t: TokenInfo): string {
  return t.isNative ? "native" : t.address;
}

/**
 * Resolve a route/query token param to a known TokenInfo (built-in, imported,
 * or the native sentinel). Returns null for unrecognized addresses so the
 * caller can decide whether to prompt for import. Synchronous: only matches
 * tokens already in the list.
 */
function resolveParamSync(param: string): TokenInfo | null {
  if (!param) return null;
  const low = param.toLowerCase();
  if (low === NATIVE_TOKEN.address || low === "native" || low === "q") return NATIVE_TOKEN;
  const addr = sanitizeAddress(param);
  if (!addr) return null;
  return findToken(addr);
}

/**
 * Look up an unrecognized token on-chain, show the mandatory "import at your
 * own risk" acknowledgement, and import it only if the user confirms. Returns
 * the imported token, or null if lookup failed or the user declined.
 */
async function importUnrecognized(addr: string): Promise<TokenInfo | null> {
  if (walletStore.get().status !== "connected") return null;
  const check = await checkImport(addr);
  if (!check.ok || !check.token) return null;
  const confirmed = await confirmImportToken(check.token);
  if (!confirmed) return null;
  return importToken(check.token);
}

/**
 * Add liquidity (and create pair on first deposit). Autofills the second amount
 * from the pool's reserve ratio, shows pool share + first-provider notice, does
 * dual approvals, and calls addLiquidity / addLiquidityETH.
 */

import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { approvalStep, statRow } from "./shared";
import { createTokenAmountInput } from "../ui/components/tokenAmountInput";
import { gearIcon } from "../ui/components/icons";
import { openSettingsPopover } from "./settingsPopover";
import { trackTxToast } from "../ui/components/txToast";
import { openTxStepsDialog, type TxStep } from "../ui/components/txSteps";
import { NATIVE_TOKEN, ROUTER_ADDRESS, WQ_TOKEN, type TokenInfo } from "../config/chain";
import { ERC20_ABI, ROUTER_ABI, encodeRouter, pair as pairContract } from "../lib/contracts";
import { findToken, toPathAddress } from "../tokens/tokenList";
import { parseAmount, sanitizeAddress } from "../lib/sanitize";
import { formatAmount, formatPercent } from "../lib/format";
import { deadlineFrom, minWithSlippage, quote } from "../lib/quoteMath";
import { sanitizeReserves, sanitizeAddressResponse } from "../lib/sanitizeResponse";
import { getLatestBlockTimestamp } from "../lib/extensionProvider";
import { sendTx, waitForReceiptSuccess } from "../lib/tx";
import { onTxSettled, recordTx } from "../lib/txStore";
import { settingsStore } from "../config/settings";
import { connectWallet, walletStore } from "../wallet/wallet";
import { resolvePairAddress } from "../lib/pairRegistry";

export function addLiquidityView(ctx: RouteContext): ViewResult {
  let tokenA: TokenInfo = resolveParam(ctx.params.tokenA) ?? NATIVE_TOKEN;
  let tokenB: TokenInfo = resolveParam(ctx.params.tokenB) ?? WQ_TOKEN;
  let reserves: { reserveA: bigint; reserveB: bigint } | null = null;
  let pairAddress: string | null = null;
  let totalSupply = 0n;
  let lastEdited: "A" | "B" = "A";
  let submitting = false; // locks the CTA while the extension is signing/submitting

  const noticeBox = el("div", {});
  const detailBox = el("div", { class: "details" });
  const actionBox = el("div", {});

  const inputA = createTokenAmountInput({
    label: "Token A",
    initialToken: tokenA,
    excludeAddress: () => tokenB.address,
    onAmountChange: () => {
      lastEdited = "A";
      autofill();
    },
    onTokenChange: (t) => {
      tokenA = t;
      void loadPair();
    },
  });

  const inputB = createTokenAmountInput({
    label: "Token B",
    initialToken: tokenB,
    excludeAddress: () => tokenA.address,
    onAmountChange: () => {
      lastEdited = "B";
      autofill();
    },
    onTokenChange: (t) => {
      tokenB = t;
      void loadPair();
    },
  });

  const settingsBtn = el(
    "button",
    { class: "gear", "aria-label": "Settings", title: "Transaction settings", on: { click: (e: Event) => openSettingsPopover(e.currentTarget as HTMLElement) } },
    gearIcon(18),
  );

  const node = el(
    "section",
    { class: "swap-card" },
    el("div", { class: "swap-head" }, el("h1", {}, "Add liquidity"), settingsBtn),
    inputA.root,
    el("div", { class: "io-plus" }, "+"),
    inputB.root,
    noticeBox,
    detailBox,
    actionBox,
  );

  async function loadPair(): Promise<void> {
    reserves = null;
    pairAddress = null;
    totalSupply = 0n;
    clear(noticeBox);
    clear(detailBox);
    if (walletStore.get().status !== "connected") {
      renderAction();
      return;
    }
    try {
      pairAddress = await resolvePairAddress(tokenA, tokenB);
      if (pairAddress) {
        const p = pairContract(pairAddress);
        const [reservesRaw, token0Raw, totalSupplyRaw] = await Promise.all([
          p.getReserves(),
          p.token0(),
          p.totalSupply(),
        ]);
        const parsed = sanitizeReserves(reservesRaw);
        const token0 = sanitizeAddressResponse(token0Raw);
        totalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
        if (parsed && token0) {
          const aIsToken0 = toPathAddress(tokenA).toLowerCase() === token0.toLowerCase();
          reserves = aIsToken0
            ? { reserveA: parsed.reserve0, reserveB: parsed.reserve1 }
            : { reserveA: parsed.reserve1, reserveB: parsed.reserve0 };
          if (reserves.reserveA === 0n && reserves.reserveB === 0n) reserves = null;
        }
      }
    } catch {
      /* treat as new pair */
    }
    if (!reserves) {
      noticeBox.appendChild(
        el(
          "div",
          { class: "warn-box", style: { marginTop: "12px" } },
          "You are the first liquidity provider. The ratio of tokens you add sets the initial price.",
        ),
      );
    }
    autofill();
    renderAction();
  }

  function autofill(): void {
    if (!reserves) {
      updateDetails();
      renderAction();
      return;
    }
    if (lastEdited === "A") {
      const amountA = parseAmount(inputA.getAmount(), tokenA.decimals);
      if (amountA && amountA > 0n) {
        const amountB = quote(amountA, reserves.reserveA, reserves.reserveB);
        inputB.setAmount(formatAmount(amountB, tokenB.decimals, tokenB.decimals), true);
      }
    } else {
      const amountB = parseAmount(inputB.getAmount(), tokenB.decimals);
      if (amountB && amountB > 0n) {
        const amountA = quote(amountB, reserves.reserveB, reserves.reserveA);
        inputA.setAmount(formatAmount(amountA, tokenA.decimals, tokenA.decimals), true);
      }
    }
    updateDetails();
    renderAction();
  }

  function updateDetails(): void {
    clear(detailBox);
    const amountA = parseAmount(inputA.getAmount(), tokenA.decimals);
    const amountB = parseAmount(inputB.getAmount(), tokenB.decimals);
    if (!amountA || !amountB || amountA <= 0n || amountB <= 0n) return;

    if (reserves && reserves.reserveA > 0n) {
      const price = Number(formatAmount(reserves.reserveB, tokenB.decimals, 18)) / Number(formatAmount(reserves.reserveA, tokenA.decimals, 18));
      detailBox.appendChild(statRow(`${tokenA.symbol} price`, `${price.toFixed(6)} ${tokenB.symbol}`));
      // Pool share estimate: minted ~ amountA/reserveA * totalSupply.
      if (totalSupply > 0n) {
        const minted = (amountA * totalSupply) / reserves.reserveA;
        const share = Number(minted) / Number(totalSupply + minted);
        detailBox.appendChild(statRow("Share of pool", formatPercent(share)));
      }
    } else {
      detailBox.appendChild(statRow("Initial price", `${(Number(formatAmount(amountB, tokenB.decimals, 18)) / Number(formatAmount(amountA, tokenA.decimals, 18))).toFixed(6)} ${tokenB.symbol}/${tokenA.symbol}`));
      detailBox.appendChild(statRow("Share of pool", "100%"));
    }
  }

  function renderAction(): void {
    clear(actionBox);
    if (walletStore.get().status !== "connected") {
      actionBox.appendChild(el("button", { class: "cta", on: { click: () => void connectWallet() } }, "Connect wallet"));
      return;
    }
    const amountA = parseAmount(inputA.getAmount(), tokenA.decimals);
    const amountB = parseAmount(inputB.getAmount(), tokenB.decimals);
    const disabled = submitting || !amountA || !amountB || amountA <= 0n || amountB <= 0n;
    actionBox.appendChild(
      el("button", { class: "cta", disabled: disabled ? true : undefined, on: { click: () => void doAdd() } }, reserves ? "Add liquidity" : "Create pair & add"),
    );
  }

  function doAdd(): void {
    const account = walletStore.get().account;
    if (!account) return;
    const amountA = parseAmount(inputA.getAmount(), tokenA.decimals);
    const amountB = parseAmount(inputB.getAmount(), tokenB.decimals);
    if (!amountA || !amountB || amountA <= 0n || amountB <= 0n) return;

    submitting = true;
    renderAction();
    openTxStepsDialog({
      title: "Add liquidity",
      buildSteps: () => buildAddSteps(account, amountA, amountB),
      onClose: () => {
        submitting = false;
        renderAction();
      },
    });
  }

  async function buildAddSteps(account: string, amountA: bigint, amountB: bigint): Promise<TxStep[]> {
    const steps: TxStep[] = [];

    if (tokenA.isNative || tokenB.isNative) {
      const nativeIsA = Boolean(tokenA.isNative);
      const token = nativeIsA ? tokenB : tokenA;
      const tokenAmount = nativeIsA ? amountB : amountA;
      const nativeAmount = nativeIsA ? amountA : amountB;
      const slippage = settingsStore.get().slippagePercent;
      const tokenAmountMin = minWithSlippage(tokenAmount, slippage);
      const nativeAmountMin = minWithSlippage(nativeAmount, slippage);
      const ap = await approvalStep({ tokenAddr: toPathAddress(token), symbol: token.symbol, abi: ERC20_ABI, owner: account, amount: tokenAmount });
      if (ap) steps.push(ap);
      steps.push({
        label: "Add liquidity",
        run: async (onAccepted) => {
          const ts = await getLatestBlockTimestamp();
          const deadline = deadlineFrom(ts);
          const summary = `${inputA.getAmount()} ${tokenA.symbol} + ${inputB.getAmount()} ${tokenB.symbol}`;
          const data = encodeRouter("addLiquidityETH", [toPathAddress(token), tokenAmount, tokenAmountMin, nativeAmountMin, account, deadline]);
          const hash = await sendTx({ to: ROUTER_ADDRESS, data, value: nativeAmount, abi: ROUTER_ABI });
          recordTx(hash, `Add ${summary}`);
          trackTxToast(hash, "liquidity", { pending: "Adding liquidity", success: "Liquidity added", failure: "Add liquidity failed" }, summary);
          onAccepted(hash);
          await waitForReceiptSuccess(hash);
          onSubmitted(hash);
        },
      });
      return steps;
    }

    const apA = await approvalStep({ tokenAddr: toPathAddress(tokenA), symbol: tokenA.symbol, abi: ERC20_ABI, owner: account, amount: amountA });
    if (apA) steps.push(apA);
    const apB = await approvalStep({ tokenAddr: toPathAddress(tokenB), symbol: tokenB.symbol, abi: ERC20_ABI, owner: account, amount: amountB });
    if (apB) steps.push(apB);
    steps.push({
      label: "Add liquidity",
      run: async (onAccepted) => {
        const slippage = settingsStore.get().slippagePercent;
        const amountAMin = minWithSlippage(amountA, slippage);
        const amountBMin = minWithSlippage(amountB, slippage);
        const ts = await getLatestBlockTimestamp();
        const deadline = deadlineFrom(ts);
        const summary = `${inputA.getAmount()} ${tokenA.symbol} + ${inputB.getAmount()} ${tokenB.symbol}`;
        const data = encodeRouter("addLiquidity", [toPathAddress(tokenA), toPathAddress(tokenB), amountA, amountB, amountAMin, amountBMin, account, deadline]);
        const hash = await sendTx({ to: ROUTER_ADDRESS, data, value: 0n, abi: ROUTER_ABI });
        recordTx(hash, `Add ${summary}`);
        trackTxToast(hash, "liquidity", { pending: "Adding liquidity", success: "Liquidity added", failure: "Add liquidity failed" }, summary);
        onAccepted(hash);
        await waitForReceiptSuccess(hash);
        onSubmitted(hash);
      },
    });
    return steps;
  }

  /** Clear the form after a submitted tx; the status toast is handled per action. */
  function onSubmitted(hash: string): void {
    inputA.setAmount("", true);
    inputB.setAmount("", true);
    clear(detailBox);
    inputA.refreshBalance();
    inputB.refreshBalance();
    // Once the tx settles on-chain, reload the pool state so reserves, share,
    // the first-provider notice, and the CTA label reflect the new pair state.
    onTxSettled(hash, () => {
      void loadPair();
      inputA.refreshBalance();
      inputB.refreshBalance();
    });
  }

  const unsub = walletStore.subscribe(() => {
    inputA.refreshBalance();
    inputB.refreshBalance();
    renderAction();
  });

  void loadPair();

  return { node, theme: "nebula", title: "Add liquidity", cleanup: () => unsub() };
}

function resolveParam(param?: string): TokenInfo | null {
  if (!param) return null;
  if (param === NATIVE_TOKEN.address) return NATIVE_TOKEN;
  const addr = sanitizeAddress(param);
  if (!addr) return null;
  return findToken(addr);
}

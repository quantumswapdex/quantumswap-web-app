/** Explicit pair creation via the factory (advanced; no initial liquidity). */

import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { chevronDownIcon, coinIcon } from "../ui/components/icons";
import { trackTxToast } from "../ui/components/txToast";
import { openTxStepsDialog, type TxStep } from "../ui/components/txSteps";
import { DEFAULT_PAIR_TOKEN_A, DEFAULT_PAIR_TOKEN_B, NATIVE_TOKEN, type TokenInfo } from "../config/chain";
import { factoryAddress } from "../config/releases";
import { FACTORY_ABI, encodeFactory } from "../lib/contracts";
import { openTokenSelector } from "../tokens/tokenSelector";
import { findToken, toPathAddress } from "../tokens/tokenList";
import { sanitizeAddress } from "../lib/sanitize";
import { sendTx, waitForReceiptSuccess } from "../lib/tx";
import { recordTx } from "../lib/txStore";
import { connectWallet, walletStore } from "../wallet/wallet";
import { resolvePairAddress } from "../lib/pairRegistry";

export function createPairView(ctx: RouteContext): ViewResult {
  let tokenA: TokenInfo | null = resolveParam(ctx.params.tokenA) ?? DEFAULT_PAIR_TOKEN_A;
  let tokenB: TokenInfo | null = resolveParam(ctx.params.tokenB) ?? DEFAULT_PAIR_TOKEN_B;
  // Avoid both sides resolving to the same token (e.g. deep link to only tokenA).
  if (tokenA.address === tokenB.address) {
    tokenB = tokenA.address === DEFAULT_PAIR_TOKEN_B.address ? DEFAULT_PAIR_TOKEN_A : DEFAULT_PAIR_TOKEN_B;
  }
  let submitting = false; // locks the CTA while the extension is signing/submitting

  const status = el("div", { class: "dd-status", style: { marginTop: "10px" } });
  const actionBox = el("div", {});

  const selectA = selectorButton("Token A", () => tokenA, (t) => {
    tokenA = t;
    render();
  });
  const selectB = selectorButton("Token B", () => tokenB, (t) => {
    tokenB = t;
    render();
  });

  const node = el(
    "section",
    { class: "swap-card" },
    el("div", { class: "swap-head" }, el("h1", {}, "Create a pair")),
    selectA.root,
    el("div", { class: "io-plus" }, "+"),
    selectB.root,
    el("p", { class: "cf-note" }, "This creates a new empty pair via the factory. The first liquidity deposit sets the initial price. A pair for these tokens must not already exist."),
    status,
    actionBox,
  );

  async function render(): Promise<void> {
    selectA.refresh();
    selectB.refresh();
    clear(actionBox);
    clear(status);

    if (walletStore.get().status !== "connected") {
      actionBox.appendChild(el("button", { class: "cta", on: { click: () => void connectWallet() } }, "Connect wallet"));
      return;
    }
    if (!tokenA || !tokenB || tokenA.address === tokenB.address) {
      status.textContent = "Select two different tokens.";
      return;
    }

    const create = el(
      "button",
      { class: "cta", disabled: submitting ? true : undefined, on: { click: () => void doCreate() } },
      "Create pair",
    );
    actionBox.appendChild(create);

    // Warn if it already exists.
    try {
      const existing = await resolvePairAddress(tokenA, tokenB);
      if (existing) {
        clear(status);
        status.appendChild(
          el(
            "div",
            { class: "warn-box" },
            el("div", { class: "warn-title" }, "A pair already exists for these tokens"),
            el(
              "p",
              {},
              "You cannot create it again. ",
              el("a", { class: "link", href: `#/pools/add/${tokenA.address}/${tokenB.address}` }, "Add liquidity to the existing pair"),
              ".",
            ),
          ),
        );
        create.setAttribute("disabled", "");
      }
    } catch {
      /* ignore */
    }
  }

  function doCreate(): void {
    if (!tokenA || !tokenB) return;
    submitting = true;
    void render();
    openTxStepsDialog({
      title: "Create pair",
      buildSteps: () => buildCreateSteps(),
      onClose: () => {
        submitting = false;
        void render();
      },
    });
  }

  async function buildCreateSteps(): Promise<TxStep[]> {
    if (!tokenA || !tokenB) return [];
    return [
      {
        label: "Create pair",
        run: async (onAccepted) => {
          const data = encodeFactory("createPair", [toPathAddress(tokenA!), toPathAddress(tokenB!)]);
          const hash = await sendTx({ to: factoryAddress(), data, value: 0n, abi: FACTORY_ABI });
          recordTx(hash, `Create pair ${tokenA!.symbol}/${tokenB!.symbol}`);
          trackTxToast(
            hash,
            "pair",
            { pending: "Creating pair", success: "Pair created", failure: "Create pair failed" },
            `${tokenA!.symbol}/${tokenB!.symbol}`,
          );
          onAccepted(hash);
          await waitForReceiptSuccess(hash);
          // Re-render so the "pair already exists" state and CTA reflect the
          // on-chain result.
          void render();
        },
      },
    ];
  }

  const unsub = walletStore.subscribe(() => void render());
  void render();

  return { node, theme: "nebula", title: "Create a pair", cleanup: () => unsub() };
}

function resolveParam(param?: string): TokenInfo | null {
  if (!param) return null;
  if (param === NATIVE_TOKEN.address) return NATIVE_TOKEN;
  const addr = sanitizeAddress(param);
  if (!addr) return null;
  return findToken(addr);
}

function selectorButton(label: string, get: () => TokenInfo | null, set: (t: TokenInfo) => void) {
  const coinWrap = el("span", { class: "coin" });
  const symbolEl = el("span", { class: "tsym" }, get()?.symbol ?? "Select");
  const tokenBtn = el(
    "button",
    {
      class: "token",
      "aria-haspopup": "listbox",
      on: { click: () => openTokenSelector({ excludeAddress: undefined, onSelect: set }) },
    },
    coinWrap,
    symbolEl,
    chevronDownIcon(14, "chev"),
  );
  const root = el(
    "div",
    { class: "io-box" },
    el("div", { class: "io-top" }, el("span", { class: "label" }, label)),
    el("div", { class: "io-body" }, el("div", { class: "token-wrap" }, tokenBtn)),
  );
  const refresh = (): void => {
    const t = get();
    symbolEl.textContent = t?.symbol ?? "Select";
    coinWrap.replaceChildren();
    if (t) coinWrap.appendChild(coinIcon(t.symbol, 24));
  };
  refresh();
  return { root, refresh };
}

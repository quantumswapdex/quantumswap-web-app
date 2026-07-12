/** Explicit pair creation via the factory (advanced; no initial liquidity). */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { errText } from "./shared";
import { chevronDownIcon, coinIcon } from "../ui/components/icons";
import { showToast } from "../ui/components/toast";
import { NATIVE_TOKEN, WQ_TOKEN, FACTORY_ADDRESS, type TokenInfo } from "../config/chain";
import { FACTORY_ABI, encodeFactory } from "../lib/contracts";
import { openTokenSelector } from "../tokens/tokenSelector";
import { toPathAddress } from "../tokens/tokenList";
import { sendTx } from "../lib/tx";
import { recordTx } from "../lib/txStore";
import { connectWallet, walletStore } from "../wallet/wallet";
import { resolvePairAddress } from "../lib/pairRegistry";

export function createPairView(): ViewResult {
  let tokenA: TokenInfo | null = NATIVE_TOKEN;
  let tokenB: TokenInfo | null = WQ_TOKEN;

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
      { class: "cta", on: { click: () => void doCreate() } },
      "Create pair",
    );
    actionBox.appendChild(create);

    // Warn if it already exists.
    try {
      const existing = await resolvePairAddress(tokenA, tokenB);
      if (existing) {
        status.textContent = "A pair already exists for these tokens. ";
        status.appendChild(el("a", { class: "link", href: `#/pools/add/${tokenA.address}/${tokenB.address}` }, "Add liquidity"));
        create.setAttribute("disabled", "");
      }
    } catch {
      /* ignore */
    }
  }

  async function doCreate(): Promise<void> {
    if (!tokenA || !tokenB) return;
    try {
      const data = encodeFactory("createPair", [toPathAddress(tokenA), toPathAddress(tokenB)]);
      const hash = await sendTx({ to: FACTORY_ADDRESS, data, value: 0n, abi: FACTORY_ABI });
      recordTx(hash, `Create pair ${tokenA.symbol}/${tokenB.symbol}`);
      showToast({ kind: "pending", title: "Pair creation submitted", link: { href: "#/activity", label: "View activity" }, autoDismissMs: 8000 });
    } catch (err) {
      showToast({ kind: "error", title: "Create pair failed", message: errText(err), autoDismissMs: 7000 });
    }
  }

  const unsub = walletStore.subscribe(() => void render());
  void render();

  return { node, theme: "nebula", title: "Create a pair", cleanup: () => unsub() };
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

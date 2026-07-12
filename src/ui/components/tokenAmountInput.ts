/**
 * Token + amount io-box matching the preview markup: label + balance/MAX on
 * top, token button (coin icon + symbol + chevron) left, right-aligned amount
 * input. Used by swap and liquidity views.
 */

import { el } from "../dom";
import { chevronDownIcon, coinIcon } from "./icons";
import type { TokenInfo } from "../../config/chain";
import { formatAmount } from "../../lib/format";
import { sanitizeAmountString } from "../../lib/sanitize";
import { readTokenBalance } from "../../tokens/tokenList";
import { openTokenSelector } from "../../tokens/tokenSelector";
import { walletStore } from "../../wallet/wallet";

export interface TokenAmountInput {
  root: HTMLElement;
  getToken: () => TokenInfo | null;
  setToken: (token: TokenInfo | null) => void;
  getAmount: () => string;
  setAmount: (value: string, silent?: boolean) => void;
  getBalance: () => bigint;
  refreshBalance: () => void;
  setReadonly: (readonly: boolean) => void;
}

export function createTokenAmountInput(opts: {
  label: string;
  initialToken?: TokenInfo | null;
  excludeAddress?: () => string | undefined;
  onAmountChange?: (value: string) => void;
  onTokenChange?: (token: TokenInfo) => void;
  showMax?: boolean;
}): TokenAmountInput {
  let token: TokenInfo | null = opts.initialToken ?? null;
  let balance = 0n;

  const coinWrap = el("span", { class: "coin" });
  const symbolEl = el("span", { class: "tsym" }, token ? token.symbol : "Select");
  const selectBtn = el(
    "button",
    {
      class: "token",
      "aria-haspopup": "listbox",
      on: {
        click: () =>
          openTokenSelector({
            excludeAddress: opts.excludeAddress?.(),
            onSelect: (t) => {
              setToken(t);
              opts.onTokenChange?.(t);
            },
          }),
      },
    },
    coinWrap,
    symbolEl,
    chevronDownIcon(14, "chev"),
  );

  const amountInput = el("input", {
    class: "amount",
    type: "text",
    inputmode: "decimal",
    placeholder: "0.0",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": `${opts.label} amount`,
    on: {
      input: () => {
        const decimals = token?.decimals ?? 18;
        const cleaned = sanitizeAmountString(amountInput.value, decimals);
        // Allow partial input like "0." while typing, but strip invalid chars.
        if (cleaned === null && amountInput.value !== "" && amountInput.value !== ".") {
          const salvaged = amountInput.value.replace(/[^\d.]/g, "");
          amountInput.value = salvaged;
        }
        opts.onAmountChange?.(amountInput.value);
      },
    },
  }) as HTMLInputElement;

  const balanceEl = el("span", {}, "Balance: -");
  const maxBtn = el(
    "button",
    {
      class: "max",
      on: {
        click: () => {
          if (!token) return;
          const value = formatAmount(balance, token.decimals, token.decimals);
          amountInput.value = value;
          opts.onAmountChange?.(value);
        },
      },
    },
    "MAX",
  );

  const root = el(
    "div",
    { class: "io-box" },
    el(
      "div",
      { class: "io-top" },
      el("span", { class: "label" }, opts.label),
      el("span", { class: "bal" }, balanceEl, opts.showMax === false ? null : maxBtn),
    ),
    el("div", { class: "io-body" }, el("div", { class: "token-wrap" }, selectBtn), amountInput),
  );

  function refreshCoin(): void {
    coinWrap.replaceChildren();
    if (token) coinWrap.appendChild(coinIcon(token.symbol, 24));
  }
  refreshCoin();

  function refreshBalance(): void {
    const account = walletStore.get().account;
    if (!account || !token) {
      balance = 0n;
      balanceEl.textContent = "Balance: -";
      return;
    }
    void readTokenBalance(token, account).then((bal) => {
      balance = bal;
      balanceEl.textContent = `Balance: ${formatAmount(bal, token!.decimals, 6)} ${token!.symbol}`;
    });
  }

  function setToken(t: TokenInfo | null): void {
    token = t;
    symbolEl.textContent = t ? t.symbol : "Select";
    refreshCoin();
    refreshBalance();
  }

  function setReadonly(ro: boolean): void {
    if (ro) amountInput.setAttribute("readonly", "");
    else amountInput.removeAttribute("readonly");
  }

  if (token) refreshBalance();

  return {
    root,
    getToken: () => token,
    setToken,
    getAmount: () => amountInput.value,
    setAmount: (value, silent) => {
      amountInput.value = value;
      if (!silent) opts.onAmountChange?.(value);
    },
    getBalance: () => balance,
    refreshBalance,
    setReadonly,
  };
}

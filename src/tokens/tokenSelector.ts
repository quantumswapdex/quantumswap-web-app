/**
 * Token selector dialog: searchable list of built-in + imported tokens with
 * live balances, plus paste-address import (sanitized, on-chain metadata,
 * acknowledge-before-add). Styled with the preview token-list classes.
 */

import { clear, el } from "../ui/dom";
import { openModal } from "../ui/components/modal";
import { coinIcon } from "../ui/components/icons";
import type { TokenInfo } from "../config/chain";
import { formatAmount, shortAddress } from "../lib/format";
import { sanitizeQuery, looksLikeAddress } from "../lib/sanitize";
import { walletStore } from "../wallet/wallet";
import {
  checkImport,
  getAllTokens,
  importToken,
  readTokenBalance,
  type ImportedToken,
} from "./tokenList";
import { confirmImportToken } from "./addWarning";

export function openTokenSelector(opts: {
  onSelect: (token: TokenInfo) => void;
  excludeAddress?: string;
}): void {
  const listWrap = el("div", { class: "dd-list" });
  const statusEl = el("div", { class: "dd-status" });

  const searchInput = el("input", {
    class: "dd-search",
    type: "text",
    placeholder: "Search name / symbol or paste address",
    autocomplete: "off",
    spellcheck: "false",
    on: { input: () => renderList() },
  }) as HTMLInputElement;

  const handle = openModal({
    title: "Select a token",
    body: el("div", {}, searchInput, statusEl, listWrap),
    // Wider than the default dialog so full names and balances fit comfortably.
    wide: true,
  });

  function pick(token: TokenInfo): void {
    handle.close();
    opts.onSelect(token);
  }

  async function renderList(): Promise<void> {
    const query = sanitizeQuery(searchInput.value).toLowerCase();
    const exclude = opts.excludeAddress?.toLowerCase();
    const all = getAllTokens().filter((t) => t.address.toLowerCase() !== exclude);

    const filtered = all.filter((t) => {
      if (!query) return true;
      return (
        t.symbol.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.address.toLowerCase().includes(query)
      );
    });

    clear(listWrap);
    for (const token of filtered) listWrap.appendChild(tokenRow(token, pick));

    // Offer on-chain import when the query is an unknown address.
    if (filtered.length === 0 && looksLikeAddress(searchInput.value)) {
      statusEl.textContent = "Looking up token on-chain...";
      const result = await checkImport(searchInput.value.trim());
      if (result.ok && result.token) {
        statusEl.textContent = "";
        listWrap.appendChild(
          importRow(result.token.symbol, result.token.name, result.token.address, async () => {
            const acknowledged = await confirmImportToken(result.token!);
            if (acknowledged) {
              const token = importToken(result.token!);
              pick(token);
            }
          }),
        );
      } else {
        statusEl.textContent = result.reason ?? "Token not found.";
      }
    } else if (filtered.length === 0) {
      statusEl.textContent = "No tokens match your search.";
    } else {
      statusEl.textContent = "";
    }
  }

  void renderList();
  searchInput.focus();
}

function tokenRow(token: TokenInfo, onPick: (t: TokenInfo) => void): HTMLElement {
  const balanceEl = el("span", { class: "bal" }, "");
  const account = walletStore.get().account;
  if (account) {
    void readTokenBalance(token, account).then((bal) => {
      balanceEl.textContent = formatAmount(bal, token.decimals, 4);
    });
  }

  const badges: (HTMLElement | string)[] = [];
  if (token.approved) badges.push(el("span", { class: "badge approved" }, "default"));
  if ((token as ImportedToken).imported) badges.push(el("span", { class: "badge imported" }, "imported"));

  return el(
    "button",
    { class: "dd-row", on: { click: () => onPick(token) } },
    el(
      "span",
      {},
      el("span", { class: "sym" }, coinIcon(token.symbol, 18), token.symbol, ...badges),
      el("span", { class: "nm" }, token.name),
    ),
    balanceEl,
  );
}

function importRow(symbol: string, name: string, address: string, onImport: () => void): HTMLElement {
  return el(
    "div",
    { class: "dd-import" },
    el(
      "span",
      {},
      el("span", { class: "sym" }, symbol),
      el("span", { class: "nm" }, name),
      el("span", { class: "mono" }, shortAddress(address)),
    ),
    el("button", { class: "import-btn", on: { click: onImport } }, "Import"),
  );
}

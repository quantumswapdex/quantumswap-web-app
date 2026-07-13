/** Token Explorer: default + imported tokens with balances and a default/unrecognized badge. */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { pageHeader } from "./shared";
import { addressPill } from "../ui/components/addressPill";
import { showToast } from "../ui/components/toast";
import { openModal } from "../ui/components/modal";
import type { TokenInfo } from "../config/chain";
import { formatAmount } from "../lib/format";
import { looksLikeAddress, sanitizeQuery } from "../lib/sanitize";
import {
  getAllTokens,
  importToken,
  readTokenBalance,
  removeImportedToken,
  tokenStore,
  type ImportedToken,
} from "../tokens/tokenList";
import { importTokenByAddress } from "../tokens/addWarning";
import { walletStore } from "../wallet/wallet";

export function tokenExplorerView(): ViewResult {
  let query = "";
  const listWrap = el("div", { class: "grid2" });

  const searchInput = el("input", {
    class: "filter-input",
    type: "search",
    placeholder: "Filter or paste an address to import...",
    on: {
      input: () => {
        query = sanitizeQuery((searchInput as HTMLInputElement).value);
        render();
      },
    },
  }) as HTMLInputElement;

  const importBtn = el(
    "button",
    { class: "btn btn-primary", on: { click: () => void tryImport() } },
    "Import token",
  );

  const createTokenBtn = el("a", { class: "btn btn-primary", href: "#/tokens/create" }, "Create token");

  const node = el(
    "div",
    { class: "page" },
    pageHeader("Token Explorer", "Default tokens plus any token you import by contract address."),
    el("div", { class: "toolbar" }, searchInput, importBtn, createTokenBtn),
    listWrap,
  );

  function render(): void {
    clear(listWrap);
    const q = query.toLowerCase();
    const tokens = getAllTokens().filter(
      (t) => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q),
    );
    for (const token of tokens) listWrap.appendChild(tokenCard(token));
    if (tokens.length === 0) {
      listWrap.appendChild(el("div", { class: "panel state" }, looksLikeAddress(query) ? "Not in your list. Click Import token to add it." : "No tokens match."));
    }
  }

  async function tryImport(): Promise<void> {
    // The dialog has its own contract-address textbox; a pasted address in the
    // filter box is used to prefill it.
    const prefill = looksLikeAddress(searchInput.value) ? searchInput.value.trim() : undefined;
    const meta = await importTokenByAddress(prefill);
    if (meta) {
      importToken(meta);
      showToast({ kind: "success", title: "Token imported", message: `${meta.symbol} added to your token list.`, autoDismissMs: 4000 });
      searchInput.value = "";
      query = "";
      render();
    }
  }

  const unsub = tokenStore.subscribe(() => render());
  const unsubWallet = walletStore.subscribe(() => render());
  render();

  return {
    node,
    theme: "emerald",
    title: "Token Explorer",
    cleanup: () => {
      unsub();
      unsubWallet();
    },
  };
}

function tokenCard(token: TokenInfo): HTMLElement {
  const balanceEl = el("span", { style: { fontSize: "13px", color: "rgba(255,255,255,0.6)" } }, "");
  const account = walletStore.get().account;
  if (account) {
    void readTokenBalance(token, account).then((bal) => {
      balanceEl.textContent = `${formatAmount(bal, token.decimals, 6)} ${token.symbol}`;
    });
  }

  const badge = token.approved
    ? el("span", { class: "badge approved" }, "default")
    : el("span", { class: "badge imported" }, "unrecognized");

  const actions: (HTMLElement | null)[] = [
    el("a", { class: "link link-btn", href: `#/explore/tokens/${token.address}` }, "Details"),
  ];
  if ((token as ImportedToken).imported) {
    actions.push(
      el(
        "button",
        {
          class: "link link-btn danger-text",
          style: { marginLeft: "10px" },
          on: {
            click: () => {
              const handle = openModal({
                title: "Remove token",
                body: el(
                  "div",
                  {},
                  el("p", { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0" } }, `Remove ${token.symbol} from your imported list? You can re-import it later.`),
                  el(
                    "div",
                    { class: "btn-row" },
                    el("button", { class: "btn btn-ghost", on: { click: () => handle.close() } }, "Cancel"),
                    el(
                      "button",
                      {
                        class: "btn btn-danger",
                        on: {
                          click: () => {
                            removeImportedToken(token.address);
                            handle.close();
                          },
                        },
                      },
                      "Remove",
                    ),
                  ),
                ),
              });
            },
          },
        },
        "Remove",
      ),
    );
  }

  return el(
    "div",
    { class: "panel" },
    el(
      "div",
      { class: "flex-between" },
      el("h3", { style: { margin: "0" } }, token.symbol, " ", badge),
      balanceEl,
    ),
    el("p", { style: { marginTop: "4px" } }, token.name),
    el("div", { class: "flex-between", style: { marginTop: "12px" } }, addressPill(token.address), el("span", {}, ...actions.filter(Boolean))),
  );
}

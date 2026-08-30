/**
 * Activity: local transaction history of the connected wallet account, with
 * status + quantumscan links. Only records sent by the connected account are
 * listed; disconnected shows a connect prompt, never another account's history.
 */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { emptyState, pageHeader } from "./shared";
import { openModal } from "../ui/components/modal";
import { explorerTxUrl } from "../config/chain";
import { clearTxHistory, txRecordsFor, txStore, type TxRecord, type TxStatus } from "../lib/txStore";
import { connectWallet, walletStore } from "../wallet/wallet";

const STATUS_CLASS: Record<TxStatus, string> = {
  pending: "status-pending",
  succeeded: "status-succeeded",
  failed: "status-failed",
  timeout: "ts",
};

export function activityView(): ViewResult {
  const listWrap = el("div", { class: "stack" });

  const clearBtn = el(
    "button",
    { class: "btn btn-ghost", on: { click: () => confirmClear() } },
    "Clear history",
  );

  const toolbar = el("div", { class: "toolbar" }, el("span", { class: "ts" }), clearBtn);
  const node = el(
    "div",
    { class: "page" },
    pageHeader("Activity", "Recent transactions sent from the connected wallet, reconciled with on-chain receipts."),
    toolbar,
    listWrap,
  );

  /** The connected account (lowercased), or null when disconnected. */
  function connectedAccount(): string | null {
    const { status, account } = walletStore.get();
    return status === "connected" && account ? account.toLowerCase() : null;
  }

  function confirmClear(): void {
    const account = connectedAccount();
    if (!account) return;
    const handle = openModal({
      title: "Clear history?",
      body: el(
        "div",
        {},
        el(
          "p",
          { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0" } },
          "This only clears the transaction record stored in your browser for the connected account. It does not affect anything on-chain.",
        ),
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
                  clearTxHistory(account);
                  handle.close();
                },
              },
            },
            "Clear history",
          ),
        ),
      ),
    });
  }

  function render(): void {
    clear(listWrap);
    const account = connectedAccount();
    if (!account) {
      toolbar.hidden = true;
      listWrap.appendChild(
        emptyState(
          "Connect your wallet to see its activity.",
          el("button", { class: "btn btn-primary", on: { click: () => void connectWallet() } }, "Connect wallet"),
        ),
      );
      return;
    }
    const records: TxRecord[] = txRecordsFor(account);
    toolbar.hidden = records.length === 0;
    if (records.length === 0) {
      listWrap.appendChild(emptyState("No transactions from this account yet. Your swaps and liquidity actions will appear here."));
      return;
    }
    for (const record of records) listWrap.appendChild(row(record));
  }

  function row(record: TxRecord): HTMLElement {
    return el(
      "div",
      { class: "panel tx-row" },
      el(
        "div",
        { class: "tx-main" },
        el("div", { class: "tx-label" }, record.summary),
        el(
          "a",
          { class: "link tx-hash", href: explorerTxUrl(record.hash), target: "_blank", rel: "noopener noreferrer" },
          record.hash,
        ),
      ),
      el(
        "div",
        { class: "tx-side" },
        el("div", { class: `tx-status ${STATUS_CLASS[record.status]}` }, record.status),
        el("div", { class: "ts" }, new Date(record.timestamp).toLocaleString()),
      ),
    );
  }

  const unsubTx = txStore.subscribe(() => render());
  const unsubWallet = walletStore.subscribe(() => render());
  render();

  return {
    node,
    theme: "amber",
    title: "Activity",
    cleanup: () => {
      unsubTx();
      unsubWallet();
    },
  };
}

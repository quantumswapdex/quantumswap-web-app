/** Activity: local transaction history with status + quantumscan links. */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { emptyState, pageHeader } from "./shared";
import { openModal } from "../ui/components/modal";
import { explorerTxUrl } from "../config/chain";
import { txStore, type TxRecord, type TxStatus } from "../lib/txStore";

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

  const node = el(
    "div",
    { class: "page" },
    pageHeader("Activity", "Your recent transactions, reconciled with on-chain receipts."),
    el("div", { class: "toolbar" }, el("span", { class: "ts" }), clearBtn),
    listWrap,
  );

  function confirmClear(): void {
    const handle = openModal({
      title: "Clear history?",
      body: el(
        "div",
        {},
        el(
          "p",
          { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0" } },
          "This only clears the transaction record stored in your browser. It does not affect anything on-chain.",
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
                  txStore.set([]);
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

  function render(records: TxRecord[]): void {
    clear(listWrap);
    if (records.length === 0) {
      listWrap.appendChild(emptyState("No transactions yet. Your swaps and liquidity actions will appear here."));
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

  const unsub = txStore.subscribe(render, true);

  return { node, theme: "amber", title: "Activity", cleanup: () => unsub() };
}

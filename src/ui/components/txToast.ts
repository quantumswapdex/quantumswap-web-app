/**
 * First-class transaction status toasts. One toast per submitted action
 * (swap, wrap, add/remove liquidity, create pair, ...), colored per action,
 * that stays pending and resolves to success/failure by following the
 * transaction record in txStore (receipt polling + wallet events).
 */

import { txStore } from "../../lib/txStore";
import { showToast, type ToastAccent } from "./toast";

export interface TxToastLabels {
  /** e.g. "Swapping" (shown while pending, with spinner) */
  pending: string;
  /** e.g. "Swap complete" */
  success: string;
  /** e.g. "Swap failed" */
  failure: string;
}

const ACTIVITY_LINK = { href: "#/activity", label: "View activity" };

/**
 * Show a colored pending toast for a just-submitted transaction and update it
 * in place when the transaction succeeds, fails, or times out.
 */
export function trackTxToast(hash: string, accent: ToastAccent, labels: TxToastLabels, message?: string): void {
  const toast = showToast({
    kind: "pending",
    accent,
    title: labels.pending,
    message,
    link: ACTIVITY_LINK,
  });

  let done = false;
  const unsub = txStore.subscribe((list) => {
    const record = list.find((r) => r.hash === hash);
    if (done || !record || record.status === "pending") return;
    done = true;
    unsub();
    if (record.status === "succeeded") {
      toast.update({ kind: "success", title: labels.success, message, link: ACTIVITY_LINK });
    } else if (record.status === "failed") {
      toast.update({ kind: "error", title: labels.failure, message, link: ACTIVITY_LINK });
    } else {
      // timeout: confirmation not observed; the tx may still mine later.
      toast.update({
        kind: "info",
        title: `${labels.pending} - still unconfirmed`,
        message: "Confirmation timed out.",
        link: ACTIVITY_LINK,
        autoDismissMs: 10000,
      });
    }
  });
}

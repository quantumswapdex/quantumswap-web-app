/**
 * Local transaction history, reconciled against the wallet's transactionResult
 * event and receipt polling. Persisted to localStorage per session; hashes are
 * re-validated on read.
 */

import { createStore } from "../ui/store";
import { onTransactionResult } from "../wallet/wallet";
import { sanitizeTxHash } from "./sanitizeResponse";
import { waitForReceipt } from "./tx";

export type TxStatus = "pending" | "succeeded" | "failed" | "timeout";

export interface TxRecord {
  hash: string;
  summary: string;
  status: TxStatus;
  timestamp: number;
}

const STORAGE_KEY = "qs.tx-history.v1";
const MAX_RECORDS = 50;

export const txStore = createStore<TxRecord[]>(load());

function load(): TxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: TxRecord[] = [];
    for (const entry of parsed) {
      const hash = sanitizeTxHash(entry?.hash);
      if (!hash) continue;
      out.push({
        hash,
        summary: typeof entry?.summary === "string" ? entry.summary.slice(0, 120) : "Transaction",
        status: normalizeStatus(entry?.status),
        timestamp: typeof entry?.timestamp === "number" ? entry.timestamp : Date.now(),
      });
    }
    return out.slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function normalizeStatus(value: unknown): TxStatus {
  return value === "succeeded" || value === "failed" || value === "timeout" ? value : "pending";
}

txStore.subscribe((list) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    /* ignore */
  }
});

/** Record a newly submitted transaction and begin receipt reconciliation. */
export function recordTx(hash: string, summary: string): void {
  const safe = sanitizeTxHash(hash);
  if (!safe) return;
  const record: TxRecord = { hash: safe, summary, status: "pending", timestamp: Date.now() };
  txStore.update((list) => [record, ...list.filter((r) => r.hash !== safe)].slice(0, MAX_RECORDS));
  void reconcile(safe);
}

function setStatus(hash: string, status: TxStatus): void {
  txStore.update((list) => list.map((r) => (r.hash === hash ? { ...r, status } : r)));
}

async function reconcile(hash: string): Promise<void> {
  try {
    const receipt = await waitForReceipt(hash);
    if (!receipt) {
      setStatus(hash, "timeout");
      return;
    }
    setStatus(hash, receipt.status === 1 ? "succeeded" : "failed");
  } catch {
    setStatus(hash, "timeout");
  }
}

/** Wire the wallet's transactionResult event into the store. Call once. */
export function initTxHistory(): void {
  onTransactionResult((result) => {
    const hash = sanitizeTxHash(result.txHash);
    if (!hash) return;
    const status: TxStatus =
      result.status === "succeeded" ? "succeeded" : result.status === "failed" ? "failed" : "timeout";
    // Only downgrade pending -> resolved; keep an existing succeeded/failed.
    txStore.update((list) => {
      const exists = list.some((r) => r.hash === hash);
      if (!exists) {
        return [{ hash, summary: "Transaction", status, timestamp: Date.now() }, ...list].slice(0, MAX_RECORDS);
      }
      return list.map((r) => (r.hash === hash && r.status === "pending" ? { ...r, status } : r));
    });
  });

  // Re-poll any still-pending txs from a previous session.
  for (const record of txStore.get()) {
    if (record.status === "pending") void reconcile(record.hash);
  }
}

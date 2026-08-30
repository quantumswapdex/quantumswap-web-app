/**
 * Local transaction history, reconciled against the wallet's transactionResult
 * event and receipt polling. Persisted cross-session to localStorage. Hashes
 * and accounts are re-validated on read.
 *
 * Every record is attributed to the wallet account that sent it, and the
 * Activity view only lists the records of the currently connected account
 * (`txRecordsFor`). Records without an attributable account are never kept.
 */

import { createStore } from "../ui/store";
import { onTransactionResult, walletStore } from "../wallet/wallet";
import { sanitizeAddressResponse, sanitizeTxHash } from "./sanitizeResponse";
import { waitForReceipt } from "./tx";

export type TxStatus = "pending" | "succeeded" | "failed" | "timeout";

export interface TxRecord {
  hash: string;
  /** Lowercased address of the wallet account that sent the transaction. */
  account: string;
  summary: string;
  status: TxStatus;
  timestamp: number;
}

const STORAGE_KEY = "qs.tx-history.v1";
const MAX_RECORDS = 50;

export const txStore = createStore<TxRecord[]>(load());

/** The connected wallet account, lowercased, or null when disconnected. */
function connectedAccount(): string | null {
  const { status, account } = walletStore.get();
  if (status !== "connected" || !account) return null;
  const safe = sanitizeAddressResponse(account);
  return safe ? safe.toLowerCase() : null;
}

/** The records that belong to `account` (case-insensitive); none when disconnected. */
export function txRecordsFor(account: string | null, list: TxRecord[] = txStore.get()): TxRecord[] {
  if (!account) return [];
  const key = account.toLowerCase();
  return list.filter((r) => r.account === key);
}

/**
 * Parse + re-validate a persisted JSON list of records. Entries without a
 * valid account (including history saved before accounts were recorded) are
 * dropped: they can never be attributed to a connected wallet. Exported for
 * tests.
 */
export function parseRecords(raw: string): TxRecord[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: TxRecord[] = [];
    for (const entry of parsed) {
      const hash = sanitizeTxHash(entry?.hash);
      const account = sanitizeAddressResponse(entry?.account);
      if (!hash || !account) continue;
      out.push({
        hash,
        account: account.toLowerCase(),
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

function load(): TxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const records = parseRecords(raw);
    if (records.length === 0 && raw.length > 2) {
      // Data was present but every entry failed validation - keep this
      // traceable instead of silently showing an empty Activity list.
      console.warn("[qs] tx-history present in localStorage but no entry passed validation", raw.slice(0, 200));
    }
    return records;
  } catch {
    return [];
  }
}

function normalizeStatus(value: unknown): TxStatus {
  return value === "succeeded" || value === "failed" || value === "timeout" ? value : "pending";
}

// ---- Persistence ----------------------------------------------------------

txStore.subscribe((list) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    /* ignore */
  }
});

/**
 * Record a newly submitted transaction (attributed to the connected account)
 * and begin receipt reconciliation. Nothing is recorded without a connected
 * account, since the record could never be shown to anyone.
 */
export function recordTx(hash: string, summary: string): void {
  const safe = sanitizeTxHash(hash);
  const account = connectedAccount();
  if (!safe || !account) return;
  const record: TxRecord = { hash: safe, account, summary, status: "pending", timestamp: Date.now() };
  txStore.update((list) => [record, ...list.filter((r) => r.hash !== safe)].slice(0, MAX_RECORDS));
  void reconcile(safe);
}

/** Forget the stored history of one account only (other accounts' records stay). */
export function clearTxHistory(account: string): void {
  const key = account.toLowerCase();
  txStore.update((list) => list.filter((r) => r.account !== key));
}

function setStatus(hash: string, status: TxStatus): void {
  txStore.update((list) => list.map((r) => (r.hash === hash ? { ...r, status } : r)));
}

/**
 * Invoke `cb` once when the given tx settles (succeeded / failed / timeout).
 * Lets views refresh their on-chain data after a submitted action confirms.
 */
export function onTxSettled(hash: string, cb: (status: TxStatus) => void): void {
  const existing = txStore.get().find((r) => r.hash === hash);
  if (existing && existing.status !== "pending") {
    cb(existing.status);
    return;
  }
  const unsub = txStore.subscribe((list) => {
    const record = list.find((r) => r.hash === hash);
    if (!record || record.status === "pending") return;
    unsub();
    cb(record.status);
  });
}

const reconciling = new Set<string>();

async function reconcile(hash: string): Promise<void> {
  if (reconciling.has(hash)) return;
  reconciling.add(hash);
  try {
    const receipt = await waitForReceipt(hash);
    if (!receipt) {
      setStatus(hash, "timeout");
      return;
    }
    setStatus(hash, receipt.status === 1 ? "succeeded" : "failed");
  } catch {
    setStatus(hash, "timeout");
  } finally {
    reconciling.delete(hash);
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
    // A result for an unknown hash is attributed to the connected account (the
    // extension reports results for its active account); without one there is
    // nobody to show it to, so it is not stored.
    const account = connectedAccount();
    txStore.update((list) => {
      const exists = list.some((r) => r.hash === hash);
      if (!exists) {
        if (!account) return list;
        return [{ hash, account, summary: "Transaction", status, timestamp: Date.now() }, ...list].slice(0, MAX_RECORDS);
      }
      return list.map((r) => (r.hash === hash && r.status === "pending" ? { ...r, status } : r));
    });
  });

  // Re-poll any still-pending txs from a previous session.
  for (const record of txStore.get()) {
    if (record.status === "pending") void reconcile(record.hash);
  }
}

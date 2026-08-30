import { describe, it, expect, beforeEach, vi } from "vitest";
import { walletStore } from "../wallet/wallet";

// Receipt polling never resolves here: records stay "pending" for the test.
vi.mock("./tx", () => ({ waitForReceipt: () => new Promise(() => {}) }));

const { clearTxHistory, parseRecords, recordTx, txRecordsFor, txStore } = await import("./txStore");

const ACCOUNT_A = "0x" + "a".repeat(64);
const ACCOUNT_B = "0x" + "b".repeat(64);
const HASH_1 = "0x" + "1".repeat(64);
const HASH_2 = "0x" + "2".repeat(64);
const HASH_3 = "0x" + "3".repeat(64);

function connect(account: string | null): void {
  walletStore.set(
    account
      ? { status: "connected", account, chainId: 123123, nativeBalance: null }
      : { status: "disconnected", account: null, chainId: null, nativeBalance: null },
  );
}

describe("txStore: per-account transaction history", () => {
  beforeEach(() => {
    localStorage.clear();
    txStore.set([]);
    connect(null);
  });

  it("records are attributed to the connected account (lowercased) and nothing is recorded when disconnected", () => {
    recordTx(HASH_1, "Swap while disconnected");
    expect(txStore.get()).toHaveLength(0);

    connect(ACCOUNT_A.toUpperCase().replace("0X", "0x"));
    recordTx(HASH_2, "Swap A");
    expect(txStore.get()).toHaveLength(1);
    expect(txStore.get()[0]).toMatchObject({ hash: HASH_2, account: ACCOUNT_A, summary: "Swap A", status: "pending" });
  });

  it("txRecordsFor returns only the given account's records, case-insensitively, and none for null", () => {
    connect(ACCOUNT_A);
    recordTx(HASH_1, "Swap A");
    connect(ACCOUNT_B);
    recordTx(HASH_2, "Swap B");
    recordTx(HASH_3, "Add liquidity B");

    expect(txRecordsFor(ACCOUNT_A).map((r) => r.hash)).toEqual([HASH_1]);
    expect(txRecordsFor(ACCOUNT_B.toUpperCase().replace("0X", "0x")).map((r) => r.hash)).toEqual([HASH_3, HASH_2]);
    expect(txRecordsFor(null)).toEqual([]);
  });

  it("clearTxHistory forgets one account's records and keeps the others", () => {
    connect(ACCOUNT_A);
    recordTx(HASH_1, "Swap A");
    connect(ACCOUNT_B);
    recordTx(HASH_2, "Swap B");

    clearTxHistory(ACCOUNT_B);
    expect(txStore.get().map((r) => r.hash)).toEqual([HASH_1]);
  });

  it("persisted records keep their account; legacy entries without one are dropped on parse", () => {
    connect(ACCOUNT_A);
    recordTx(HASH_1, "Swap A");
    const persisted = localStorage.getItem("qs.tx-history.v1") as string;
    expect(JSON.parse(persisted)[0].account).toBe(ACCOUNT_A);

    const parsed = parseRecords(
      JSON.stringify([
        { hash: HASH_1, account: ACCOUNT_A, summary: "kept", status: "succeeded", timestamp: 1 },
        { hash: HASH_2, summary: "legacy, no account", status: "succeeded", timestamp: 2 },
        { hash: HASH_3, account: "not-an-address", summary: "bad account", status: "failed", timestamp: 3 },
      ]),
    );
    expect(parsed.map((r) => r.hash)).toEqual([HASH_1]);
    expect(parsed[0].account).toBe(ACCOUNT_A);
  });
});

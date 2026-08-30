import { describe, it, expect, beforeEach, vi } from "vitest";
import { walletStore } from "../wallet/wallet";

vi.mock("../lib/tx", () => ({ waitForReceipt: () => new Promise(() => {}) }));

const { recordTx, txStore } = await import("../lib/txStore");
const { activityView } = await import("./activity");

const ACCOUNT_A = "0x" + "a".repeat(64);
const ACCOUNT_B = "0x" + "b".repeat(64);
const HASH_A = "0x" + "1".repeat(64);
const HASH_B = "0x" + "2".repeat(64);

function connect(account: string | null): void {
  walletStore.set(
    account
      ? { status: "connected", account, chainId: 123123, nativeBalance: null }
      : { status: "disconnected", account: null, chainId: null, nativeBalance: null },
  );
}

describe("activity view: only the connected account's transactions", () => {
  beforeEach(() => {
    localStorage.clear();
    txStore.set([]);
    connect(ACCOUNT_A);
    recordTx(HASH_A, "Swap by A");
    connect(ACCOUNT_B);
    recordTx(HASH_B, "Swap by B");
  });

  it("lists the connected account's records only, and follows wallet switches / disconnects live", () => {
    connect(ACCOUNT_A);
    const v = activityView();
    let text = v.node.textContent ?? "";
    expect(text).toContain("Swap by A");
    expect(text).not.toContain("Swap by B");

    connect(ACCOUNT_B);
    text = v.node.textContent ?? "";
    expect(text).toContain("Swap by B");
    expect(text).not.toContain("Swap by A");

    connect(null);
    text = v.node.textContent ?? "";
    expect(text).toContain("Connect your wallet to see its activity.");
    expect(text).not.toContain("Swap by A");
    expect(text).not.toContain("Swap by B");
    expect(text).not.toContain(HASH_A);
    expect(text).not.toContain(HASH_B);
    v.cleanup?.();
  });

  it("shows the connect prompt (no history, no Clear button) when opened while disconnected", () => {
    connect(null);
    const v = activityView();
    const root = v.node as HTMLElement;
    expect(root.textContent).toContain("Connect your wallet to see its activity.");
    expect(root.textContent).not.toContain("Swap by");
    const toolbar = root.querySelector<HTMLElement>(".toolbar");
    expect(toolbar?.hidden).toBe(true);
    v.cleanup?.();
  });
});

/**
 * Wallet connection + account state over the extension provider. Detects the
 * provider (with the `quantumcoin#initialized` event + a timeout), connects via
 * qc_requestAccounts, and mirrors accountsChanged/chainChanged/disconnect into a
 * pub/sub store. All account/network reads flow through here.
 */

import type { QuantumCoinProvider, QcTransactionResult } from "../types/global";
import { createStore } from "../ui/store";
import { CHAIN_ID } from "../config/chain";
import { extensionProvider } from "../lib/extensionProvider";
import { sanitizeAddressResponse } from "../lib/sanitizeResponse";

export type WalletStatus = "detecting" | "no-provider" | "disconnected" | "connected";

export interface WalletState {
  status: WalletStatus;
  account: string | null;
  chainId: number | null;
  nativeBalance: bigint | null;
}

export const walletStore = createStore<WalletState>({
  status: "detecting",
  account: null,
  chainId: null,
  nativeBalance: null,
});

/** Listeners for tx results (activity view subscribes here). */
type TxResultHandler = (result: QcTransactionResult) => void;
const txResultHandlers = new Set<TxResultHandler>();
export function onTransactionResult(handler: TxResultHandler): () => void {
  txResultHandlers.add(handler);
  return () => txResultHandlers.delete(handler);
}

let provider: QuantumCoinProvider | null = null;

export function getProvider(): QuantumCoinProvider | null {
  return provider;
}

export function isWrongNetwork(state: WalletState = walletStore.get()): boolean {
  return state.status === "connected" && state.chainId !== null && state.chainId !== CHAIN_ID;
}

/** Detect the provider, waiting briefly for `quantumcoin#initialized`. */
export function detectProvider(timeoutMs = 3000): Promise<QuantumCoinProvider | null> {
  return new Promise((resolve) => {
    if (window.quantumcoin) {
      resolve(window.quantumcoin);
      return;
    }
    let settled = false;
    const onInit = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("quantumcoin#initialized", onInit);
      resolve(window.quantumcoin ?? null);
    };
    window.addEventListener("quantumcoin#initialized", onInit);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("quantumcoin#initialized", onInit);
      resolve(window.quantumcoin ?? null);
    }, timeoutMs);
  });
}

/** Initialize wallet: detect provider, wire events, restore existing session. */
export async function initWallet(): Promise<void> {
  provider = await detectProvider();
  if (!provider) {
    walletStore.set({ status: "no-provider", account: null, chainId: null, nativeBalance: null });
    return;
  }

  wireEvents(provider);

  // Restore a prior connection without prompting.
  try {
    const accounts = (await provider.request({ method: "qc_accounts" })) as unknown;
    const account = firstAddress(accounts);
    if (account) {
      const chainId = await readChainId();
      walletStore.set({ status: "connected", account, chainId, nativeBalance: null });
      void refreshBalance();
    } else {
      walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
    }
  } catch {
    walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
  }
}

/** Prompt the user to connect (opens the wallet approval popup). */
export async function connectWallet(): Promise<void> {
  if (!provider) {
    walletStore.update((s) => ({ ...s, status: "no-provider" }));
    return;
  }
  const accounts = (await provider.request({ method: "qc_requestAccounts" })) as unknown;
  const account = firstAddress(accounts);
  if (!account) throw new Error("No account returned by the wallet");
  const chainId = await readChainId();
  walletStore.set({ status: "connected", account, chainId, nativeBalance: null });
  void refreshBalance();
}

export async function disconnectWallet(): Promise<void> {
  if (!provider) return;
  try {
    await provider.request({ method: "qc_disconnect" });
  } catch {
    /* ignore */
  }
  walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
}

export async function refreshBalance(): Promise<void> {
  const { account, status } = walletStore.get();
  if (status !== "connected" || !account) return;
  try {
    const balance = await extensionProvider.getBalance(account, "latest");
    walletStore.update((s) => (s.account === account ? { ...s, nativeBalance: balance } : s));
  } catch {
    /* leave balance as-is */
  }
}

async function readChainId(): Promise<number | null> {
  if (!provider) return null;
  try {
    const raw = await provider.request({ method: "qc_chainId" });
    return typeof raw === "number" ? raw : null;
  } catch {
    return null;
  }
}

function wireEvents(p: QuantumCoinProvider): void {
  const on = (p.on || p.addListener)?.bind(p);
  if (!on) return;

  on("accountsChanged", (accounts: unknown) => {
    const account = firstAddress(accounts);
    if (account) {
      walletStore.update((s) => ({ ...s, status: "connected", account, nativeBalance: null }));
      void refreshBalance();
    } else {
      walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
    }
  });

  on("chainChanged", (chainIdHex: unknown) => {
    const chainId = typeof chainIdHex === "string" ? Number.parseInt(chainIdHex, 16) : null;
    walletStore.update((s) => ({ ...s, chainId }));
    void refreshBalance();
  });

  on("connect", (info: { chainId?: number }) => {
    walletStore.update((s) => ({ ...s, chainId: typeof info?.chainId === "number" ? info.chainId : s.chainId }));
  });

  on("disconnect", () => {
    walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
  });

  on("transactionResult", (result: QcTransactionResult) => {
    for (const handler of [...txResultHandlers]) {
      try {
        handler(result);
      } catch {
        /* ignore handler errors */
      }
    }
    void refreshBalance();
  });
}

function firstAddress(accounts: unknown): string | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  return sanitizeAddressResponse(accounts[0]);
}

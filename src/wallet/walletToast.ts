/**
 * Surfaces wallet connection transitions (connect / disconnect / account
 * change) as toasts. Subscribes to walletStore so it covers every path: the
 * Connect/Disconnect buttons, the extension's accountsChanged/disconnect
 * events, and account switches performed inside the extension. Started after
 * initWallet so the initial session restore does not fire a toast.
 */

import { walletStore, type WalletState } from "./wallet";
import { showToast } from "../ui/components/toast";
import { shortAddress } from "../lib/format";

const TOAST_MS = 6000;

export function startWalletToasts(): void {
  let prev: WalletState = walletStore.get();

  walletStore.subscribe((next) => {
    const wasConnected = prev.status === "connected" && Boolean(prev.account);
    const isConnected = next.status === "connected" && Boolean(next.account);

    if (!wasConnected && isConnected) {
      showToast({
        kind: "success",
        title: "Wallet connected",
        message: shortAddress(next.account as string),
        autoDismissMs: TOAST_MS,
      });
    } else if (wasConnected && !isConnected) {
      showToast({
        kind: "info",
        title: "Wallet disconnected",
        message: prev.account ? shortAddress(prev.account) : undefined,
        autoDismissMs: TOAST_MS,
      });
    } else if (wasConnected && isConnected && prev.account !== next.account) {
      showToast({
        kind: "info",
        title: "Account changed",
        message: shortAddress(next.account as string),
        autoDismissMs: TOAST_MS,
      });
    }

    prev = next;
  });
}

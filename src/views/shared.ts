/** Shared view building blocks (preview design language): page heads, panels, states. */

import qc from "quantumcoin";
import { el, type Child } from "../ui/dom";
import { connectWallet, walletStore } from "../wallet/wallet";
import { showToast } from "../ui/components/toast";
import { trackTxToast } from "../ui/components/txToast";
import type { TxStep } from "../ui/components/txSteps";
import { erc20, encodeErc20 } from "../lib/contracts";
import { ROUTER_ADDRESS } from "../config/chain";
import { sendTx, waitForReceiptSuccess } from "../lib/tx";
import { recordTx } from "../lib/txStore";

export function pageHeader(title: string, subtitle?: string): HTMLElement {
  return el(
    "div",
    { class: "page-head" },
    el("h1", {}, title),
    subtitle ? el("p", { class: "page-sub" }, subtitle) : null,
  );
}

export function card(...children: Child[]): HTMLElement {
  return el("div", { class: "panel" }, ...children);
}

export function emptyState(message: string, ...actions: Child[]): HTMLElement {
  return el(
    "div",
    { class: "panel state stack-state" },
    el("p", {}, message),
    actions.length ? el("div", { class: "actions-inline" }, ...actions) : null,
  );
}

export function errorState(message: string): HTMLElement {
  return el("div", { class: "panel state error" }, message);
}

export function loadingState(message = "Loading..."): HTMLElement {
  return el("div", { class: "panel state" }, el("span", { class: "spinner-lg" }), message);
}

/** Primary action button that requires a connected wallet; falls back to connect. */
export function connectGateButton(label: string, action: () => void | Promise<void>): HTMLElement {
  const state = walletStore.get();
  if (state.status !== "connected") {
    return el(
      "button",
      {
        class: "cta",
        on: {
          click: () => {
            connectWallet().catch((err) =>
              showToast({ kind: "error", title: "Connect failed", message: errText(err), autoDismissMs: 6000 }),
            );
          },
        },
      },
      "Connect wallet",
    );
  }
  return el(
    "button",
    {
      class: "cta",
      on: {
        click: () => {
          void action();
        },
      },
    },
    label,
  );
}

export function statRow(label: Child, value: Child): HTMLElement {
  return el(
    "div",
    { class: "row" },
    el("span", { class: "k" }, label),
    el("span", { class: "v" }, value),
  );
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

/**
 * Build an "Approve <symbol>" step for the multi-step tx dialog. Returns null
 * when the existing allowance already covers `amount` (no tx needed), so the
 * dialog only lists approvals that are actually required.
 */
export async function approvalStep(opts: {
  tokenAddr: string;
  symbol: string;
  abi: readonly unknown[];
  owner: string;
  amount: bigint;
}): Promise<TxStep | null> {
  const allowanceRaw = await erc20(opts.tokenAddr).allowance(opts.owner, ROUTER_ADDRESS);
  const allowance = typeof allowanceRaw === "bigint" ? allowanceRaw : BigInt(allowanceRaw ?? 0);
  if (allowance >= opts.amount) return null;
  return {
    label: `Approve ${opts.symbol}`,
    run: async (onAccepted) => {
      const data = encodeErc20("approve", [ROUTER_ADDRESS, qc.MaxUint256]);
      const hash = await sendTx({ to: opts.tokenAddr, data, value: 0n, abi: opts.abi });
      recordTx(hash, `Approve ${opts.symbol}`);
      trackTxToast(
        hash,
        "approve",
        { pending: `Approving ${opts.symbol}`, success: `${opts.symbol} approved`, failure: `${opts.symbol} approval failed` },
        "Allow the router to spend your token.",
      );
      onAccepted(hash);
      await waitForReceiptSuccess(hash);
    },
  };
}

/**
 * Startup gate dialogs shown after the app finishes loading:
 *  - openInstallModal(): extension not detected -> non-dismissable install prompt.
 *  - openConnectModal(): extension detected but not connected -> connect prompt.
 * A branded backdrop stands in for the shell while the install gate is open.
 */

import { el } from "../dom";
import { orbs } from "./orbs";
import { openModal, type ModalHandle } from "./modal";
import { showToast } from "./toast";
import { EXTENSION_INSTALL_URL } from "../../config/chain";
import { connectWallet, walletStore } from "../../wallet/wallet";

const INSTALL_MESSAGE =
  "No QuantumCoin provider found. Install/enable the QuantumSwap extension, then reload.";

/** Full-screen branded background used behind the install gate (no interactive shell). */
export function brandBackdrop(): HTMLElement {
  return el(
    "div",
    { class: "gate" },
    orbs(),
    el(
      "div",
      { class: "gate-inner" },
      el("img", { src: "/logo-128.png", alt: "", width: "72", height: "72" }),
      el("h1", {}, "Quantum", el("span", { style: { color: "var(--accent)" } }, "Swap"), " Web App"),
      el("p", {}, "Beta / Test Version"),
    ),
  );
}

/** Blocking dialog prompting the user to install the QuantumSwap browser extension. */
export function openInstallModal(): ModalHandle {
  return openModal({
    title: "Install the QuantumSwap extension",
    dismissable: false,
    body: [
      el(
        "div",
        { class: "center" },
        el("img", { src: "/logo-128.png", alt: "QuantumSwap", width: "56", height: "56", style: { borderRadius: "16px" } }),
        el("p", { class: "muted", style: { fontSize: "13.5px", lineHeight: "1.5" } }, INSTALL_MESSAGE),
      ),
      el(
        "div",
        { class: "btn-row" },
        el(
          "a",
          { class: "btn btn-primary", href: EXTENSION_INSTALL_URL, target: "_blank", rel: "noopener noreferrer" },
          "Install",
        ),
        el("button", { class: "btn btn-ghost", on: { click: () => location.reload() } }, "Reload"),
      ),
      el(
        "p",
        { class: "cf-note center" },
        "The QuantumSwap Web App talks to the QuantumCoin network only through the browser extension. Once it is installed and unlocked, reload this page.",
      ),
    ],
  });
}

/** Dialog prompting the user to connect their already-installed wallet. */
export function openConnectModal(): ModalHandle {
  const connectBtn = el(
    "button",
    { class: "dlg-cta", on: { click: () => void onConnect() } },
    "Connect wallet",
  ) as HTMLButtonElement;

  async function onConnect(): Promise<void> {
    connectBtn.setAttribute("disabled", "true");
    connectBtn.textContent = "Connecting...";
    try {
      await connectWallet();
      handle.close();
    } catch (err) {
      showToast({ kind: "error", title: "Connect failed", message: errText(err), autoDismissMs: 6000 });
      connectBtn.removeAttribute("disabled");
      connectBtn.textContent = "Connect wallet";
    }
  }

  let unsub = () => {};
  const handle = openModal({
    title: "Connect your wallet",
    onClose: () => unsub(),
    body: [
      el(
        "div",
        { class: "center" },
        el("img", { src: "/logo-128.png", alt: "QuantumSwap", width: "56", height: "56", style: { borderRadius: "16px" } }),
        el(
          "p",
          { class: "muted", style: { fontSize: "13.5px", lineHeight: "1.5" } },
          "Connect your QuantumSwap wallet to swap, provide liquidity, and view your balances. You will approve the connection in the browser extension.",
        ),
      ),
      connectBtn,
      el(
        "button",
        {
          class: "link-btn link w-full center mt12",
          on: { click: () => handle.close() },
        },
        "Browse without connecting",
      ),
    ],
  });

  // Close automatically if the connection happens elsewhere (e.g. header button).
  unsub = walletStore.subscribe((s) => {
    if (s.status === "connected") handle.close();
  });

  return handle;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

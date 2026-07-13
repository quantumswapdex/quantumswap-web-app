/** Settings: slippage/expert defaults, imported-token management, network + contracts info. */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { card, pageHeader, statRow } from "./shared";
import { openModal } from "../ui/components/modal";
import {
  BLOCK_EXPLORER,
  CHAIN_ID,
  NETWORK_NAME,
} from "../config/chain";
import { factoryAddress, routerAddress, wqAddress } from "../config/releases";
import { settingsStore, setExpertMode, setSlippage } from "../config/settings";
import { removeImportedToken, tokenStore } from "../tokens/tokenList";
import { txStore } from "../lib/txStore";
import { registryStore } from "../lib/pairRegistry";

export function settingsView(): ViewResult {
  const settings = settingsStore.get();

  const slippageInput = numberInput(String(settings.slippagePercent), (v) => setSlippage(v));
  const expertToggle = el("input", {
    type: "checkbox",
    style: { width: "16px", height: "16px", accentColor: "var(--accent)", cursor: "pointer" },
    on: { change: (e: Event) => setExpertMode((e.target as HTMLInputElement).checked) },
    ...(settings.expertMode ? { checked: true } : {}),
  });

  const importedWrap = el("div", {});

  function renderImported(): void {
    clear(importedWrap);
    const imported = tokenStore.get();
    if (imported.length === 0) {
      importedWrap.appendChild(el("p", {}, "No imported tokens."));
      return;
    }
    for (const token of imported) {
      importedWrap.appendChild(
        el(
          "div",
          { class: "imported-row" },
          el(
            "span",
            { style: { minWidth: "0" } },
            el("span", { class: "ir-label" }, `${token.symbol} - ${token.name}`),
            el("span", { class: "full-addr ir-addr" }, token.address),
          ),
          el(
            "button",
            { class: "link link-btn danger-text", style: { flexShrink: "0" }, on: { click: () => removeImportedToken(token.address) } },
            "Remove",
          ),
        ),
      );
    }
  }

  function openContractsDialog(): void {
    const entry = (label: string, address: string) =>
      el(
        "div",
        { class: "field" },
        el("div", { class: "field-label" }, label),
        el("div", { class: "full-addr" }, address),
      );
    openModal({
      title: "Core contracts",
      body: el(
        "div",
        {},
        entry("Wrapped Q (WQ)", wqAddress()),
        entry("Factory", factoryAddress()),
        entry("Router", routerAddress()),
      ),
    });
  }

  function confirmClearCache(): void {
    const handle = openModal({
      title: "Clear discovered pairs & history?",
      body: el(
        "div",
        {},
        el(
          "p",
          { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0" } },
          "This removes locally cached pair discoveries and your transaction history from this browser. Imported tokens are kept. Nothing on-chain is affected.",
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
                  registryStore.set([]);
                  try {
                    localStorage.removeItem("qs.discovered-pairs.v1");
                  } catch {
                    /* ignore */
                  }
                  handle.close();
                },
              },
            },
            "Clear",
          ),
        ),
      ),
    });
  }

  const node = el(
    "div",
    { class: "page narrow" },
    pageHeader("Settings"),
    el(
      "div",
      { class: "stack" },
      card(
        el("h3", {}, "Swap defaults"),
        el(
          "div",
          { class: "row", style: { padding: "8px 0" } },
          el("span", { class: "k" }, "Slippage tolerance (%)"),
          slippageInput,
        ),
        el(
          "label",
          { class: "row", style: { padding: "8px 0", cursor: "pointer" } },
          el("span", { class: "k" }, "Expert mode"),
          expertToggle,
        ),
      ),
      card(el("h3", {}, "Imported tokens"), importedWrap),
      card(
        el("h3", {}, "Network"),
        el(
          "div",
          { class: "details" },
          statRow("Network", `${NETWORK_NAME} (chain ${CHAIN_ID})`),
          statRow("Block explorer", el("a", { class: "link", href: BLOCK_EXPLORER, target: "_blank", rel: "noopener noreferrer" }, BLOCK_EXPLORER)),
        ),
      ),
      card(
        el("h3", {}, "Contracts"),
        el("p", { class: "mb12" }, "The core QuantumSwap contracts this app talks to on-chain."),
        el("button", { class: "btn btn-ghost", on: { click: () => openContractsDialog() } }, "View contract addresses"),
      ),
      card(
        el("h3", {}, "Local cache"),
        el("p", { class: "mb12" }, "Imported tokens, discovered pairs, and transaction history are stored in your browser only."),
        el("button", { class: "btn btn-ghost", on: { click: () => confirmClearCache() } }, "Clear discovered pairs & history"),
      ),
    ),
  );

  const unsub = tokenStore.subscribe(() => renderImported());
  renderImported();

  return {
    node,
    theme: "amber",
    title: "Settings",
    cleanup: () => {
      unsub();
    },
  };
}

function numberInput(value: string, onChange: (v: number) => void): HTMLInputElement {
  return el("input", {
    class: "mini-input",
    type: "text",
    inputmode: "decimal",
    value,
    on: {
      change: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onChange(v);
      },
    },
  }) as HTMLInputElement;
}

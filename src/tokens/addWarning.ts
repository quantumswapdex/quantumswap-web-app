/**
 * Mandatory acknowledge-before-add warning for importing an unrecognized token
 * (a standard "import at your own risk" gate). The user must tick the
 * acknowledgement before the confirm button enables. Styled like the preview
 * import dialogs (warn-box / token-meta / check-row / dlg-cta).
 */

import { el } from "../ui/dom";
import { openModal } from "../ui/components/modal";
import { looksLikeAddress } from "../lib/sanitize";
import { checkImport, type TokenMetadata } from "./tokenList";

function warnBox(): HTMLElement {
  return el(
    "div",
    { class: "warn-box" },
    el("div", { class: "warn-title" }, "Trade at your own risk"),
    el(
      "p",
      {},
      "This token isn't on the default list. Anyone can create a token with any name, including copies of existing tokens. Verify the contract address is the one you trust - it is the only source of truth.",
    ),
  );
}

function tokenMeta(meta: TokenMetadata): HTMLElement {
  return el(
    "div",
    { class: "token-meta" },
    el(
      "div",
      { class: "tm-head" },
      el("span", { class: "tm-sym" }, meta.symbol),
      el("span", { class: "tm-dec" }, `${meta.decimals} decimals`),
    ),
    el("div", { class: "tm-name" }, meta.name),
    el("div", { class: "tm-addr" }, meta.address),
  );
}

function ackRow(onChange: (checked: boolean) => void): HTMLElement {
  const checkbox = el("input", {
    type: "checkbox",
    on: { change: (e: Event) => onChange((e.target as HTMLInputElement).checked) },
  });
  return el(
    "label",
    { class: "check-row", style: { marginTop: "12px" } },
    checkbox,
    "I understand this is an unrecognized token and I take full responsibility for using it.",
  );
}

export function confirmImportToken(meta: TokenMetadata): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmBtn = el(
      "button",
      { class: "dlg-cta", disabled: true, on: { click: () => finish(true) } },
      "Import token",
    );

    const body = el(
      "div",
      {},
      warnBox(),
      tokenMeta(meta),
      ackRow((checked) => {
        if (checked) confirmBtn.removeAttribute("disabled");
        else confirmBtn.setAttribute("disabled", "");
      }),
      confirmBtn,
    );

    let settled = false;
    const handle = openModal({
      title: "Import unrecognized token",
      body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    function finish(ok: boolean): void {
      if (settled) return;
      settled = true;
      resolve(ok);
      handle.close();
    }
  });
}

/**
 * Import-by-address dialog: the user pastes a token contract address, the
 * token metadata is looked up on-chain, and the import confirms only with a
 * valid token plus the acknowledgement. Resolves with the confirmed metadata,
 * or null if the user dismissed the dialog.
 */
export function importTokenByAddress(initialAddress?: string): Promise<TokenMetadata | null> {
  return new Promise((resolve) => {
    let acknowledged = false;
    let found: TokenMetadata | null = null;
    let lookupSeq = 0;

    const confirmBtn = el(
      "button",
      { class: "dlg-cta", disabled: true, on: { click: () => finish(found) } },
      "Import token",
    );

    function syncConfirm(): void {
      if (found && acknowledged) confirmBtn.removeAttribute("disabled");
      else confirmBtn.setAttribute("disabled", "");
    }

    const statusEl = el("div", { class: "dd-status" });
    const metaWrap = el("div", { class: "hidden" });

    function renderMeta(): void {
      metaWrap.replaceChildren();
      if (!found) {
        metaWrap.classList.add("hidden");
        return;
      }
      metaWrap.classList.remove("hidden");
      metaWrap.appendChild(tokenMeta(found));
    }

    async function lookup(value: string): Promise<void> {
      const seq = ++lookupSeq;
      found = null;
      renderMeta();
      syncConfirm();
      if (!value.trim()) {
        statusEl.textContent = "";
        return;
      }
      if (!looksLikeAddress(value)) {
        statusEl.textContent = "Enter a valid 32-byte address (0x + 64 hex characters).";
        return;
      }
      statusEl.textContent = "Looking up token on-chain...";
      const result = await checkImport(value.trim());
      if (seq !== lookupSeq) return; // superseded by newer input
      if (result.ok && result.token) {
        found = result.token;
        statusEl.textContent = "";
      } else {
        statusEl.textContent = result.reason ?? "Token not found.";
      }
      renderMeta();
      syncConfirm();
    }

    const addressInput = el("input", {
      class: "dd-search mono",
      type: "text",
      placeholder: "Paste the token contract address (0x...)",
      autocomplete: "off",
      spellcheck: "false",
      value: initialAddress ?? "",
      on: { input: () => void lookup(addressInput.value) },
    }) as HTMLInputElement;

    const body = el(
      "div",
      {},
      el(
        "div",
        { class: "field" },
        el("div", { class: "field-label" }, "Token contract address"),
        addressInput,
        statusEl,
      ),
      warnBox(),
      metaWrap,
      ackRow((checked) => {
        acknowledged = checked;
        syncConfirm();
      }),
      confirmBtn,
    );

    let settled = false;
    const handle = openModal({
      title: "Import unrecognized token",
      body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });

    if (initialAddress) void lookup(initialAddress);
    addressInput.focus();

    function finish(meta: TokenMetadata | null): void {
      if (settled) return;
      settled = true;
      resolve(meta);
      handle.close();
    }
  });
}

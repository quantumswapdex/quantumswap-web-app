/** Create a custom ERC20 token: deploy a hardcoded CreatedToken contract via the extension and auto-import it. */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { trackTxToast } from "../ui/components/txToast";
import { showToast } from "../ui/components/toast";
import { openTxStepsDialog, type TxStep } from "../ui/components/txSteps";
import { impersonatesStablecoin } from "../config/chain";
import { parseAmount, sanitizeAmountString, stripHostileKeepInner } from "../lib/sanitize";
import { sanitizeAddressResponse, MAX_NAME_LEN, MAX_SYMBOL_LEN } from "../lib/sanitizeResponse";
import { sendTx, waitForReceipt } from "../lib/tx";
import { recordTx } from "../lib/txStore";
import { importToken } from "../tokens/tokenList";
import { connectWallet, walletStore } from "../wallet/wallet";
import { CREATED_TOKEN_ABI, CREATED_TOKEN_BYTECODE, createdTokenDeployData } from "../lib/createdToken";

const SYMBOL_RE = /^[A-Za-z0-9]{1,16}$/;
const MIN_DECIMALS = 1;
const MAX_DECIMALS = 18;
/** Cap human input at 1e30 whole tokens (still safely representable in base units). */
const MAX_HUMAN_EXP = 30;

interface FieldErrors {
  name?: string;
  symbol?: string;
  supply?: string;
  stable?: string;
}

export function createTokenView(): ViewResult {
  let name = "";
  let symbol = "";
  let decimals = 18;
  let totalSupply = "";
  let submitting = false;

  const nameErr = el("div", { class: "dd-status" });
  const symbolErr = el("div", { class: "dd-status" });
  const supplyErr = el("div", { class: "dd-status" });
  const status = el("div", { class: "dd-status" });
  const actionBox = el("div", {});

  const nameInput = el("input", {
    class: "dd-search",
    type: "text",
    placeholder: "e.g. Quantum Token",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: String(MAX_NAME_LEN),
    on: { input: () => onFormChange() },
  }) as HTMLInputElement;

  const symbolInput = el("input", {
    class: "dd-search",
    type: "text",
    placeholder: "e.g. QTK",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: String(MAX_SYMBOL_LEN),
    on: { input: () => onFormChange() },
  }) as HTMLInputElement;

  const decimalsSelect = el("select", { class: "dd-search", on: { change: () => onFormChange() } }) as HTMLSelectElement;
  for (let d = MIN_DECIMALS; d <= MAX_DECIMALS; d++) {
    const opt = el("option", { value: String(d) }, String(d));
    if (d === 18) opt.setAttribute("selected", "");
    decimalsSelect.appendChild(opt);
  }

  const supplyInput = el("input", {
    class: "dd-search",
    type: "text",
    inputmode: "decimal",
    placeholder: "e.g. 1000000",
    autocomplete: "off",
    spellcheck: "false",
    on: { input: () => onFormChange() },
  }) as HTMLInputElement;

  const node = el(
    "section",
    { class: "swap-card" },
    el("div", { class: "swap-head" }, el("h1", {}, "Create a token")),
    el(
      "div",
      { class: "field" },
      el("div", { class: "field-label" }, "Name"),
      nameInput,
      nameErr,
    ),
    el(
      "div",
      { class: "field" },
      el("div", { class: "field-label" }, "Symbol"),
      symbolInput,
      symbolErr,
    ),
    el(
      "div",
      { class: "field" },
      el("div", { class: "field-label" }, "Decimals"),
      decimalsSelect,
    ),
    el(
      "div",
      { class: "field" },
      el("div", { class: "field-label" }, "Total supply"),
      supplyInput,
      el("div", { class: "field-help", style: { fontSize: "12px", color: "rgba(255,255,255,0.55)", marginTop: "6px" } }, "Unit: coins (whole tokens). Converted to base units using the decimals above."),
      supplyErr,
    ),
    el(
      "p",
      { class: "cf-note" },
      "Deploys a standard ERC20 token (with transferOwnership) via your wallet. The full supply is minted to you (the creator) and the token is added to your list automatically.",
    ),
    status,
    actionBox,
  );

  function onFormChange(): void {
    name = stripHostileKeepInner(nameInput.value);
    symbol = stripHostileKeepInner(symbolInput.value);
    decimals = clampDecimals(Number(decimalsSelect.value));
    totalSupply = supplyInput.value;
    renderAction();
  }

  function validate(): { errors: FieldErrors; baseUnits: bigint | null; valid: boolean } {
    const errors: FieldErrors = {};
    const n = stripHostileKeepInner(name);
    if (n.length === 0) errors.name = "Enter a name.";
    else if (n.length > MAX_NAME_LEN) errors.name = `Name must be ${MAX_NAME_LEN} characters or fewer.`;

    const s = stripHostileKeepInner(symbol);
    if (s.length === 0) errors.symbol = "Enter a symbol.";
    else if (s.length > MAX_SYMBOL_LEN) errors.symbol = `Symbol must be ${MAX_SYMBOL_LEN} characters or fewer.`;
    else if (!SYMBOL_RE.test(s)) errors.symbol = "Symbol must be letters and numbers only.";

    // Stablecoin/fiat-name guard: loadImported re-applies this on every reload
    // and would silently drop a token that matches, so reject it up front.
    if (!errors.name && !errors.symbol && impersonatesStablecoin(s, n)) {
      errors.stable = "This name or symbol looks like a stablecoin or fiat currency and can't be used.";
    }

    let baseUnits: bigint | null = null;
    const normalized = sanitizeAmountString(totalSupply, decimals);
    if (normalized === null) {
      errors.supply = "Enter a positive number.";
    } else {
      const [intPart] = normalized.split(".");
      if (intPart.replace(/^0+(?=\d)/, "").length > MAX_HUMAN_EXP + 1) {
        errors.supply = "Total supply is too large (max 1e30 whole tokens).";
      } else {
        const human = Number(normalized);
        if (!(human > 0)) {
          errors.supply = "Total supply must be greater than 0.";
        } else if (human > 10 ** MAX_HUMAN_EXP) {
          errors.supply = "Total supply is too large (max 1e30 whole tokens).";
        } else {
          baseUnits = parseAmount(normalized, decimals);
          if (baseUnits === null || baseUnits <= 0n) errors.supply = "Total supply must be greater than 0.";
        }
      }
    }

    const valid = Object.keys(errors).length === 0;
    return { errors, baseUnits, valid };
  }

  function renderAction(): void {
    const { errors, baseUnits, valid } = validate();
    nameErr.textContent = errors.name ?? "";
    symbolErr.textContent = errors.symbol ?? "";
    supplyErr.textContent = errors.supply ?? "";
    clear(status);
    clear(actionBox);

    if (walletStore.get().status !== "connected") {
      actionBox.appendChild(el("button", { class: "cta", on: { click: () => void connectWallet() } }, "Connect wallet"));
      return;
    }

    if (errors.stable) {
      status.appendChild(
        el("div", { class: "warn-box" }, el("div", { class: "warn-title" }, "Choose a different name or symbol"), el("p", {}, errors.stable)),
      );
    }

    const canCreate = valid && baseUnits !== null && !submitting;
    actionBox.appendChild(
      el(
        "button",
        {
          class: "cta",
          disabled: canCreate ? undefined : true,
          on: {
            click: () => {
              if (canCreate && baseUnits !== null) doCreate(stripHostileKeepInner(name), stripHostileKeepInner(symbol), decimals, baseUnits);
            },
          },
        },
        "Create token",
      ),
    );
  }

  function doCreate(nameVal: string, symbolVal: string, decimalsVal: number, totalSupplyBase: bigint): void {
    submitting = true;
    renderAction();
    let deployedAddress: string | null = null;
    openTxStepsDialog({
      title: "Create token",
      buildSteps: () => buildCreateTokenSteps(nameVal, symbolVal, decimalsVal, totalSupplyBase, (addr) => { deployedAddress = addr; }),
      onClose: () => {
        submitting = false;
        renderAction();
        // Navigate only after the user dismisses the step dialog, so they can
        // see the "done" state before leaving the create page.
        if (deployedAddress) location.hash = `#/explore/tokens/${deployedAddress}`;
      },
    });
  }

  const unsub = walletStore.subscribe(() => renderAction());
  renderAction();

  return {
    node,
    theme: "emerald",
    title: "Create a token",
    cleanup: () => unsub(),
  };
}

async function buildCreateTokenSteps(
  name: string,
  symbol: string,
  decimals: number,
  totalSupplyBase: bigint,
  onDeployed: (address: string) => void,
): Promise<TxStep[]> {
  return [
    {
      label: "Deploy token",
      run: async (onAccepted) => {
        const data = createdTokenDeployData(name, symbol, decimals, totalSupplyBase);
        // No `to` -> the extension treats this as a contract deployment.
        // `bytecode` (creation code, no ctor args) is required by the extension
        // to verify the deployment; `data` is bytecode + ABI-encoded ctor args.
        const hash = await sendTx({ data, value: 0n, abi: CREATED_TOKEN_ABI, bytecode: CREATED_TOKEN_BYTECODE });
        recordTx(hash, `Create token ${symbol}`);
        trackTxToast(
          hash,
          "pair",
          { pending: "Deploying token", success: "Token deployed", failure: "Deploy failed" },
          symbol,
        );
        onAccepted(hash);
        const receipt = await waitForReceipt(hash);
        if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
          throw new Error("Deployment was not confirmed on-chain");
        }
        const address = sanitizeAddressResponse(receipt.contractAddress);
        if (!address) throw new Error("Deployed, but the receipt returned an invalid contract address");
        // Auto-import without the warning dialog; do NOT navigate here.
        importToken({ address, name, symbol, decimals });
        showToast({ kind: "success", title: "Token created", message: `${symbol} deployed and added to your list.`, autoDismissMs: 5000 });
        onDeployed(address);
      },
    },
  ];
}

function clampDecimals(n: number): number {
  if (!Number.isFinite(n)) return 18;
  const d = Math.trunc(n);
  if (d < MIN_DECIMALS) return MIN_DECIMALS;
  if (d > MAX_DECIMALS) return MAX_DECIMALS;
  return d;
}

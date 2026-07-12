/**
 * Transaction settings dialog (gear icon), matching the preview settings
 * overlay: slippage chips + custom input, expert mode, and an OK button.
 * Edits are staged locally; only OK commits them to the settings store.
 * Closing via (x), the backdrop, or Escape discards the staged edits.
 */

import { el } from "../ui/dom";
import { openModal } from "../ui/components/modal";
import { settingsStore, setExpertMode, setSlippage } from "../config/settings";

const PRESETS = [0.1, 0.5, 1];

export function openSettingsPopover(_anchor?: HTMLElement): void {
  const current = settingsStore.get();

  // Staged values - written to the store only when the user clicks OK.
  let stagedSlippage = current.slippagePercent;
  let stagedExpert = current.expertMode;

  const customInput = el("input", {
    class: "mini-input",
    type: "text",
    inputmode: "decimal",
    placeholder: "0.5",
    value: String(current.slippagePercent),
    on: {
      change: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          stagedSlippage = v;
          refreshChips();
        }
      },
    },
  }) as HTMLInputElement;

  const presetButtons = PRESETS.map((p) =>
    el(
      "button",
      {
        class: "chip",
        dataset: { slip: p },
        on: {
          click: () => {
            stagedSlippage = p;
            customInput.value = String(p);
            refreshChips();
          },
        },
      },
      `${p}%`,
    ),
  );

  function refreshChips(): void {
    presetButtons.forEach((btn, i) => btn.classList.toggle("active", PRESETS[i] === stagedSlippage));
  }
  refreshChips();

  const expertToggle = el("input", {
    type: "checkbox",
    on: { change: (e: Event) => (stagedExpert = (e.target as HTMLInputElement).checked) },
    ...(current.expertMode ? { checked: true } : {}),
  }) as HTMLInputElement;

  const okBtn = el(
    "button",
    {
      class: "dlg-cta",
      on: {
        click: () => {
          setSlippage(stagedSlippage);
          setExpertMode(stagedExpert);
          handle.close();
        },
      },
    },
    "OK",
  );

  const body = el(
    "div",
    {},
    el(
      "div",
      { class: "field" },
      el("div", { class: "field-label" }, "Slippage tolerance"),
      el("div", { class: "chips" }, ...presetButtons, customInput, el("span", { class: "unit" }, "%")),
    ),
    el("label", { class: "check-row" }, expertToggle, "Expert mode (skip confirmations, allow high slippage)"),
    okBtn,
  );

  const handle = openModal({ title: "Transaction settings", body });
}

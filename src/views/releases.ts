/** Releases: switch the active on-chain deployment (built-in Beta 1 or a
 * user-added custom release) and add new custom releases by contract address.
 * The active release is persisted and read at call time by the rest of the app,
 * so changing it here takes effect everywhere (see src/config/releases.ts). */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { card, pageHeader } from "./shared";
import { openModal } from "../ui/components/modal";
import {
  addCustomRelease,
  releaseStore,
  removeCustom,
  setDefault,
  type Release,
} from "../config/releases";

export function releasesView(): ViewResult {
  const listWrap = el("div", { class: "stack" });

  function renderList(): void {
    clear(listWrap);
    const { releases, defaultId } = releaseStore.get();
    for (const rel of releases) {
      listWrap.appendChild(releaseCard(rel, rel.id === defaultId));
    }
  }

  function releaseCard(rel: Release, isActive: boolean): HTMLElement {
    const addr = (label: string, value: string) =>
      el(
        "div",
        { class: "field" },
        el("div", { class: "field-label" }, label),
        el("div", { class: "full-addr" }, value),
      );

    const makeDefaultBtn = el(
      "button",
      {
        class: isActive ? "btn btn-ghost" : "btn btn-primary",
        disabled: isActive ? true : undefined,
        on: { click: () => setDefault(rel.id) },
      },
      isActive ? "Default" : "Make default",
    );

    const actions = el("div", { class: "btn-row" }, makeDefaultBtn);
    if (!rel.builtin) {
      actions.appendChild(
        el(
          "button",
          {
            class: "btn btn-danger",
            on: { click: () => removeCustom(rel.id) },
          },
          "Remove",
        ),
      );
    }

    return card(
      el(
        "div",
        { class: "row", style: { alignItems: "center", padding: "0 0 8px" } },
        el("h3", { style: { margin: "0" } }, rel.name),
        el(
          "span",
          { class: "muted", style: { fontSize: "12px" } },
          rel.builtin ? "Built-in" : "Custom",
        ),
      ),
      addr("Wrapped Q (WQ)", rel.wq),
      addr("Factory", rel.factory),
      addr("Router", rel.router),
      el("div", { style: { marginTop: "10px" } }, actions),
    );
  }

  // ---------- Add custom release (modal) ----------
  function openAddCustomModal(): void {
    const nameInput = formInput("Release name (e.g. Prod 1)", false);
    const wqInput = formInput("WQ address (0x...)", true);
    const factoryInput = formInput("Factory address (0x...)", true);
    const routerInput = formInput("Router address (0x...)", true);

    const addBtn = el("button", { class: "btn btn-primary", on: { click: () => submit() } }, "Add release");
    const actionRow = el("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "14px" } }, addBtn);

    const body = el(
      "div",
      {},
      el(
        "p",
        { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0 0 12px" } },
        "Point the app at a different deployment by entering its core contract addresses. The release is stored in your browser only.",
      ),
      field("Name", nameInput),
      field("WQ address", wqInput),
      field("Factory address", factoryInput),
      field("Router address", routerInput),
      actionRow,
    );

    const handle = openModal({ title: "Add custom release", body, wide: true });
    // Widen so a full 32-byte address (66 chars) fits without horizontal scroll.
    handle.root.style.width = "560px";
    nameInput.focus();

    function submit(): void {
      const res = addCustomRelease(nameInput.value, wqInput.value, factoryInput.value, routerInput.value);
      if (!res.ok) {
        openErrorModal(res.error ?? "Could not add the release.");
        return;
      }
      // Added to the list only; the user explicitly makes it default via "Make default".
      handle.close();
    }
  }

  function openErrorModal(message: string): void {
    const handle = openModal({
      title: "Could not add release",
      body: el(
        "div",
        {},
        el(
          "p",
          { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0 0 12px" } },
          message,
        ),
        el(
          "div",
          { style: { display: "flex", justifyContent: "flex-end" } },
          el("button", { class: "btn btn-primary", on: { click: () => handle.close() } }, "Close"),
        ),
      ),
    });
  }

  const node = el(
    "div",
    { class: "page narrow" },
    pageHeader("Releases", "Choose which on-chain deployment this app talks to."),
    el(
      "div",
      { class: "stack" },
      listWrap,
      card(
        el("h3", {}, "Custom release"),
        el(
          "p",
          { class: "muted", style: { fontSize: "13px", lineHeight: "1.55", margin: "0 0 10px" } },
          "Add a custom deployment by entering its core contract addresses. The release is stored in your browser only.",
        ),
        el(
          "div",
          { style: { display: "flex", justifyContent: "flex-end" } },
          el("button", { class: "btn btn-primary", on: { click: () => openAddCustomModal() } }, "Add custom release"),
        ),
      ),
    ),
  );

  const unsub = releaseStore.subscribe(() => renderList());
  renderList();

  return {
    node,
    theme: "amber",
    title: "Releases",
    cleanup: () => {
      unsub();
    },
  };
}

function field(label: string, input: HTMLElement): HTMLElement {
  return el("div", { class: "field" }, el("div", { class: "field-label" }, label), input);
}

/** Wide text input sized for a 32-byte address (0x + 64 hex = 66 chars). */
function formInput(placeholder: string, mono: boolean): HTMLInputElement {
  return el("input", {
    class: mono ? "dd-search mono" : "dd-search",
    type: "text",
    placeholder,
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "66",
    "aria-label": placeholder,
  }) as HTMLInputElement;
}

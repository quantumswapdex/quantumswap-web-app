/** Accessible modal dialog styled like the preview overlays (.overlay/.dialog). */

import { el, mount } from "../dom";

export interface ModalHandle {
  close: () => void;
  setBody: (...nodes: (Node | string)[]) => void;
  root: HTMLElement;
}

export function openModal(opts: {
  title: string;
  body: Node | (Node | string)[];
  onClose?: () => void;
  /** When false, the modal cannot be dismissed by the user (no X, overlay, or Escape). */
  dismissable?: boolean;
  /** Wider dialog variant (e.g. token lists with full addresses). */
  wide?: boolean;
}): ModalHandle {
  const dismissable = opts.dismissable !== false;
  const bodyWrap = el("div", {});
  const bodyNodes = Array.isArray(opts.body) ? opts.body : [opts.body];
  mount(bodyWrap, ...bodyNodes);

  const dialog = el(
    "div",
    {
      class: `dialog${opts.wide ? " wide" : ""}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": opts.title,
    },
    el(
      "div",
      { class: "pop-head" },
      el("span", { class: "dlg-title" }, opts.title),
      dismissable
        ? el("button", { class: "pop-close", "aria-label": "Close", on: { click: () => close() } }, "\u2715")
        : null,
    ),
    bodyWrap,
  );

  const overlay = el(
    "div",
    {
      class: "overlay open",
      on: {
        click: (e: Event) => {
          if (dismissable && e.target === overlay) close();
        },
      },
    },
    dialog,
  );

  function onKey(e: KeyboardEvent): void {
    if (dismissable && e.key === "Escape") close();
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    opts.onClose?.();
  }

  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);

  return {
    close,
    root: dialog,
    setBody: (...nodes) => mount(bodyWrap, ...nodes),
  };
}

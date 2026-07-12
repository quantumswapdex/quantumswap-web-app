/**
 * Transaction/notification toaster (pending -> submitted -> success/failed),
 * styled like the preview toast (bottom-right, spinner on pending).
 */

import { el, safeUrl } from "../dom";

export type ToastKind = "info" | "pending" | "success" | "error";

export interface ToastHandle {
  update: (patch: { kind?: ToastKind; title?: string; message?: string; link?: { href: string; label: string } }) => void;
  dismiss: () => void;
}

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = el("div", { class: "toast-stack", "aria-live": "polite" });
  document.body.appendChild(container);
  return container;
}

const KIND_CLASS: Record<ToastKind, string> = {
  info: "",
  pending: " t-pending",
  success: " t-success",
  error: " t-error",
};

export function showToast(opts: {
  kind?: ToastKind;
  title: string;
  message?: string;
  link?: { href: string; label: string };
  autoDismissMs?: number;
}): ToastHandle {
  const root = ensureContainer();
  const titleRow = el("div", { class: "t-title" });
  const msgEl = el("div", { class: "t-msg" });

  const card = el("div", { class: "toast", role: "status" }, titleRow, msgEl);
  root.appendChild(card);

  let timer: number | undefined;
  let currentKind: ToastKind = opts.kind ?? "info";

  function render(kind: ToastKind, title: string, message?: string, link?: { href: string; label: string }): void {
    currentKind = kind;
    card.setAttribute("class", `toast${KIND_CLASS[kind]}`);
    titleRow.replaceChildren();
    if (kind === "pending") titleRow.appendChild(el("span", { class: "spinner" }));
    titleRow.appendChild(el("span", {}, title));
    msgEl.replaceChildren();
    if (message) msgEl.appendChild(el("span", {}, message + (link ? " " : "")));
    if (link) {
      msgEl.appendChild(
        el("a", { href: safeUrl(link.href), target: link.href.startsWith("#") ? undefined : "_blank", rel: "noopener noreferrer" }, link.label),
      );
    }
  }

  render(currentKind, opts.title, opts.message, opts.link);

  function dismiss(): void {
    if (timer) window.clearTimeout(timer);
    card.remove();
  }

  if (opts.autoDismissMs) timer = window.setTimeout(dismiss, opts.autoDismissMs);

  return {
    dismiss,
    update: (patch) => {
      render(patch.kind ?? currentKind, patch.title ?? titleRow.textContent ?? "", patch.message ?? msgEl.textContent ?? undefined, patch.link);
      if (patch.kind === "success" || patch.kind === "error") {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(dismiss, 8000);
      }
    },
  };
}

/**
 * Transaction/notification toaster (pending -> submitted -> success/failed),
 * styled like the preview toast (bottom-right, spinner on pending).
 */

import { el, safeUrl } from "../dom";

export type ToastKind = "info" | "pending" | "success" | "error";

/** Per-action color identity (stripe, glow, spinner/dot color). */
export type ToastAccent = "swap" | "wrap" | "liquidity" | "remove" | "pair" | "approve";

export interface ToastLink {
  href: string;
  label: string;
}

export interface ToastHandle {
  update: (patch: {
    kind?: ToastKind;
    title?: string;
    message?: string;
    link?: ToastLink;
    links?: ToastLink[];
    autoDismissMs?: number;
  }) => void;
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
  accent?: ToastAccent;
  title: string;
  message?: string;
  link?: ToastLink;
  links?: ToastLink[];
  autoDismissMs?: number;
}): ToastHandle {
  const root = ensureContainer();
  const titleRow = el("div", { class: "t-title" });
  const msgEl = el("div", { class: "t-msg" });

  const card = el("div", { class: "toast", role: "status" }, titleRow, msgEl);
  root.appendChild(card);

  let timer: number | undefined;
  let currentKind: ToastKind = opts.kind ?? "info";
  const accentClass = opts.accent ? ` has-accent a-${opts.accent}` : "";
  let currentLinks: ToastLink[] | undefined = normalizeLinks(opts.links, opts.link);

  function render(kind: ToastKind, title: string, message?: string, links?: ToastLink[]): void {
    currentKind = kind;
    card.setAttribute("class", `toast${KIND_CLASS[kind]}${accentClass}`);
    titleRow.replaceChildren();
    if (kind === "pending") titleRow.appendChild(el("span", { class: "spinner" }));
    else if (opts.accent) titleRow.appendChild(el("span", { class: "t-dot" }));
    titleRow.appendChild(el("span", {}, title));
    msgEl.replaceChildren();
    if (message) msgEl.appendChild(el("span", {}, message + (links?.length ? " " : "")));
    if (links) {
      links.forEach((l, i) => {
        if (i > 0) msgEl.appendChild(el("span", { class: "t-link-sep" }, "·"));
        msgEl.appendChild(
          el("a", { href: safeUrl(l.href), target: l.href.startsWith("#") ? undefined : "_blank", rel: "noopener noreferrer" }, l.label),
        );
      });
    }
  }

  render(currentKind, opts.title, opts.message, currentLinks);

  function dismiss(): void {
    if (timer) window.clearTimeout(timer);
    card.remove();
  }

  if (opts.autoDismissMs) timer = window.setTimeout(dismiss, opts.autoDismissMs);

  return {
    dismiss,
    update: (patch) => {
      if (patch.links !== undefined || patch.link !== undefined) {
        currentLinks = normalizeLinks(patch.links, patch.link);
      }
      render(patch.kind ?? currentKind, patch.title ?? titleRow.textContent ?? "", patch.message ?? msgEl.textContent ?? undefined, currentLinks);
      if (patch.autoDismissMs || patch.kind === "success" || patch.kind === "error") {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(dismiss, patch.autoDismissMs ?? 8000);
      }
    },
  };
}

function normalizeLinks(links?: ToastLink[], single?: ToastLink): ToastLink[] | undefined {
  if (links && links.length) return links;
  if (single) return [single];
  return undefined;
}

/** Address pill: truncated (or full) mono address + copy + explorer link. */

import { el } from "../dom";
import { shortAddress } from "../../lib/format";
import { explorerAddressUrl } from "../../config/chain";

export function copyToClipboard(textValue: string): void {
  try {
    void navigator.clipboard?.writeText(textValue);
  } catch {
    /* clipboard unavailable */
  }
}

export function addressPill(address: string, opts?: { link?: boolean; full?: boolean }): HTMLElement {
  const copyBtn = el(
    "button",
    {
      title: "Copy address",
      "aria-label": "Copy address",
      on: {
        click: () => {
          copyToClipboard(address);
          copyBtn.textContent = "\u2713";
          window.setTimeout(() => (copyBtn.textContent = "\u2398"), 1200);
        },
      },
    },
    "\u2398",
  );

  const children: (HTMLElement | string)[] = [
    el("span", { title: address }, opts?.full ? address : shortAddress(address)),
    copyBtn,
  ];

  if (opts?.link !== false) {
    children.push(
      el(
        "a",
        {
          href: explorerAddressUrl(address),
          target: "_blank",
          rel: "noopener noreferrer",
          title: "View on quantumscan",
        },
        "\u2197",
      ),
    );
  }

  return el("span", { class: `pill${opts?.full ? " wrap" : ""}` }, ...children);
}

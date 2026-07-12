/** 404 fallback view. */

import { el } from "../ui/dom";
import type { ViewResult } from "../ui/router";

export function notFoundView(): ViewResult {
  const node = el(
    "div",
    { class: "panel state stack-state", style: { width: "438px", maxWidth: "100%" } },
    el("h1", { style: { fontFamily: "var(--headline)", fontSize: "34px", color: "#fff", margin: "0" } }, "404"),
    el("p", {}, "That page does not exist."),
    el("a", { class: "btn btn-primary", href: "#/" }, "Back to Swap"),
  );
  return { node, theme: "violet", title: "Not found" };
}

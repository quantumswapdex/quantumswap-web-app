/** Ambient background orbs (decorative only), identical to the preview pages. */

import { el, fragment } from "../dom";

export function orbs(): DocumentFragment {
  return fragment(
    el("div", { class: "orb orb-1", "aria-hidden": "true" }),
    el("div", { class: "orb orb-1b", "aria-hidden": "true" }),
    el("div", { class: "orb orb-2", "aria-hidden": "true" }),
    el("div", { class: "orb orb-2b", "aria-hidden": "true" }),
  );
}

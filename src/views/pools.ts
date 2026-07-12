/** Pools landing: entry points for add/create/remove and a link to positions. */

import { el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { pageHeader } from "./shared";

export function poolsView(): ViewResult {
  const node = el(
    "div",
    { class: "page" },
    pageHeader("Liquidity", "Provide liquidity to earn a 0.30% fee on swaps routed through your pool."),
    el(
      "div",
      { class: "stack" },
      el(
        "div",
        { class: "grid3" },
        action("Add liquidity", "Deposit two tokens into an existing pool (or create it on first deposit).", "#/pools/add", "Add"),
        action("Create a pair", "Explicitly create a new empty pair via the factory.", "#/pools/create", "Create"),
        action("My positions", "View and manage your existing LP positions.", "#/positions", "View"),
      ),
      el(
        "div",
        { class: "panel" },
        el("h3", {}, "How it works"),
        el(
          "ul",
          {},
          el("li", {}, "Adding liquidity mints LP tokens representing your share of the pool."),
          el("li", {}, "You earn a proportional share of the 0.30% fee on every swap."),
          el("li", {}, "Withdraw any time by removing liquidity to redeem your underlying tokens."),
          el("li", {}, "The first provider of a pair sets the initial price via the deposit ratio."),
        ),
      ),
    ),
  );
  return { node, theme: "nebula", title: "Liquidity" };
}

function action(title: string, body: string, href: string, cta: string): HTMLElement {
  return el(
    "div",
    { class: "panel" },
    el("h3", {}, title),
    el("p", {}, body),
    el("a", { class: "btn btn-primary", href, style: { marginTop: "14px", alignSelf: "flex-start" } }, cta),
  );
}

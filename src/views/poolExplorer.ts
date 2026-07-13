/**
 * Pool Explorer: registry-driven table of pairs with reserves + derived price,
 * plus an optional heavier "Load all pairs from factory" walk.
 */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { emptyState, errText, loadingState, pageHeader } from "./shared";
import { wqAddress } from "../config/releases";
import { pair as pairContract } from "../lib/contracts";
import { discoverAllFromFactory, discoverKnownPairs, registryStore } from "../lib/pairRegistry";
import type { PairRecord } from "../config/pairs";
import { sanitizeReserves } from "../lib/sanitizeResponse";
import { formatCompact, formatPrice } from "../lib/format";
import { walletStore } from "../wallet/wallet";
import { sanitizeQuery } from "../lib/sanitize";
import { txStore } from "../lib/txStore";

export function poolExplorerView(): ViewResult {
  let query = "";
  const tableWrap = el("div", {});
  const statusEl = el("div", { class: "ts", style: { marginBottom: "10px" } });

  const searchInput = el("input", {
    class: "filter-input",
    type: "search",
    placeholder: "Filter by symbol...",
    on: {
      input: () => {
        query = sanitizeQuery((searchInput as HTMLInputElement).value).toLowerCase();
        renderTable();
      },
    },
  }) as HTMLInputElement;

  const loadAllBtn = el(
    "button",
    { class: "btn btn-ghost", on: { click: () => void loadAll() } },
    "Load all pairs from factory",
  );

  const createPairBtn = el(
    "a",
    { class: "btn btn-primary", href: "#/pools/create" },
    "Create Pair",
  );

  const node = el(
    "div",
    { class: "page" },
    pageHeader("Pool Explorer", "Live reserves and prices for known QuantumSwap pairs."),
    el("div", { class: "toolbar" }, searchInput, loadAllBtn, createPairBtn),
    statusEl,
    tableWrap,
  );

  const reservesCache = new Map<string, { r0: bigint; r1: bigint } | null>();

  async function loadReserves(record: PairRecord): Promise<void> {
    if (reservesCache.has(record.pairAddress)) return;
    try {
      const parsed = sanitizeReserves(await pairContract(record.pairAddress).getReserves());
      reservesCache.set(record.pairAddress, parsed ? { r0: parsed.reserve0, r1: parsed.reserve1 } : null);
    } catch {
      reservesCache.set(record.pairAddress, null);
    }
    renderTable();
  }

  function renderTable(): void {
    clear(tableWrap);
    let records = registryStore.get();
    if (query) {
      records = records.filter((r) => `${r.token0.symbol} ${r.token1.symbol}`.toLowerCase().includes(query));
    }

    if (records.length === 0) {
      tableWrap.appendChild(
        emptyState(
          walletStore.get().status === "connected"
            ? "No pairs found yet. Try loading all pairs from the factory, or create one."
            : "Connect your wallet to discover and load pool data.",
          el("a", { class: "btn btn-primary", href: "#/pools/create" }, "Create a pair"),
        ),
      );
      return;
    }

    const rows = records.map((record) => {
      const cached = reservesCache.get(record.pairAddress);
      if (cached === undefined) void loadReserves(record);
      let priceText = "-";
      let tvlText = "-";
      if (cached) {
        const price0 = Number(cached.r1) / Number(cached.r0 || 1n);
        priceText = `${formatPrice(price0)} ${record.token1.symbol}/${record.token0.symbol}`;
        if (record.token0.address.toLowerCase() === wqAddress().toLowerCase()) {
          tvlText = `${formatCompact(cached.r0 * 2n, record.token0.decimals)} Q`;
        } else if (record.token1.address.toLowerCase() === wqAddress().toLowerCase()) {
          tvlText = `${formatCompact(cached.r1 * 2n, record.token1.decimals)} Q`;
        }
      }

      return el(
        "tr",
        { class: "click", on: { click: () => (location.hash = `#/explore/pools/${record.pairAddress}`) } },
        el("td", {}, el("a", { class: "link", href: `#/explore/pools/${record.pairAddress}` }, `${record.token0.symbol} / ${record.token1.symbol}`)),
        el(
          "td",
          {},
          cached ? `${formatCompact(cached.r0, record.token0.decimals)} ${record.token0.symbol} / ${formatCompact(cached.r1, record.token1.decimals)} ${record.token1.symbol}` : "loading...",
        ),
        el("td", {}, priceText),
        el("td", {}, tvlText),
        el(
          "td",
          { style: { textAlign: "right" } },
          el("a", { class: "link", href: `#/swap`, on: { click: (e: Event) => e.stopPropagation() } }, "Swap"),
        ),
      );
    });

    const table = el(
      "div",
      { class: "panel tbl-wrap" },
      el(
        "table",
        { class: "tbl" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", {}, "Pair"),
            el("th", {}, "Reserves"),
            el("th", {}, "Price"),
            el("th", {}, "TVL"),
            el("th", {}, ""),
          ),
        ),
        el("tbody", {}, ...rows),
      ),
    );
    tableWrap.appendChild(table);
  }

  async function discover(): Promise<void> {
    if (walletStore.get().status !== "connected") {
      renderTable();
      return;
    }
    statusEl.textContent = "Discovering known pairs...";
    try {
      await discoverKnownPairs();
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = errText(err);
    }
    renderTable();
  }

  async function loadAll(): Promise<void> {
    if (walletStore.get().status !== "connected") {
      statusEl.textContent = "Connect your wallet first.";
      return;
    }
    loadAllBtn.setAttribute("disabled", "");
    statusEl.textContent = "Loading all pairs from the factory (this can take a moment)...";
    tableWrap.replaceChildren(loadingState("Walking the factory..."));
    try {
      await discoverAllFromFactory();
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = errText(err);
    }
    loadAllBtn.removeAttribute("disabled");
    renderTable();
  }

  const unsub = registryStore.subscribe(() => renderTable());
  const unsubWallet = walletStore.subscribe(() => void discover());

  // When a transaction confirms (swap, add/remove liquidity, ...), the cached
  // reserves are stale: drop the cache so the table re-reads on next render.
  let txStatuses = new Map(txStore.get().map((r) => [r.hash, r.status]));
  const unsubTx = txStore.subscribe((list) => {
    const settled = list.some((r) => txStatuses.get(r.hash) === "pending" && r.status === "succeeded");
    txStatuses = new Map(list.map((r) => [r.hash, r.status]));
    if (settled) {
      reservesCache.clear();
      renderTable();
    }
  });

  void discover();

  return {
    node,
    theme: "cyan",
    title: "Pool Explorer",
    cleanup: () => {
      unsub();
      unsubWallet();
      unsubTx();
    },
  };
}

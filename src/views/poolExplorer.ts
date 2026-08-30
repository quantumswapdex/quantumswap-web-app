/**
 * Pool Explorer: table of pools with reserves + derived price. Pages through
 * the Swap Read API (sorted by liquidity or newest) when it is available;
 * otherwise renders the registry with live RPC reserves (connected wallet),
 * plus the heavier "Load all pairs" walk.
 */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { emptyState, errText, loadingState, pageHeader } from "./shared";
import {
  canRead,
  discoverAllFromFactory,
  getPools,
  invalidate,
  marketStore,
  poolTvlQ,
  type PoolPage,
  type PoolView,
} from "../lib/marketData";
import type { ApiPoolSort } from "../lib/swapApi";
import { formatCompact, formatPrice } from "../lib/format";
import { walletStore } from "../wallet/wallet";
import { sanitizeQuery } from "../lib/sanitize";
import { txStore } from "../lib/txStore";

export function poolExplorerView(): ViewResult {
  let query = "";
  let page = 1;
  let sort: ApiPoolSort = "liquidity";
  let current: PoolPage | null = null;
  let loadSeq = 0;
  const tableWrap = el("div", {});
  const statusEl = el("div", { class: "ts", style: { marginBottom: "10px" } });
  const pagerEl = el("div", { class: "toolbar", style: { marginTop: "10px", justifyContent: "space-between" } });

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

  const sortBtn = el(
    "button",
    {
      class: "btn btn-ghost",
      "aria-label": "Sort pools",
      on: {
        click: () => {
          sort = sort === "liquidity" ? "newest" : "liquidity";
          page = 1;
          sortBtn.textContent = sort === "liquidity" ? "Sort: liquidity" : "Sort: newest";
          void load();
        },
      },
    },
    "Sort: liquidity",
  );

  const loadAllBtn = el(
    "button",
    { class: "btn btn-ghost", on: { click: () => void loadAll() } },
    "Load all pairs",
  );

  const createPairBtn = el(
    "a",
    { class: "btn btn-primary", href: "#/pools/create" },
    "Create Pair",
  );

  const node = el(
    "div",
    { class: "page" },
    pageHeader("Pool Explorer", "Live reserves and prices for QuantumSwap pools."),
    el("div", { class: "toolbar" }, searchInput, sortBtn, loadAllBtn, createPairBtn),
    statusEl,
    tableWrap,
    pagerEl,
  );

  function renderTable(): void {
    clear(tableWrap);
    clear(pagerEl);
    let items = current?.items ?? [];
    if (query) {
      items = items.filter((v) => `${v.record.token0.symbol} ${v.record.token1.symbol}`.toLowerCase().includes(query));
    }

    if (items.length === 0) {
      tableWrap.appendChild(
        emptyState(
          canRead()
            ? "No pools found yet. Try loading all pairs, or create one."
            : "Connect your wallet to discover and load pool data.",
          el("a", { class: "btn btn-primary", href: "#/pools/create" }, "Create a pair"),
        ),
      );
      return;
    }

    const rows = items.map((view) => {
      const { record } = view;
      let priceText = "-";
      let tvlText = "-";
      if (view.active) {
        const price0 = Number(view.reserve1) / Number(view.reserve0 || 1n);
        priceText = `${formatPrice(price0)} ${record.token1.symbol}/${record.token0.symbol}`;
        const tvl = poolTvlQ(view);
        if (tvl !== null) tvlText = `${formatCompact(tvl, 18)} Q`;
      }

      return el(
        "tr",
        { class: "click", on: { click: () => (location.hash = `#/explore/pools/${record.pairAddress}`) } },
        el("td", {}, el("a", { class: "link", href: `#/explore/pools/${record.pairAddress}` }, `${record.token0.symbol} / ${record.token1.symbol}`)),
        el(
          "td",
          {},
          `${formatCompact(view.reserve0, record.token0.decimals)} ${record.token0.symbol} / ${formatCompact(view.reserve1, record.token1.decimals)} ${record.token1.symbol}`,
        ),
        el("td", {}, priceText),
        el("td", {}, tvlText),
        el(
          "td",
          { style: { textAlign: "right" } },
          el("a", { class: "link", href: `#/swap/${record.token0.address}/${record.token1.address}`, on: { click: (e: Event) => e.stopPropagation() } }, "Swap"),
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

    if (current && current.source === "api" && current.pageCount > 1) {
      const prevBtn = el(
        "button",
        { class: "btn btn-ghost", disabled: page <= 1 ? true : undefined, on: { click: () => void goTo(page - 1) } },
        "Previous",
      );
      const nextBtn = el(
        "button",
        { class: "btn btn-ghost", disabled: page >= current.pageCount ? true : undefined, on: { click: () => void goTo(page + 1) } },
        "Next",
      );
      pagerEl.append(prevBtn, el("span", { class: "ts" }, `Page ${page} of ${current.pageCount} · ${current.totalItems} pools`), nextBtn);
    }
  }

  async function goTo(next: number): Promise<void> {
    page = Math.max(1, next);
    await load();
  }

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    if (!canRead()) {
      current = null;
      statusEl.textContent = "";
      renderTable();
      return;
    }
    statusEl.textContent = "Loading pools...";
    try {
      const result = await getPools(page, sort);
      if (seq !== loadSeq) return;
      current = result;
      const m = marketStore.get();
      statusEl.textContent = result.source === "api" && m.indexedBlock !== null ? `Indexed at block ${m.indexedBlock}` : "";
    } catch (err) {
      if (seq !== loadSeq) return;
      current = null;
      statusEl.textContent = errText(err);
    }
    renderTable();
  }

  async function loadAll(): Promise<void> {
    if (!canRead()) {
      statusEl.textContent = "Connect your wallet first.";
      return;
    }
    loadAllBtn.setAttribute("disabled", "");
    statusEl.textContent = "Loading all pairs (this can take a moment)...";
    tableWrap.replaceChildren(loadingState("Loading pairs..."));
    try {
      await discoverAllFromFactory();
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = errText(err);
    }
    loadAllBtn.removeAttribute("disabled");
    await load();
  }

  const unsubWallet = walletStore.subscribe(() => void load());
  const unsubMarket = marketStore.subscribe((s) => {
    // Re-load when the API becomes available or drops away.
    if (s.status === "ok" || s.status === "unavailable" || s.status === "no-dex") void load();
  });

  // When a transaction confirms (swap, add/remove liquidity, ...), the cached
  // reserves are stale: drop memos and re-read on the next render.
  let txStatuses = new Map(txStore.get().map((r) => [r.hash, r.status]));
  const unsubTx = txStore.subscribe((list) => {
    const settled = list.some((r) => txStatuses.get(r.hash) === "pending" && r.status === "succeeded");
    txStatuses = new Map(list.map((r) => [r.hash, r.status]));
    if (settled) {
      invalidate();
      void load();
    }
  });

  void load();

  return {
    node,
    theme: "cyan",
    title: "Pool Explorer",
    cleanup: () => {
      unsubWallet();
      unsubMarket();
      unsubTx();
    },
  };
}

export type { PoolView };

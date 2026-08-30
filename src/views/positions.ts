/**
 * Liquidity Explorer / My Positions: LP balances with underlying amounts and
 * pool share. Served by the Swap Read API (one request for every position on
 * the active DEX, plus the pools the account created) with the registry
 * balanceOf scan as the RPC fallback, and an optional deep scan.
 */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { card, emptyState, errText, loadingState, pageHeader, statRow } from "./shared";
import { addressPill } from "../ui/components/addressPill";
import type { PairRecord } from "../config/pairs";
import { formatAmount } from "../lib/format";
import { discoverAllFromFactory, getPairsCreated, getPositions, marketStore, type PositionView } from "../lib/marketData";
import { connectWallet, walletStore } from "../wallet/wallet";

interface Position {
  record: PairRecord;
  lpBalance: bigint;
  amount0: bigint;
  amount1: bigint;
  share: number;
}

export function positionsView(): ViewResult {
  const body = el("div", { class: "stack" });
  const createdWrap = el("div", { class: "stack" });
  const statusEl = el("span", { class: "ts" });
  let scanSeq = 0;

  const deepScanBtn = el(
    "button",
    { class: "btn btn-ghost", on: { click: () => void deepScan() } },
    "Deep scan all pairs",
  );

  const node = el(
    "div",
    { class: "page" },
    pageHeader("My Positions", "Your liquidity across QuantumSwap pools."),
    el("div", { class: "toolbar" }, statusEl, deepScanBtn),
    body,
    createdWrap,
  );

  async function scan(): Promise<void> {
    const seq = ++scanSeq;
    const account = walletStore.get().account;
    clear(createdWrap);
    if (!account) {
      clear(body);
      body.appendChild(
        card(
          el("p", {}, "Connect your wallet to see your positions."),
          el("div", { class: "btn-row" }, el("button", { class: "btn btn-primary", on: { click: () => void connectWallet() } }, "Connect wallet")),
        ),
      );
      return;
    }

    clear(body);
    body.appendChild(loadingState("Scanning your positions..."));
    let result: { items: PositionView[]; capped: boolean; source: "api" | "rpc" };
    try {
      result = await getPositions(account);
    } catch (err) {
      if (seq !== scanSeq) return;
      clear(body);
      body.appendChild(emptyState(errText(err), el("button", { class: "btn btn-primary", on: { click: () => void connectWallet() } }, "Connect wallet")));
      return;
    }
    if (seq !== scanSeq) return;

    const positions: Position[] = result.items
      .filter((p) => p.totalSupply > 0n)
      .map((p) => ({
        record: p.record,
        lpBalance: p.lpBalance,
        amount0: (p.lpBalance * p.reserve0) / p.totalSupply,
        amount1: (p.lpBalance * p.reserve1) / p.totalSupply,
        share: Number(p.lpBalance) / Number(p.totalSupply),
      }));

    clear(body);
    const m = marketStore.get();
    statusEl.textContent = result.source === "api" && m.indexedBlock !== null ? `Indexed at block ${m.indexedBlock}` : "";
    if (positions.length === 0) {
      body.appendChild(
        emptyState(
          result.source === "api"
            ? "No liquidity positions found for this account on the active release."
            : "No liquidity positions found in the known registry. If you provided liquidity to a pair not listed here, try a deep scan.",
          el("a", { class: "btn btn-primary", href: "#/pools/add" }, "Add liquidity"),
        ),
      );
    } else {
      for (const pos of positions) body.appendChild(positionCard(pos));
      if (result.capped) body.appendChild(el("p", { class: "ts" }, "Showing the first 1000 positions tracked for this account."));
    }

    // Pools this account created (API only; hidden when unavailable/empty).
    if (result.source === "api") {
      const created = await getPairsCreated(account, 1);
      if (seq !== scanSeq) return;
      if (created.items.length > 0) {
        createdWrap.appendChild(
          card(
            el("h3", {}, `Pools you created (${created.totalItems})`),
            el(
              "div",
              { class: "stack", style: { gap: "8px" } },
              ...created.items.map((v) =>
                el(
                  "div",
                  { class: "result-row" },
                  el(
                    "a",
                    { href: `#/explore/pools/${v.record.pairAddress}` },
                    el("span", { class: "r-sym" }, `${v.record.token0.symbol} / ${v.record.token1.symbol}`),
                  ),
                  addressPill(v.record.pairAddress, { link: false }),
                ),
              ),
            ),
          ),
        );
      }
    }
  }

  function positionCard(pos: Position): HTMLElement {
    const { record } = pos;
    return card(
      el(
        "div",
        { class: "flex-between" },
        el("h3", { style: { margin: "0" } }, `${record.token0.symbol} / ${record.token1.symbol}`),
        addressPill(record.pairAddress, { link: false }),
      ),
      el(
        "div",
        { class: "details", style: { marginTop: "10px" } },
        statRow("LP balance", formatAmount(pos.lpBalance, 18, 6)),
        statRow("Pool share", `${(pos.share * 100).toFixed(4)}%`),
        statRow(`Pooled ${record.token0.symbol}`, formatAmount(pos.amount0, record.token0.decimals, 6)),
        statRow(`Pooled ${record.token1.symbol}`, formatAmount(pos.amount1, record.token1.decimals, 6)),
      ),
      el(
        "div",
        { class: "btn-row", style: { justifyContent: "flex-start" } },
        el("a", { class: "btn btn-primary", style: { flex: "0 0 auto" }, href: `#/pools/add/${record.token0.address}/${record.token1.address}` }, "Add"),
        el("a", { class: "btn btn-ghost", style: { flex: "0 0 auto" }, href: `#/pools/remove/${record.pairAddress}` }, "Remove"),
        el("a", { class: "btn btn-ghost", style: { flex: "0 0 auto" }, href: `#/explore/pools/${record.pairAddress}` }, "Details"),
      ),
    );
  }

  async function deepScan(): Promise<void> {
    if (walletStore.get().status !== "connected") {
      statusEl.textContent = "Connect your wallet first.";
      return;
    }
    deepScanBtn.setAttribute("disabled", "");
    statusEl.textContent = "Loading all pairs...";
    try {
      await discoverAllFromFactory();
      await scan();
    } catch (err) {
      statusEl.textContent = errText(err);
    }
    deepScanBtn.removeAttribute("disabled");
  }

  const unsub = walletStore.subscribe(() => void scan());
  const unsubMarket = marketStore.subscribe((s) => {
    if (s.status === "ok" || s.status === "unavailable") void scan();
  });
  void scan();

  return {
    node,
    theme: "nebula",
    title: "My Positions",
    cleanup: () => {
      unsub();
      unsubMarket();
    },
  };
}

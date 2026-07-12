/**
 * Liquidity Explorer / My Positions: LP balances across the registry with
 * underlying amounts and pool share, plus an optional deep scan.
 */

import { clear, el } from "../ui/dom";
import type { ViewResult } from "../ui/router";
import { card, emptyState, errText, loadingState, pageHeader, statRow } from "./shared";
import { addressPill } from "../ui/components/addressPill";
import { pair as pairContract } from "../lib/contracts";
import { discoverAllFromFactory, discoverKnownPairs, registryStore } from "../lib/pairRegistry";
import type { PairRecord } from "../config/pairs";
import { sanitizeReserves } from "../lib/sanitizeResponse";
import { formatAmount } from "../lib/format";
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
  const statusEl = el("span", { class: "ts" });

  const deepScanBtn = el(
    "button",
    { class: "btn btn-ghost", on: { click: () => void deepScan() } },
    "Deep scan all pairs",
  );

  const node = el(
    "div",
    { class: "page" },
    pageHeader("My Positions", "Your liquidity across known QuantumSwap pairs."),
    el("div", { class: "toolbar" }, statusEl, deepScanBtn),
    body,
  );

  async function scan(): Promise<void> {
    const account = walletStore.get().account;
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
    try {
      await discoverKnownPairs();
    } catch {
      /* continue with whatever is in the registry */
    }

    const positions: Position[] = [];
    for (const record of registryStore.get()) {
      try {
        const p = pairContract(record.pairAddress);
        const balRaw = await p.balanceOf(account);
        const lpBalance = typeof balRaw === "bigint" ? balRaw : BigInt(balRaw ?? 0);
        if (lpBalance <= 0n) continue;
        const [reservesRaw, totalSupplyRaw] = await Promise.all([p.getReserves(), p.totalSupply()]);
        const reserves = sanitizeReserves(reservesRaw);
        const totalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
        if (!reserves || totalSupply <= 0n) continue;
        positions.push({
          record,
          lpBalance,
          amount0: (lpBalance * reserves.reserve0) / totalSupply,
          amount1: (lpBalance * reserves.reserve1) / totalSupply,
          share: Number(lpBalance) / Number(totalSupply),
        });
      } catch {
        /* skip unreadable pair */
      }
    }

    clear(body);
    if (positions.length === 0) {
      body.appendChild(
        emptyState(
          "No liquidity positions found in the known registry. If you provided liquidity to a pair not listed here, try a deep scan.",
          el("a", { class: "btn btn-primary", href: "#/pools/add" }, "Add liquidity"),
        ),
      );
      return;
    }

    for (const pos of positions) body.appendChild(positionCard(pos));
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
    statusEl.textContent = "Walking the factory for all pairs...";
    try {
      await discoverAllFromFactory();
      await scan();
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = errText(err);
    }
    deepScanBtn.removeAttribute("disabled");
  }

  const unsub = walletStore.subscribe(() => void scan());
  void scan();

  return { node, theme: "nebula", title: "My Positions", cleanup: () => unsub() };
}

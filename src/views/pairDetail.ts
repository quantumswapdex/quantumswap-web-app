/** Pair detail: addresses, reserves, both-direction prices, LP supply + share. */

import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { card, errText, errorState, loadingState, pageHeader, statRow } from "./shared";
import { addressPill } from "../ui/components/addressPill";
import { type TokenInfo } from "../config/chain";
import { wqAddress } from "../config/releases";
import { pair as pairContract } from "../lib/contracts";
import { findToken } from "../tokens/tokenList";
import { sanitizeAddress } from "../lib/sanitize";
import { formatAmount, formatCompact, formatPrice } from "../lib/format";
import { canRead, getPool, marketStore, type PoolView } from "../lib/marketData";
import { connectWallet, walletStore } from "../wallet/wallet";

export function pairDetailView(ctx: RouteContext): ViewResult {
  const pairAddress = sanitizeAddress(ctx.params.pairAddress);
  const container = el("div", { class: "page narrow" });
  container.appendChild(pageHeader("Pair detail"));

  if (!pairAddress) {
    container.appendChild(errorState("Invalid pair address."));
    return { node: container, theme: "cyan", title: "Pair detail" };
  }

  const body = el("div", {});
  container.appendChild(body);
  body.appendChild(loadingState("Loading pair..."));
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    if (!canRead()) {
      clear(body);
      body.appendChild(
        card(
          el("p", {}, "Connect your wallet to load this pair from the chain."),
          el("div", { class: "btn-row" }, el("button", { class: "btn btn-primary", on: { click: () => void connectWallet() } }, "Connect wallet")),
        ),
      );
      return;
    }
    try {
      const view = await getPool(pairAddress!);
      if (seq !== loadSeq) return;
      if (!view) throw new Error("No pool exists at this address on the active release.");
      const account = walletStore.get().account;
      const token0 = tokenInfoFor(view, 0);
      const token1 = tokenInfoFor(view, 1);
      const lpBalance = account ? await readLpBalance(pairAddress!, account) : 0n;
      if (seq !== loadSeq) return;
      render(view, token0, token1, account, lpBalance);
    } catch (err) {
      if (seq !== loadSeq) return;
      clear(body);
      body.appendChild(errorState(errText(err)));
    }
  }

  function render(view: PoolView, token0: TokenInfo, token1: TokenInfo, account: string | null, lpBalance: bigint): void {
    const reserves = { reserve0: view.reserve0, reserve1: view.reserve1 };
    const totalSupply = view.lpTotalSupply;
    clear(body);
    const price01 = Number(formatAmount(reserves.reserve1, token1.decimals, 18)) / Number(formatAmount(reserves.reserve0, token0.decimals, 18) || "1");
    const price10 = price01 > 0 ? 1 / price01 : 0;
    const share = totalSupply > 0n ? Number(lpBalance) / Number(totalSupply) : 0;
    const underlying0 = totalSupply > 0n ? (lpBalance * reserves.reserve0) / totalSupply : 0n;
    const underlying1 = totalSupply > 0n ? (lpBalance * reserves.reserve1) / totalSupply : 0n;
    const m = marketStore.get();
    const indexedNote = m.status === "ok" && m.indexedBlock !== null ? statRow("Indexed at block", String(m.indexedBlock)) : null;

    body.appendChild(
      el(
        "div",
        { class: "stack" },
        card(
          el("h3", { style: { fontSize: "18px" } }, `${token0.symbol} / ${token1.symbol}`),
          addressPill(pairAddress!),
          el("div", { class: "grid2", style: { marginTop: "12px" } }, tokenLine(token0), tokenLine(token1)),
        ),
        card(
          el("h3", {}, "Reserves & price"),
          el(
            "div",
            { class: "details" },
            statRow(`Reserve ${token0.symbol}`, `${formatCompact(reserves.reserve0, token0.decimals)}`),
            statRow(`Reserve ${token1.symbol}`, `${formatCompact(reserves.reserve1, token1.decimals)}`),
            statRow("Price", `1 ${token0.symbol} = ${formatPrice(price01)} ${token1.symbol}`),
            statRow("Price (inverse)", `1 ${token1.symbol} = ${formatPrice(price10)} ${token0.symbol}`),
            statRow("LP total supply", formatAmount(totalSupply, 18, 6)),
            statRow("LP fee", "0.30%"),
            view.swapCount !== undefined ? statRow("Swaps", String(view.swapCount)) : null,
            indexedNote,
          ),
        ),
        account
          ? card(
              el("h3", {}, "Your position"),
              el(
                "div",
                { class: "details" },
                statRow("LP balance", formatAmount(lpBalance, 18, 6)),
                statRow("Pool share", `${(share * 100).toFixed(4)}%`),
                statRow(`Pooled ${token0.symbol}`, formatAmount(underlying0, token0.decimals, 6)),
                statRow(`Pooled ${token1.symbol}`, formatAmount(underlying1, token1.decimals, 6)),
              ),
            )
          : null,
        el(
          "div",
          { class: "btn-row" },
          el("a", { class: "btn btn-primary", href: `#/pools/add/${token0.address}/${token1.address}` }, "Add liquidity"),
          el("a", { class: "btn btn-ghost", href: `#/pools/remove/${pairAddress}` }, "Remove"),
          el("a", { class: "btn btn-ghost", href: `#/swap/${token0.address}/${token1.address}` }, "Swap"),
        ),
      ),
    );
  }

  const unsub = walletStore.subscribe(() => void load());
  const unsubMarket = marketStore.subscribe((s) => {
    if (s.status === "ok" || s.status === "unavailable") void load();
  });
  void load();

  return {
    node: container,
    theme: "cyan",
    title: "Pair detail",
    cleanup: () => {
      unsub();
      unsubMarket();
    },
  };
}

/**
 * LP balance of the connected account: an RPC read (wallet state), best effort.
 */
async function readLpBalance(pairAddress: string, account: string): Promise<bigint> {
  if (walletStore.get().status !== "connected") return 0n;
  try {
    const balRaw = await pairContract(pairAddress).balanceOf(account);
    return typeof balRaw === "bigint" ? balRaw : BigInt(balRaw ?? 0);
  } catch {
    return 0n;
  }
}

function tokenLine(token: TokenInfo): HTMLElement {
  return el(
    "div",
    { class: "result-row" },
    el(
      "span",
      {},
      el("span", { class: "r-sym" }, token.symbol),
      el("span", { class: "r-name" }, token.name),
      el("div", { class: "mt6" }, addressPill(token.address)),
    ),
  );
}

/** UI token for one side of a pool: the token list first, then API facts, then the registry ref. */
function tokenInfoFor(view: PoolView, side: 0 | 1): TokenInfo {
  const ref = side === 0 ? view.record.token0 : view.record.token1;
  const facts = side === 0 ? view.facts?.token0 : view.facts?.token1;
  if (ref.address.toLowerCase() === wqAddress().toLowerCase()) {
    return findToken(wqAddress()) ?? { address: wqAddress(), symbol: "WQ", name: "Wrapped QuantumCoin", decimals: 18 };
  }
  const known = findToken(ref.address);
  if (known) return known;
  const name = facts?.identityKnown && facts.name ? facts.name : ref.symbol === "TKN" ? "Unknown Token" : ref.symbol;
  return { address: ref.address, symbol: ref.symbol, name, decimals: ref.decimals };
}

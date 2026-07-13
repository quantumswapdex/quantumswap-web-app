/** Pair detail: addresses, reserves, both-direction prices, LP supply + share. */

import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { card, errText, errorState, loadingState, pageHeader, statRow } from "./shared";
import { addressPill } from "../ui/components/addressPill";
import { type TokenInfo } from "../config/chain";
import { wqAddress } from "../config/releases";
import { pair as pairContract } from "../lib/contracts";
import { findToken, readTokenMetadata } from "../tokens/tokenList";
import { sanitizeAddress } from "../lib/sanitize";
import { sanitizeAddressResponse, sanitizeReserves } from "../lib/sanitizeResponse";
import { formatAmount, formatCompact, formatPrice } from "../lib/format";
import { walletStore } from "../wallet/wallet";

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

  async function load(): Promise<void> {
    try {
      const p = pairContract(pairAddress!);
      const account = walletStore.get().account;
      const [t0Raw, t1Raw, reservesRaw, totalSupplyRaw] = await Promise.all([
        p.token0(),
        p.token1(),
        p.getReserves(),
        p.totalSupply(),
      ]);
      const t0 = sanitizeAddressResponse(t0Raw);
      const t1 = sanitizeAddressResponse(t1Raw);
      const reserves = sanitizeReserves(reservesRaw);
      if (!t0 || !t1 || !reserves) throw new Error("Could not read pair state");
      const totalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
      const [token0, token1] = await Promise.all([resolveToken(t0), resolveToken(t1)]);
      let lpBalance = 0n;
      if (account) {
        const balRaw = await p.balanceOf(account).catch(() => 0n);
        lpBalance = typeof balRaw === "bigint" ? balRaw : BigInt(balRaw ?? 0);
      }

      clear(body);
      const price01 = Number(formatAmount(reserves.reserve1, token1.decimals, 18)) / Number(formatAmount(reserves.reserve0, token0.decimals, 18) || "1");
      const price10 = price01 > 0 ? 1 / price01 : 0;
      const share = totalSupply > 0n ? Number(lpBalance) / Number(totalSupply) : 0;
      const underlying0 = totalSupply > 0n ? (lpBalance * reserves.reserve0) / totalSupply : 0n;
      const underlying1 = totalSupply > 0n ? (lpBalance * reserves.reserve1) / totalSupply : 0n;

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
            el("a", { class: "btn btn-ghost", href: "#/swap" }, "Swap"),
          ),
        ),
      );
    } catch (err) {
      clear(body);
      body.appendChild(errorState(errText(err)));
    }
  }

  const unsub = walletStore.subscribe(() => void load());
  void load();

  return { node: container, theme: "cyan", title: "Pair detail", cleanup: () => unsub() };
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

async function resolveToken(address: string): Promise<TokenInfo> {
  if (address.toLowerCase() === wqAddress().toLowerCase()) {
    return findToken(wqAddress()) ?? { address: wqAddress(), symbol: "WQ", name: "Wrapped QuantumCoin", decimals: 18 };
  }
  const known = findToken(address);
  if (known) return known;
  try {
    return await readTokenMetadata(address).then((m) => ({ address: m.address, symbol: m.symbol, name: m.name, decimals: m.decimals }));
  } catch {
    return { address, symbol: "TKN", name: "Unknown Token", decimals: 18 };
  }
}

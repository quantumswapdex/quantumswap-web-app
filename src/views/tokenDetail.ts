/** Token detail: metadata, balance, pools containing it, default/unrecognized badge. */

import { clear, el } from "../ui/dom";
import type { RouteContext, ViewResult } from "../ui/router";
import { card, errText, errorState, loadingState, pageHeader, statRow } from "./shared";
import { addressPill } from "../ui/components/addressPill";
import { showToast } from "../ui/components/toast";
import type { TokenInfo } from "../config/chain";
import { isRecognizedAddress } from "../config/chain";
import { sanitizeAddress } from "../lib/sanitize";
import { formatAmount } from "../lib/format";
import {
  checkImport,
  findToken,
  importToken,
  readTokenBalance,
  readTokenMetadata,
} from "../tokens/tokenList";
import { confirmImportToken } from "../tokens/addWarning";
import { getRegistry } from "../lib/pairRegistry";
import { canRead, getPools, getTokenFacts, marketStore, tokenMetadataForImport, type TokenFactsView } from "../lib/marketData";
import { walletStore } from "../wallet/wallet";
import type { PairRecord } from "../config/pairs";

export function tokenDetailView(ctx: RouteContext): ViewResult {
  const address = sanitizeAddress(ctx.params.address);
  const container = el("div", { class: "page narrow" });
  container.appendChild(pageHeader("Token detail"));

  if (!address) {
    container.appendChild(errorState("Invalid token address."));
    return { node: container, theme: "emerald", title: "Token detail" };
  }

  const body = el("div", {});
  container.appendChild(body);
  body.appendChild(loadingState("Loading token..."));

  async function load(): Promise<void> {
    try {
      const known = findToken(address!);
      // Token facts (identity, pair count, fee-on-transfer evidence) come from
      // the Swap Read API when available; unknown tokens fall back to RPC metadata.
      const facts: TokenFactsView | null = canRead() ? await getTokenFacts(address!).catch(() => null) : null;
      const token: TokenInfo = known ?? factsToInfo(address!, facts) ?? (await toInfo(address!));
      const decimalsAssumed = !known && facts !== null && facts.decimals === null;
      const account = walletStore.get().account;
      let balance = 0n;
      if (account) balance = await readTokenBalance(token, account);

      let pools: PairRecord[] = getRegistry().filter(
        (p) => p.token0.address.toLowerCase() === address!.toLowerCase() || p.token1.address.toLowerCase() === address!.toLowerCase(),
      );
      if (canRead()) {
        try {
          const page = await getPools(1, "liquidity", address!);
          if (page.source === "api") pools = page.items.map((v) => v.record);
        } catch {
          /* keep the registry view */
        }
      }

      clear(body);
      const recognized = isRecognizedAddress(address!);
      body.appendChild(
        el(
          "div",
          { class: "stack" },
          card(
            el(
              "h3",
              { style: { fontSize: "18px" } },
              token.symbol,
              " ",
              recognized ? el("span", { class: "badge approved" }, "default") : el("span", { class: "badge imported" }, "unrecognized"),
            ),
            el(
              "div",
              { class: "details" },
              statRow("Name", token.name),
              statRow("Decimals", decimalsAssumed ? `${token.decimals} (assumed; not decoded yet)` : String(token.decimals)),
              facts?.feeOnTransfer ? statRow("Fee on transfer", "Observed on swaps into this DEX") : null,
              account ? statRow("Your balance", `${formatAmount(balance, token.decimals, 6)} ${token.symbol}`) : null,
              pools.length ? statRow("Pools", pools.map((p) => `${p.token0.symbol} / ${p.token1.symbol}`).join(", ")) : null,
            ),
            el("div", { class: "full-addr", style: { marginTop: "10px" } }, address!),
            !known ? el("button", { class: "dlg-cta", on: { click: () => void doImport(address!) } }, "Import this token") : null,
          ),
          card(
            el("h3", {}, "Pools"),
            pools.length
              ? el(
                  "div",
                  { class: "stack", style: { gap: "8px" } },
                  ...pools.map((p) =>
                    el(
                      "div",
                      { class: "result-row" },
                      el(
                        "a",
                        { href: `#/explore/pools/${p.pairAddress}` },
                        el("span", { class: "r-sym" }, `${p.token0.symbol} / ${p.token1.symbol}`),
                      ),
                      addressPill(p.pairAddress, { link: false }),
                    ),
                  ),
                )
              : el("p", {}, "No known pools contain this token yet."),
          ),
          el(
            "div",
            { class: "btn-row" },
            el("a", { class: "btn btn-primary", href: `#/swap/${address}` }, "Swap"),
            el("a", { class: "btn", href: `#/pools/add/${address}` }, "Add liquidity"),
            el("a", { class: "btn", href: `#/pools/create/${address}` }, "Create pair"),
          ),
        ),
      );
    } catch (err) {
      clear(body);
      body.appendChild(errorState(errText(err)));
    }
  }

  async function doImport(addr: string): Promise<void> {
    let meta = null;
    if (walletStore.get().status === "connected") {
      const result = await checkImport(addr);
      if (!result.ok || !result.token) {
        showToast({ kind: "error", title: "Cannot import", message: result.reason, autoDismissMs: 6000 });
        return;
      }
      meta = result.token;
    } else {
      meta = await tokenMetadataForImport(addr);
      if (!meta) {
        showToast({ kind: "error", title: "Cannot import", message: "Connect your wallet to read this token's details on-chain.", autoDismissMs: 6000 });
        return;
      }
    }
    const ok = await confirmImportToken(meta);
    if (ok) {
      importToken(meta);
      void load();
    }
  }

  const unsub = walletStore.subscribe(() => void load());
  const unsubMarket = marketStore.subscribe((s) => {
    if (s.status === "ok" || s.status === "unavailable") void load();
  });
  void load();

  return {
    node: container,
    theme: "emerald",
    title: "Token detail",
    cleanup: () => {
      unsub();
      unsubMarket();
    },
  };
}

async function toInfo(address: string): Promise<TokenInfo> {
  const meta = await readTokenMetadata(address);
  return { address: meta.address, symbol: meta.symbol, name: meta.name, decimals: meta.decimals };
}

/** UI token from API facts; null when the explorer cannot name the token. */
function factsToInfo(address: string, facts: TokenFactsView | null): TokenInfo | null {
  if (!facts || !facts.identityKnown) return null;
  return { address, symbol: facts.symbol || "TKN", name: facts.name || "Unknown Token", decimals: facts.decimals ?? 18 };
}

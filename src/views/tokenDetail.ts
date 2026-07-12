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
import { walletStore } from "../wallet/wallet";

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
      const token: TokenInfo = known ?? (await toInfo(address!));
      const account = walletStore.get().account;
      let balance = 0n;
      if (account) balance = await readTokenBalance(token, account);

      const pools = getRegistry().filter(
        (p) => p.token0.address.toLowerCase() === address!.toLowerCase() || p.token1.address.toLowerCase() === address!.toLowerCase(),
      );

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
              statRow("Decimals", String(token.decimals)),
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
          el("div", { class: "btn-row" }, el("a", { class: "btn btn-primary", href: "#/swap" }, "Swap")),
        ),
      );
    } catch (err) {
      clear(body);
      body.appendChild(errorState(errText(err)));
    }
  }

  async function doImport(addr: string): Promise<void> {
    const result = await checkImport(addr);
    if (!result.ok || !result.token) {
      showToast({ kind: "error", title: "Cannot import", message: result.reason, autoDismissMs: 6000 });
      return;
    }
    const ok = await confirmImportToken(result.token);
    if (ok) {
      importToken(result.token);
      void load();
    }
  }

  const unsub = walletStore.subscribe(() => void load());
  void load();

  return { node: container, theme: "emerald", title: "Token detail", cleanup: () => unsub() };
}

async function toInfo(address: string): Promise<TokenInfo> {
  const meta = await readTokenMetadata(address);
  return { address: meta.address, symbol: meta.symbol, name: meta.name, decimals: meta.decimals };
}

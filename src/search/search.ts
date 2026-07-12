/**
 * Global search. Address input checks the known registry/token list first, then
 * probes on-chain (pair token0/token1/getReserves, then IERC20 metadata).
 * Name/symbol input searches the known set only (no chain-by-name RPC). Any
 * import/add is gated behind the acknowledge-before-add warning.
 */

import { clear, el } from "../ui/dom";
import { openModal, type ModalHandle } from "../ui/components/modal";
import { addressPill } from "../ui/components/addressPill";
import { looksLikeAddress, sanitizeAddress, sanitizeQuery } from "../lib/sanitize";
import { sanitizeAddressResponse, sanitizeReserves } from "../lib/sanitizeResponse";
import { pair as pairContract } from "../lib/contracts";
import { getAllTokens, checkImport, importToken, readTokenMetadata, toPathAddress } from "../tokens/tokenList";
import { confirmImportToken } from "../tokens/addWarning";
import { absorbDiscoveredPair, getRegistry } from "../lib/pairRegistry";
import { router } from "../app/router";

export function openGlobalSearch(rawQuery: string): void {
  const query = sanitizeQuery(rawQuery);
  const results = el("div", { class: "stack", style: { gap: "8px" } });
  const status = el("div", { class: "dd-status" }, "Searching...");
  const handle = openModal({ title: `Search: ${query}`, body: el("div", {}, status, results), wide: true });

  if (looksLikeAddress(query)) {
    void probeAddress(query, results, status, handle);
  } else {
    searchKnown(query, results, status);
  }
}

function searchKnown(query: string, results: HTMLElement, status: HTMLElement): void {
  const q = query.toLowerCase();
  clear(results);
  let count = 0;

  for (const token of getAllTokens()) {
    if (token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q)) {
      results.appendChild(tokenResult(token.symbol, token.name, token.address));
      count++;
    }
  }

  for (const rec of getRegistry()) {
    const label = `${rec.token0.symbol} / ${rec.token1.symbol}`;
    if (label.toLowerCase().includes(q)) {
      results.appendChild(pairResult(label, rec.pairAddress));
      count++;
    }
  }

  status.textContent = count === 0 ? "No known tokens or pairs match. Paste a contract address to search on-chain." : "";
}

async function probeAddress(query: string, results: HTMLElement, status: HTMLElement, handle: ModalHandle): Promise<void> {
  const address = sanitizeAddress(query);
  if (!address) {
    status.textContent = "That is not a valid 32-byte QuantumCoin address.";
    return;
  }
  clear(results);

  // 1) Known token?
  const knownToken = getAllTokens().find((t) => t.address.toLowerCase() === address.toLowerCase());
  if (knownToken) {
    results.appendChild(tokenResult(knownToken.symbol, knownToken.name, knownToken.address));
    status.textContent = "";
    return;
  }

  // 2) Known pair?
  const knownPair = getRegistry().find((p) => p.pairAddress.toLowerCase() === address.toLowerCase());
  if (knownPair) {
    results.appendChild(pairResult(`${knownPair.token0.symbol} / ${knownPair.token1.symbol}`, knownPair.pairAddress));
    status.textContent = "";
    return;
  }

  status.textContent = "Looking up address on-chain...";

  // 3) Pair probe: token0 + token1 + reserves.
  try {
    const p = pairContract(address);
    const [t0Raw, t1Raw, reservesRaw] = await Promise.all([
      p.token0().catch(() => null),
      p.token1().catch(() => null),
      p.getReserves().catch(() => null),
    ]);
    const t0 = sanitizeAddressResponse(t0Raw);
    const t1 = sanitizeAddressResponse(t1Raw);
    const reserves = sanitizeReserves(reservesRaw);
    if (t0 && t1 && reserves) {
      const [meta0, meta1] = await Promise.all([safeMeta(t0), safeMeta(t1)]);
      absorbDiscoveredPair(
        address,
        { address: t0, symbol: meta0.symbol, decimals: meta0.decimals },
        { address: t1, symbol: meta1.symbol, decimals: meta1.decimals },
      );
      status.textContent = "Found a liquidity pair.";
      results.appendChild(pairResult(`${meta0.symbol} / ${meta1.symbol}`, address));
      return;
    }
  } catch {
    /* not a pair */
  }

  // 4) Token probe + import.
  const check = await checkImport(address);
  if (check.ok && check.token) {
    status.textContent = "Found a token.";
    const importBtn = el(
      "button",
      {
        class: "import-btn",
        on: {
          click: async () => {
            const ok = await confirmImportToken(check.token!);
            if (ok) {
              importToken(check.token!);
              handle.close();
              router().navigate(`#/explore/tokens/${check.token!.address}`);
            }
          },
        },
      },
      "Import",
    );
    const row = tokenResult(check.token.symbol, check.token.name, check.token.address);
    row.appendChild(importBtn);
    results.appendChild(row);
    return;
  }

  status.textContent = check.reason ?? "No token or pair found at that address.";
}

async function safeMeta(address: string): Promise<{ symbol: string; decimals: number }> {
  const known = getAllTokens().find((t) => toPathAddress(t).toLowerCase() === address.toLowerCase());
  if (known) return { symbol: known.symbol, decimals: known.decimals };
  try {
    const meta = await readTokenMetadata(address);
    return { symbol: meta.symbol, decimals: meta.decimals };
  } catch {
    return { symbol: "TKN", decimals: 18 };
  }
}

function tokenResult(symbol: string, name: string, address: string): HTMLElement {
  return el(
    "div",
    { class: "result-row" },
    el(
      "a",
      { href: `#/explore/tokens/${address}` },
      el("span", { class: "r-sym" }, symbol),
      el("span", { class: "r-name" }, name),
      el("div", { class: "mt6" }, addressPill(address)),
    ),
  );
}

function pairResult(label: string, pairAddress: string): HTMLElement {
  return el(
    "div",
    { class: "result-row" },
    el(
      "a",
      { href: `#/explore/pools/${pairAddress}` },
      el("span", { class: "r-sym" }, label),
      el("div", { class: "mt6" }, addressPill(pairAddress)),
    ),
  );
}

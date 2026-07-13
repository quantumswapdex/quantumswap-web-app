/**
 * Global search. Address input checks the known registry/token list first, then
 * probes on-chain (pair token0/token1/getReserves, then IERC20 metadata).
 * Name/symbol input searches the known set only (no chain-by-name RPC). Any
 * import/add is gated behind the acknowledge-before-add warning.
 */

import { clear, el } from "../ui/dom";
import { openModal, type ModalHandle } from "../ui/components/modal";
import { addressPill } from "../ui/components/addressPill";
import { shortAddress } from "../lib/format";
import { looksLikeAddress, sanitizeAddress, sanitizeQuery } from "../lib/sanitize";
import { sanitizeAddressResponse, sanitizeReserves } from "../lib/sanitizeResponse";
import { pair as pairContract } from "../lib/contracts";
import { getAllTokens, checkImport, importToken, readTokenMetadata, toPathAddress } from "../tokens/tokenList";
import { confirmImportToken } from "../tokens/addWarning";
import { absorbDiscoveredPair, getRegistry } from "../lib/pairRegistry";
import { router } from "../app/router";

export function openGlobalSearch(rawQuery: string): void {
  const query = sanitizeQuery(rawQuery);
  // Addresses are 66 chars; truncate them in the title so it fits the dialog.
  const title = looksLikeAddress(query) ? `Search: ${shortAddress(query)}` : `Search: ${query}`;
  const results = el("div", { class: "stack", style: { gap: "8px" } });
  const status = el("div", { class: "dd-status" }, "Searching...");
  const handle = openModal({ title, body: el("div", {}, status, results), wide: true });

  // Close the dialog when a result link is clicked (token or pair) so the
  // destination view is revealed behind it instead of staying covered.
  results.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) handle.close();
  });

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
  const shownTokenAddr = new Set<string>();

  for (const token of getAllTokens()) {
    if (token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q)) {
      results.appendChild(tokenResult(token.symbol, token.name, token.address));
      shownTokenAddr.add(token.address.toLowerCase());
      count++;
    }
  }

  // Also surface tokens that are only known as constituents of a registered
  // pair, so a name/symbol search shows the token alongside its pair.
  for (const rec of getRegistry()) {
    for (const ref of [rec.token0, rec.token1]) {
      const addr = ref.address.toLowerCase();
      if (shownTokenAddr.has(addr)) continue;
      if (ref.symbol.toLowerCase().includes(q)) {
        results.appendChild(tokenResult(ref.symbol, ref.symbol, ref.address));
        shownTokenAddr.add(addr);
        count++;
      }
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
      status.textContent = "Found a pair.";
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

export interface SearchPreviewItem {
  /** Primary line, e.g. a token symbol or "SYM / SYM" pair label. */
  label: string;
  /** Secondary line, e.g. the token name or "Liquidity pair". */
  detail: string;
}

/**
 * Lightweight search used by the header's live dropdown. Name/symbol queries
 * scan the known token list and pair registry; address queries also probe
 * on-chain (pair first, then token). Returns compact preview items only -
 * clicking one opens the full results modal via `openGlobalSearch`.
 */
export async function searchPreview(rawQuery: string): Promise<SearchPreviewItem[]> {
  const query = sanitizeQuery(rawQuery);
  if (!query) return [];

  if (!looksLikeAddress(query)) {
    const q = query.toLowerCase();
    const items: SearchPreviewItem[] = [];
    const shownTokenAddr = new Set<string>();
    for (const token of getAllTokens()) {
      if (token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q)) {
        items.push({ label: token.symbol, detail: token.name });
        shownTokenAddr.add(token.address.toLowerCase());
      }
    }
    // Surface tokens that are only known as constituents of a registered pair.
    for (const rec of getRegistry()) {
      for (const ref of [rec.token0, rec.token1]) {
        const addr = ref.address.toLowerCase();
        if (shownTokenAddr.has(addr)) continue;
        if (ref.symbol.toLowerCase().includes(q)) {
          items.push({ label: ref.symbol, detail: "Token" });
          shownTokenAddr.add(addr);
        }
      }
    }
    for (const rec of getRegistry()) {
      const label = `${rec.token0.symbol} / ${rec.token1.symbol}`;
      if (label.toLowerCase().includes(q)) items.push({ label, detail: "Liquidity pair" });
    }
    return items;
  }

  const address = sanitizeAddress(query);
  if (!address) return [];

  const knownToken = getAllTokens().find((t) => t.address.toLowerCase() === address.toLowerCase());
  if (knownToken) return [{ label: knownToken.symbol, detail: knownToken.name }];

  const knownPair = getRegistry().find((p) => p.pairAddress.toLowerCase() === address.toLowerCase());
  if (knownPair) {
    return [{ label: `${knownPair.token0.symbol} / ${knownPair.token1.symbol}`, detail: "Liquidity pair" }];
  }

  // On-chain: pair probe first, then token probe.
  try {
    const p = pairContract(address);
    const [t0Raw, t1Raw, reservesRaw] = await Promise.all([
      p.token0().catch(() => null),
      p.token1().catch(() => null),
      p.getReserves().catch(() => null),
    ]);
    const t0 = sanitizeAddressResponse(t0Raw);
    const t1 = sanitizeAddressResponse(t1Raw);
    if (t0 && t1 && sanitizeReserves(reservesRaw)) {
      const [meta0, meta1] = await Promise.all([safeMeta(t0), safeMeta(t1)]);
      return [{ label: `${meta0.symbol} / ${meta1.symbol}`, detail: "Liquidity pair" }];
    }
  } catch {
    /* not a pair */
  }
  try {
    const check = await checkImport(address);
    if (check.ok && check.token) return [{ label: check.token.symbol, detail: check.token.name }];
  } catch {
    /* not a token */
  }
  return [];
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

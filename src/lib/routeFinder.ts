/**
 * Client-side multi-hop path finder for swaps. The on-chain
 * QuantumSwapV2Router02 already accepts multi-token `path` arrays, so routing
 * is purely a matter of choosing a good path client-side. This module
 * enumerates simple paths over the known-pair graph (plus two baseline paths
 * for cold start), probes each with `getAmountsOut`, and returns the path that
 * yields the most output.
 */

import { WQ_ADDRESS, type TokenInfo } from "../config/chain";
import { getAllTokens, toPathAddress } from "../tokens/tokenList";
import { getRegistry } from "./pairRegistry";
import { router as routerContract } from "./contracts";

/** Hard cap on candidate paths probed per quote to bound RPC load. */
const MAX_ROUTE_PROBES = 32;

export interface RouteResult {
  /** WQ-substituted addresses; length 2..maxTokens. */
  path: string[];
  /** Final output amount from getAmountsOut. */
  out: bigint;
}

/**
 * Find the best swap route (max output) from `fromToken` to `toToken` for the
 * given input amount. Returns null if no viable path is found.
 */
export async function findBestRoute(
  amountIn: bigint,
  fromToken: TokenInfo,
  toToken: TokenInfo,
  maxTokens = 5,
): Promise<RouteResult | null> {
  const A = toPathAddress(fromToken).toLowerCase();
  const B = toPathAddress(toToken).toLowerCase();
  if (A === B) return null;
  if (maxTokens < 2) maxTokens = 2;

  const paths = candidatePaths(A, B, maxTokens);
  if (paths.length === 0) return null;

  const results = await Promise.allSettled(
    paths.map((p) => routerContract().getAmountsOut(amountIn, p) as unknown as bigint[]),
  );

  let best: RouteResult | null = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") continue;
    const amounts = r.value;
    if (!amounts || amounts.length === 0) continue;
    const out = BigInt(amounts[amounts.length - 1]);
    if (out <= 0n) continue;
    if (!best || out > best.out) best = { path: paths[i], out };
  }
  return best;
}

/**
 * Build a deduped, ordered list of candidate paths to probe: the direct pair
 * first, then a brute-force 2-hop over every known intermediate (so routes via
 * any known token are tried even when the pair registry is cold), then longer
 * simple paths from the known-pair graph (3..maxTokens hops). Capped at
 * MAX_ROUTE_PROBES, with WQ and built-in tokens ordered first so the most
 * likely routes are always probed.
 */
function candidatePaths(A: string, B: string, maxTokens: number): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  const push = (p: string[]): void => {
    const key = p.join(">");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  const intermediates = orderedIntermediates(A, B);
  const interSet = new Set(intermediates);

  // 1-hop direct.
  push([A, B]);

  // 2-hop brute force over all known intermediates (no registry edge required).
  for (const X of intermediates) {
    if (out.length >= MAX_ROUTE_PROBES) break;
    push([A, X, B]);
  }

  // 3..maxTokens-hop simple paths over the known-pair graph. 2-hop overlaps are
  // deduped away; the graph keeps longer routes bounded by known edges.
  const adj = buildAdjacency();
  const path: string[] = [A];
  const visited = new Set<string>([A]);

  const dfs = (current: string): void => {
    if (out.length >= MAX_ROUTE_PROBES) return;
    if (current === B) {
      if (path.length >= 2) push([...path]);
      return;
    }
    if (path.length >= maxTokens) return;
    const neighbors = adj.get(current);
    if (!neighbors) return;
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      // Only traverse through known intermediate tokens (or the destination).
      if (next !== B && !interSet.has(next)) continue;
      visited.add(next);
      path.push(next);
      dfs(next);
      path.pop();
      visited.delete(next);
      if (out.length >= MAX_ROUTE_PROBES) return;
    }
  };
  dfs(A);

  return out.slice(0, MAX_ROUTE_PROBES);
}

/**
 * Ordered, deduped list of candidate intermediate addresses (lowercased),
 * excluding the endpoints A and B. WQ first, then built-ins, then user imports,
 * then any extra token addresses referenced by the pair registry. Including
 * registry constituents lets routes pass through tokens the user hasn't
 * imported but that appear in discovered/seed pairs.
 */
function orderedIntermediates(A: string, B: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (addr: string): void => {
    const a = addr.toLowerCase();
    if (a === A || a === B) return;
    if (seen.has(a)) return;
    seen.add(a);
    out.push(a);
  };
  add(WQ_ADDRESS);
  for (const t of getAllTokens()) add(toPathAddress(t));
  for (const rec of getRegistry()) {
    add(rec.token0.address);
    add(rec.token1.address);
  }
  return out;
}

/** Undirected adjacency map (lowercased addresses) from the pair registry. */
function buildAdjacency(): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (x: string, y: string): void => {
    if (x === y) return;
    let s = adj.get(x);
    if (!s) {
      s = new Set();
      adj.set(x, s);
    }
    s.add(y);
  };
  for (const rec of getRegistry()) {
    // Pair refs are real token addresses (WQ already substituted for native).
    const x = rec.token0.address.toLowerCase();
    const y = rec.token1.address.toLowerCase();
    link(x, y);
    link(y, x);
  }
  return adj;
}

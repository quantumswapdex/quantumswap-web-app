/**
 * Client-side path finder for swaps, using the pair-existence model shared with
 * the browser extension: take the direct pair when it exists, otherwise BFS the
 * pair-existence graph (registry-known pairs plus on-demand factory.getPair
 * checks over a bounded candidate set) for the SHORTEST route, then quote that
 * single path with getAmountsOut. Pair existence is amount-independent, so
 * routes cache well and stay consistent between quoting and submission.
 */

import { ZERO_ADDRESS_32, type TokenInfo } from "../config/chain";
import { factoryAddress, wqAddress } from "../config/releases";
import { getAllTokens, toPathAddress } from "../tokens/tokenList";
import { findPairRecord, getRegistry } from "./pairRegistry";
import { factory, router as routerContract } from "./contracts";
import { sanitizeAddressResponse } from "./sanitizeResponse";

/** Cap on intermediate hop candidates per route search (bounds getPair fan-out). */
const MAX_INTERMEDIATE_CANDIDATES = 6;

/** Pair-existence results are cached briefly; pools rarely appear or disappear. */
const PAIR_EXISTS_CACHE_TTL_MS = 60_000;
const pairExistsCache = new Map<string, { exists: boolean; at: number }>();

/** Reset the pair-existence cache (tests; release switches are keyed already). */
export function clearRouteCache(): void {
  pairExistsCache.clear();
}

export interface RouteResult {
  /** WQ-substituted addresses; length 2..maxTokens. */
  path: string[];
  /** Final output amount from getAmountsOut over `path`. */
  out: bigint;
}

/**
 * Find the swap route from `fromToken` to `toToken`: the direct pair when it
 * exists, else the shortest multi-hop route (max `maxTokens` path tokens, i.e.
 * maxTokens - 2 intermediates). Returns null if no viable route is found.
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

  const path = await findShortestPath(A, B, maxTokens);
  if (!path) return null;

  try {
    const amounts = (await routerContract().getAmountsOut(amountIn, path)) as unknown as bigint[];
    if (!amounts || amounts.length === 0) return null;
    const out = BigInt(amounts[amounts.length - 1]);
    if (out <= 0n) return null;
    return { path, out };
  } catch {
    // The route exists structurally but cannot be quoted (e.g. drained pool).
    return null;
  }
}

/**
 * Shortest path from A to B over the pair-existence graph: nodes are the two
 * endpoints plus the ordered intermediate candidates; edges are pairs that
 * exist (registry hit or factory.getPair). All existence checks run in
 * parallel, then a BFS bounded to maxTokens - 1 edges picks the route.
 */
async function findShortestPath(A: string, B: string, maxTokens: number): Promise<string[] | null> {
  if (await pairExists(A, B)) return [A, B];
  if (maxTokens < 3) return null;

  const nodes = [A, ...candidateIntermediates(A, B), B];
  const target = nodes.length - 1;
  if (target < 2) return null;

  const adj: number[][] = nodes.map(() => []);
  const checks: Promise<void>[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (i === 0 && j === target) continue; // direct pair already checked
      checks.push(
        pairExists(nodes[i], nodes[j]).then((exists) => {
          if (exists) {
            adj[i].push(j);
            adj[j].push(i);
          }
        }),
      );
    }
  }
  await Promise.all(checks);

  const maxEdges = maxTokens - 1;
  const prev = new Array<number>(nodes.length).fill(-1);
  const depth = new Array<number>(nodes.length).fill(-1);
  depth[0] = 0;
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift() as number;
    if (cur === target) break;
    if (depth[cur] >= maxEdges) continue;
    for (const next of adj[cur]) {
      if (depth[next] !== -1) continue;
      depth[next] = depth[cur] + 1;
      prev[next] = cur;
      queue.push(next);
    }
  }
  if (depth[target] === -1 || depth[target] > maxEdges) return null;

  const idxPath: number[] = [];
  for (let cur = target; cur !== -1; cur = prev[cur]) idxPath.unshift(cur);
  return idxPath.map((i) => nodes[i]);
}

/**
 * Ordered, deduped intermediate candidates (lowercased), excluding the
 * endpoints: WQ first, then built-in/imported tokens, then registry pair
 * constituents, capped at MAX_INTERMEDIATE_CANDIDATES so the getPair fan-out
 * stays bounded.
 */
function candidateIntermediates(A: string, B: string): string[] {
  const seen = new Set<string>([A, B]);
  const out: string[] = [];
  const add = (addr: string): void => {
    if (out.length >= MAX_INTERMEDIATE_CANDIDATES) return;
    const a = addr.toLowerCase();
    if (seen.has(a)) return;
    seen.add(a);
    out.push(a);
  };
  add(wqAddress());
  for (const t of getAllTokens()) add(toPathAddress(t));
  for (const rec of getRegistry()) {
    add(rec.token0.address);
    add(rec.token1.address);
  }
  return out;
}

/**
 * Does a pair exist for two token addresses? Registry hits are authoritative
 * and free; misses fall through to factory.getPair, whose result is cached
 * briefly. RPC failures are treated as "no pair" but never cached.
 */
async function pairExists(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  if (findPairRecord(a, b)) return true;

  const key = factoryAddress().toLowerCase() + "|" + [a, b].sort().join("|");
  const cached = pairExistsCache.get(key);
  if (cached && Date.now() - cached.at < PAIR_EXISTS_CACHE_TTL_MS) return cached.exists;

  try {
    const raw = await factory().getPair(a, b);
    const addr = sanitizeAddressResponse(raw);
    const exists = !!addr && addr.toLowerCase() !== ZERO_ADDRESS_32.toLowerCase();
    pairExistsCache.set(key, { exists, at: Date.now() });
    return exists;
  } catch {
    return false;
  }
}

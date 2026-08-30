/**
 * Client-side route finder for swaps.
 *
 * API first: the Swap Read API returns up to k liquid candidate paths (pools
 * with liquidity on both sides, ranked by depth) together with their current
 * reserves. Every candidate is evaluated locally with constant-product math
 * (`./quoteMath.ts`) for the requested amount and the best one wins. When a
 * wallet is connected the chosen path is then quoted by the router
 * (getAmountsOut / getAmountsIn) so the amount that becomes `amountOutMin` /
 * `amountInMax` is chain truth; the local estimate is only shown when no
 * wallet is connected or the router call fails (`source: "api-estimate"`).
 *
 * RPC fallback (API unavailable): the original pair-existence model shared
 * with the browser extension - take the direct pair when it exists, otherwise
 * BFS the pair-existence graph (registry-known pairs plus on-demand
 * factory.getPair checks over a bounded candidate set) for the SHORTEST route,
 * then quote that single path with the router. Needs a connected wallet.
 */

import { ZERO_ADDRESS_32, type TokenInfo } from "../config/chain";
import { factoryAddress, wqAddress } from "../config/releases";
import { getAllTokens, toPathAddress } from "../tokens/tokenList";
import { findPairRecord, getRegistry } from "./pairRegistry";
import { factory, router as routerContract } from "./contracts";
import { sanitizeAddressResponse } from "./sanitizeResponse";
import { getAmountIn, getAmountOut } from "./quoteMath";
import { getRoutes, invalidate as invalidateMarketData } from "./marketData";
import type { ApiReserves, ApiRoutePath } from "./swapApi";
import { walletStore } from "../wallet/wallet";

/**
 * Cap on intermediate hop candidates per route search (bounds getPair fan-out).
 * Must comfortably exceed the built-in approved token count (WQ + 6 approved)
 * so every recognized token is always a hop candidate, with room left for
 * imported tokens and registry pair constituents.
 */
const MAX_INTERMEDIATE_CANDIDATES = 10;

/** Pair-existence results are cached briefly; pools rarely appear or disappear. */
const PAIR_EXISTS_CACHE_TTL_MS = 60_000;
const pairExistsCache = new Map<string, { exists: boolean; at: number }>();

/** Number of candidate paths requested from the API per lookup. */
const API_ROUTE_K = 3;

/** Reset the pair-existence cache and the API route memo (tests; release switches are keyed already). */
export function clearRouteCache(): void {
  pairExistsCache.clear();
  invalidateMarketData();
}

/**
 * Thrown when a route exists structurally (the pools are there) but the router
 * cannot quote the requested amount - e.g. a drained pool, or an exact-out
 * amount at or above the pool's reserves. Distinct from "no route" (null) so
 * the UI can say "not enough liquidity" instead of "no pool exists".
 */
export class InsufficientLiquidityError extends Error {
  constructor() {
    super("Not enough liquidity on this route for the requested amount.");
    this.name = "InsufficientLiquidityError";
  }
}

/** Where the quoted amount came from. */
export type QuoteSource = "router" | "api-estimate";

export interface RouteResult {
  /** WQ-substituted addresses; length 2..maxTokens. */
  path: string[];
  /** Final output amount over `path`. */
  out: bigint;
  /** "router" = chain quote (getAmountsOut); "api-estimate" = local math over indexed reserves. */
  source: QuoteSource;
  /** Block the API reserves were indexed at (estimates only). */
  indexedBlock?: number;
}

export interface RouteResultExactOut {
  /** WQ-substituted addresses; length 2..maxTokens. */
  path: string[];
  /** Required input amount over `path`. */
  amountIn: bigint;
  source: QuoteSource;
  indexedBlock?: number;
}

/**
 * Find the swap route from `fromToken` to `toToken` for an exact input:
 * API candidates evaluated locally (then router-quoted when connected), else
 * the direct pair / shortest multi-hop route via RPC (max `maxTokens` path
 * tokens). Returns null when no route exists at all; throws
 * InsufficientLiquidityError when a route exists but cannot be quoted.
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

  const api = await getRoutes(A, B, API_ROUTE_K);
  if (api) {
    const candidates = api.paths.filter((p) => p.hops.length + 1 <= maxTokens);
    if (candidates.length === 0) return null;
    let best: { path: string[]; out: bigint } | null = null;
    for (const cand of candidates) {
      const out = simulateExactIn(amountIn, A, cand, api.pairs);
      if (out === null) continue;
      if (!best || out > best.out || (out === best.out && cand.hops.length + 1 < best.path.length)) {
        best = { path: pathTokens(A, cand), out };
      }
    }
    if (!best) throw new InsufficientLiquidityError();
    if (walletStore.get().status === "connected") {
      try {
        const amounts = (await routerContract().getAmountsOut(amountIn, best.path)) as unknown as bigint[];
        const out = amounts && amounts.length > 0 ? BigInt(amounts[amounts.length - 1]) : 0n;
        if (out > 0n) return { path: best.path, out, source: "router" };
      } catch {
        /* router unavailable: keep the local estimate */
      }
    }
    return { path: best.path, out: best.out, source: "api-estimate", indexedBlock: api.indexedBlock };
  }

  const path = await findShortestPath(A, B, maxTokens);
  if (!path) return null;

  try {
    const amounts = (await routerContract().getAmountsOut(amountIn, path)) as unknown as bigint[];
    const out = amounts && amounts.length > 0 ? BigInt(amounts[amounts.length - 1]) : 0n;
    if (out <= 0n) throw new Error("zero output");
    return { path, out, source: "router" };
  } catch {
    // The route exists structurally but cannot be quoted (e.g. drained pool).
    throw new InsufficientLiquidityError();
  }
}

/**
 * Exact-out counterpart of findBestRoute: the same candidates, quoted for the
 * required input with getAmountsIn (router) or local math. Returns null when
 * no route exists at all; throws InsufficientLiquidityError when a route
 * exists but the output is at or above the pool's reserves.
 */
export async function findBestRouteExactOut(
  amountOut: bigint,
  fromToken: TokenInfo,
  toToken: TokenInfo,
  maxTokens = 5,
): Promise<RouteResultExactOut | null> {
  const A = toPathAddress(fromToken).toLowerCase();
  const B = toPathAddress(toToken).toLowerCase();
  if (A === B) return null;
  if (maxTokens < 2) maxTokens = 2;

  const api = await getRoutes(A, B, API_ROUTE_K);
  if (api) {
    const candidates = api.paths.filter((p) => p.hops.length + 1 <= maxTokens);
    if (candidates.length === 0) return null;
    let best: { path: string[]; amountIn: bigint } | null = null;
    for (const cand of candidates) {
      const amountIn = simulateExactOut(amountOut, A, cand, api.pairs);
      if (amountIn === null) continue;
      if (!best || amountIn < best.amountIn || (amountIn === best.amountIn && cand.hops.length + 1 < best.path.length)) {
        best = { path: pathTokens(A, cand), amountIn };
      }
    }
    if (!best) throw new InsufficientLiquidityError();
    if (walletStore.get().status === "connected") {
      try {
        const amounts = (await routerContract().getAmountsIn(amountOut, best.path)) as unknown as bigint[];
        const amountIn = amounts && amounts.length > 0 ? BigInt(amounts[0]) : 0n;
        if (amountIn > 0n) return { path: best.path, amountIn, source: "router" };
      } catch {
        /* router unavailable: keep the local estimate */
      }
    }
    return { path: best.path, amountIn: best.amountIn, source: "api-estimate", indexedBlock: api.indexedBlock };
  }

  const path = await findShortestPath(A, B, maxTokens);
  if (!path) return null;

  try {
    const amounts = (await routerContract().getAmountsIn(amountOut, path)) as unknown as bigint[];
    const amountIn = amounts && amounts.length > 0 ? BigInt(amounts[0]) : 0n;
    if (amountIn <= 0n) throw new Error("zero input");
    return { path, amountIn, source: "router" };
  } catch {
    // Route exists but cannot be quoted (drained pool / amountOut >= reserves).
    throw new InsufficientLiquidityError();
  }
}

// ---------- API candidates: local constant-product evaluation ----------

/** Token path [A, hop1.tokenOut, ...] for an API candidate. */
function pathTokens(A: string, cand: ApiRoutePath): string[] {
  return [A, ...cand.hops.map((h) => h.tokenOut.toLowerCase())];
}

/** Reserves oriented for a hop: (reserveIn, reserveOut), or null when the pool is unknown/drained. */
function hopReserves(
  tokenIn: string,
  pairAddress: string,
  pairs: Record<string, ApiReserves>,
): { reserveIn: bigint; reserveOut: bigint } | null {
  const r = pairs[pairAddress.toLowerCase()];
  if (!r) return null;
  const inIs0 = r.token0 === tokenIn.toLowerCase();
  const reserveIn = inIs0 ? r.reserve0 : r.reserve1;
  const reserveOut = inIs0 ? r.reserve1 : r.reserve0;
  if (reserveIn <= 0n || reserveOut <= 0n) return null;
  return { reserveIn, reserveOut };
}

/** Output of an exact-in swap over the candidate, or null when it cannot be filled. */
function simulateExactIn(amountIn: bigint, A: string, cand: ApiRoutePath, pairs: Record<string, ApiReserves>): bigint | null {
  let amount = amountIn;
  let tokenIn = A;
  for (const hop of cand.hops) {
    if (hop.tokenIn.toLowerCase() !== tokenIn) return null;
    const r = hopReserves(tokenIn, hop.pairAddress, pairs);
    if (!r) return null;
    amount = getAmountOut(amount, r.reserveIn, r.reserveOut);
    if (amount <= 0n) return null;
    tokenIn = hop.tokenOut.toLowerCase();
  }
  return amount;
}

/** Required input of an exact-out swap over the candidate, or null when it cannot be filled. */
function simulateExactOut(amountOut: bigint, A: string, cand: ApiRoutePath, pairs: Record<string, ApiReserves>): bigint | null {
  const tokens = pathTokens(A, cand);
  let amount = amountOut;
  for (let i = cand.hops.length - 1; i >= 0; i--) {
    const hop = cand.hops[i];
    const r = hopReserves(tokens[i], hop.pairAddress, pairs);
    if (!r) return null;
    if (amount >= r.reserveOut) return null;
    amount = getAmountIn(amount, r.reserveIn, r.reserveOut);
    if (amount <= 0n) return null;
  }
  return amount;
}

// ---------- RPC fallback: pair-existence BFS ----------

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

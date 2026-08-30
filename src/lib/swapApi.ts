/**
 * Swap Read API client (api/swap-api.yaml of the quantumscan explorer): a
 * per-DEX, read-only HTTP index of pools, reserves, LP supply, routes, token
 * facts and LP positions. Pure HTTP + response sanitization; no app state.
 * Everything coming back is untrusted and passes through the same sanitizers
 * as extension/RPC responses before it reaches math or the DOM.
 *
 * Contract notes that matter to callers:
 * - Every operation except `dexes()` is scoped by a dexId; an unknown dexId
 *   is a 404 on every scoped path (`SwapApiError.kind === "unknown-dex"`).
 * - Addresses are lowercase 0x + 64 hex; amounts are hex quantities (bigint
 *   here). `decimals` may be null when the explorer could not decode them -
 *   never take API decimals for amount math, use the token list / RPC.
 * - Token facts carry `identityKnown`; when false, symbol/name are empty.
 */

import { ADDRESS_RE } from "./sanitize";
import {
  sanitizeAddressResponse,
  sanitizeApiReserves,
  sanitizeDecimals,
  sanitizeName,
  sanitizeSymbol,
  toBigIntOrNull,
  toNumberOrNull,
} from "./sanitizeResponse";

/** Bounds the wait for any single request. */
export const SWAP_API_TIMEOUT_MS = 4000;

const DEX_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type SwapApiErrorKind = "network" | "timeout" | "http" | "parse" | "not-found" | "unknown-dex";

export class SwapApiError extends Error {
  readonly kind: SwapApiErrorKind;
  readonly status?: number;
  constructor(kind: SwapApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "SwapApiError";
    this.kind = kind;
    this.status = status;
  }
  /** True for outages (network, timeout, 5xx, malformed body) - not for data answers. */
  get isOutage(): boolean {
    return this.kind === "network" || this.kind === "timeout" || this.kind === "parse" || (this.kind === "http" && (this.status ?? 0) >= 500);
  }
}

// ---------- DTOs (sanitized) ----------

export interface ApiDexInfo {
  dexId: string;
  name: string;
  factoryAddress: string;
  routerAddress: string;
  wrappedCoinAddress: string;
  feeBps: number;
}

export interface ApiDexList {
  indexedBlock: number;
  primordialHead: number;
  readApiBlock: number;
  lagBlocks: number;
  degraded: boolean;
  maxHops: number;
  maxK: number;
  dexes: ApiDexInfo[];
}

export interface ApiDexStatus extends ApiDexInfo {
  /** Default number of candidate paths the route operation returns when k is omitted. */
  routeDefaultPaths: number;
  indexedBlock: number;
  primordialHead: number;
  lagBlocks: number;
  degraded: boolean;
  pairs: number;
  activePairs: number;
  tokens: number;
  lastTokenBlock: number;
  tokensUnresolved: number;
  routeEntries: number;
  routeVersion: number;
}

export interface ApiTokenFacts {
  dexId: string;
  address: string;
  symbol: string;
  name: string;
  /** null when the explorer could not decode decimals. Never assume 18 for math. */
  decimals: number | null;
  identityKnown: boolean;
  feeOnTransfer: boolean;
  feeBpsObserved: number | null;
  pairCount: number;
  /** Empty when the token has no pair on the DEX (route token maps). */
  firstPairAddress: string;
  firstBlock: number;
}

export interface ApiPage<T> {
  dexId: string;
  indexedBlock: number;
  page: number;
  pageCount: number;
  totalItems: number;
  items: T[];
}

export interface ApiReserves {
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  lastSyncBlock: number;
}

export interface ApiPool {
  dexId: string;
  pairAddress: string;
  pairIndex: number;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  lastSyncBlock: number;
  lpTotalSupply: bigint;
  token0Facts: ApiTokenFacts;
  token1Facts: ApiTokenFacts;
  swapCount: number;
  liquidityEvents: number;
  createdBlock: number;
  createdAt: string;
  creatorAddress: string;
}

export interface ApiPathHop {
  pairAddress: string;
  tokenIn: string;
  tokenOut: string;
}

export interface ApiRoutePath {
  rank: number;
  hops: ApiPathHop[];
  depthQ: bigint | null;
  depthKnown: boolean;
}

export interface ApiRouteResponse {
  dexId: string;
  fromToken: string;
  toToken: string;
  indexedBlock: number;
  routeVersion: number;
  paths: ApiRoutePath[];
  /** Reserves of every pool on the paths, keyed by lowercase pair address. */
  pairs: Record<string, ApiReserves>;
  /** Facts for every token on the paths (incl. from/to), keyed by lowercase address. */
  tokens: Record<string, ApiTokenFacts>;
}

export interface ApiPairLookup {
  dexId: string;
  indexedBlock: number;
  exists: boolean;
  pair: ApiPool | null;
  accountLpBalance: bigint | null;
}

export interface ApiPosition extends ApiPool {
  lpBalance: bigint;
}

export interface ApiAccountPositions {
  dexId: string;
  account: string;
  indexedBlock: number;
  items: ApiPosition[];
  capped: boolean;
}

export type ApiPoolSort = "liquidity" | "newest";

// ---------- parsing helpers (throw SwapApiError("parse")) ----------

function fail(what: string): never {
  throw new SwapApiError("parse", `Swap API response malformed: ${what}`);
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(what);
  return value as Record<string, unknown>;
}

function int(value: unknown, what: string): number {
  const n = toNumberOrNull(value);
  if (n === null) fail(what);
  return n;
}

function big(value: unknown, what: string): bigint {
  const b = toBigIntOrNull(value);
  if (b === null) fail(what);
  return b;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") fail(what);
  return value;
}

function addr(value: unknown, what: string): string {
  const a = sanitizeAddressResponse(value);
  if (!a) fail(what);
  return a.toLowerCase();
}

function optionalAddr(value: unknown): string {
  if (value === "" || value === null || value === undefined) return "";
  const a = sanitizeAddressResponse(value);
  return a ? a.toLowerCase() : "";
}

function str(value: unknown, what: string, max = 200): string {
  if (typeof value !== "string") fail(what);
  return value.slice(0, max);
}

function dexIdOf(value: unknown): string {
  const s = str(value, "dexId", 64);
  if (!DEX_ID_RE.test(s)) fail("dexId");
  return s;
}

function parseDexInfo(value: unknown): ApiDexInfo {
  const v = obj(value, "dex");
  return {
    dexId: dexIdOf(v.dexId),
    name: sanitizeName(v.name),
    factoryAddress: addr(v.factoryAddress, "dex.factoryAddress"),
    routerAddress: addr(v.routerAddress, "dex.routerAddress"),
    wrappedCoinAddress: addr(v.wrappedCoinAddress, "dex.wrappedCoinAddress"),
    feeBps: int(v.feeBps, "dex.feeBps"),
  };
}

export function parseDexList(value: unknown): ApiDexList {
  const v = obj(value, "dexes");
  if (!Array.isArray(v.dexes)) fail("dexes.dexes");
  return {
    indexedBlock: int(v.indexedBlock, "dexes.indexedBlock"),
    primordialHead: int(v.primordialHead, "dexes.primordialHead"),
    readApiBlock: int(v.readApiBlock, "dexes.readApiBlock"),
    lagBlocks: int(v.lagBlocks, "dexes.lagBlocks"),
    degraded: bool(v.degraded, "dexes.degraded"),
    maxHops: int(v.maxHops, "dexes.maxHops"),
    maxK: int(v.maxK, "dexes.maxK"),
    dexes: v.dexes.map(parseDexInfo),
  };
}

export function parseDexStatus(value: unknown): ApiDexStatus {
  const v = obj(value, "status");
  return {
    ...parseDexInfo(v),
    routeDefaultPaths: int(v.routeDefaultPaths, "status.routeDefaultPaths"),
    indexedBlock: int(v.indexedBlock, "status.indexedBlock"),
    primordialHead: int(v.primordialHead, "status.primordialHead"),
    lagBlocks: int(v.lagBlocks, "status.lagBlocks"),
    degraded: bool(v.degraded, "status.degraded"),
    pairs: int(v.pairs, "status.pairs"),
    activePairs: int(v.activePairs, "status.activePairs"),
    tokens: int(v.tokens, "status.tokens"),
    lastTokenBlock: int(v.lastTokenBlock, "status.lastTokenBlock"),
    tokensUnresolved: int(v.tokensUnresolved, "status.tokensUnresolved"),
    routeEntries: int(v.routeEntries, "status.routeEntries"),
    routeVersion: int(v.routeVersion, "status.routeVersion"),
  };
}

export function parseTokenFacts(value: unknown): ApiTokenFacts {
  const v = obj(value, "token");
  const identityKnown = bool(v.identityKnown, "token.identityKnown");
  const decimals = v.decimals === null || v.decimals === undefined ? null : sanitizeDecimals(v.decimals, -1);
  if (decimals !== null && decimals < 0) fail("token.decimals");
  const feeBps = v.feeBpsObserved === null || v.feeBpsObserved === undefined ? null : int(v.feeBpsObserved, "token.feeBpsObserved");
  return {
    dexId: dexIdOf(v.dexId),
    address: addr(v.address, "token.address"),
    symbol: identityKnown ? sanitizeSymbol(v.symbol) : "",
    name: identityKnown ? sanitizeName(v.name) : "",
    decimals,
    identityKnown,
    feeOnTransfer: bool(v.feeOnTransfer, "token.feeOnTransfer"),
    feeBpsObserved: feeBps,
    pairCount: int(v.pairCount, "token.pairCount"),
    firstPairAddress: optionalAddr(v.firstPairAddress),
    firstBlock: int(v.firstBlock, "token.firstBlock"),
  };
}

function parsePage<T>(value: unknown, what: string, item: (v: unknown) => T): ApiPage<T> {
  const v = obj(value, what);
  if (!Array.isArray(v.items)) fail(`${what}.items`);
  return {
    dexId: dexIdOf(v.dexId),
    indexedBlock: int(v.indexedBlock, `${what}.indexedBlock`),
    page: int(v.page, `${what}.page`),
    pageCount: int(v.pageCount, `${what}.pageCount`),
    totalItems: int(v.totalItems, `${what}.totalItems`),
    items: v.items.map(item),
  };
}

export function parsePool(value: unknown): ApiPool {
  const v = obj(value, "pool");
  const reserves = sanitizeApiReserves(v);
  if (!reserves) fail("pool.reserves");
  return {
    dexId: dexIdOf(v.dexId),
    pairAddress: addr(v.pairAddress, "pool.pairAddress"),
    pairIndex: int(v.pairIndex, "pool.pairIndex"),
    token0: reserves.token0,
    token1: reserves.token1,
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    lastSyncBlock: int(v.lastSyncBlock, "pool.lastSyncBlock"),
    lpTotalSupply: big(v.lpTotalSupply, "pool.lpTotalSupply"),
    token0Facts: parseTokenFacts(v.token0Facts),
    token1Facts: parseTokenFacts(v.token1Facts),
    swapCount: int(v.swapCount, "pool.swapCount"),
    liquidityEvents: int(v.liquidityEvents, "pool.liquidityEvents"),
    createdBlock: int(v.createdBlock, "pool.createdBlock"),
    createdAt: str(v.createdAt, "pool.createdAt", 40),
    creatorAddress: addr(v.creatorAddress, "pool.creatorAddress"),
  };
}

function parseReserves(value: unknown): ApiReserves {
  const v = obj(value, "reserves");
  const reserves = sanitizeApiReserves(v);
  if (!reserves) fail("reserves");
  return { ...reserves, lastSyncBlock: int(v.lastSyncBlock, "reserves.lastSyncBlock") };
}

export function parseRoute(value: unknown): ApiRouteResponse {
  const v = obj(value, "route");
  if (!Array.isArray(v.paths)) fail("route.paths");
  const pairsIn = obj(v.pairs ?? {}, "route.pairs");
  const tokensIn = obj(v.tokens ?? {}, "route.tokens");
  const pairs: Record<string, ApiReserves> = {};
  for (const [k, r] of Object.entries(pairsIn)) pairs[addr(k, "route.pairs key")] = parseReserves(r);
  const tokens: Record<string, ApiTokenFacts> = {};
  for (const [k, t] of Object.entries(tokensIn)) tokens[addr(k, "route.tokens key")] = parseTokenFacts(t);
  const paths: ApiRoutePath[] = v.paths.map((p) => {
    const pv = obj(p, "route.path");
    if (!Array.isArray(pv.hops) || pv.hops.length === 0) fail("route.path.hops");
    const hops: ApiPathHop[] = pv.hops.map((h) => {
      const hv = obj(h, "route.hop");
      const pairAddress = addr(hv.pairAddress, "route.hop.pairAddress");
      if (!pairs[pairAddress]) fail("route.hop pair missing from pairs");
      return { pairAddress, tokenIn: addr(hv.tokenIn, "route.hop.tokenIn"), tokenOut: addr(hv.tokenOut, "route.hop.tokenOut") };
    });
    const depthKnown = bool(pv.depthKnown, "route.path.depthKnown");
    const depthQ = pv.depthQ === null || pv.depthQ === undefined ? null : big(pv.depthQ, "route.path.depthQ");
    return { rank: int(pv.rank, "route.path.rank"), hops, depthQ, depthKnown };
  });
  return {
    dexId: dexIdOf(v.dexId),
    fromToken: addr(v.fromToken, "route.fromToken"),
    toToken: addr(v.toToken, "route.toToken"),
    indexedBlock: int(v.indexedBlock, "route.indexedBlock"),
    routeVersion: int(v.routeVersion, "route.routeVersion"),
    paths,
    pairs,
    tokens,
  };
}

export function parsePairLookup(value: unknown): ApiPairLookup {
  const v = obj(value, "pair");
  const exists = bool(v.exists, "pair.exists");
  const pair = exists ? parsePool(v.pair) : null;
  const bal = v.accountLpBalance === null || v.accountLpBalance === undefined ? null : big(v.accountLpBalance, "pair.accountLpBalance");
  return { dexId: dexIdOf(v.dexId), indexedBlock: int(v.indexedBlock, "pair.indexedBlock"), exists, pair, accountLpBalance: bal };
}

export function parsePositions(value: unknown): ApiAccountPositions {
  const v = obj(value, "positions");
  if (!Array.isArray(v.items)) fail("positions.items");
  return {
    dexId: dexIdOf(v.dexId),
    account: addr(v.account, "positions.account"),
    indexedBlock: int(v.indexedBlock, "positions.indexedBlock"),
    items: v.items.map((it) => ({ ...parsePool(it), lpBalance: big(obj(it, "position").lpBalance, "position.lpBalance") })),
    capped: bool(v.capped, "positions.capped"),
  };
}

// ---------- client ----------

export interface SwapApiClientOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

export interface SwapApiClient {
  readonly baseUrl: string;
  dexes(): Promise<ApiDexList>;
  status(dexId: string): Promise<ApiDexStatus>;
  token(dexId: string, address: string): Promise<ApiTokenFacts>;
  tokens(dexId: string, page: number): Promise<ApiPage<ApiTokenFacts>>;
  pools(dexId: string, opts?: { page?: number; sort?: ApiPoolSort; token?: string }): Promise<ApiPage<ApiPool>>;
  pool(dexId: string, pairAddress: string): Promise<ApiPool>;
  route(dexId: string, from: string, to: string, k?: number): Promise<ApiRouteResponse>;
  pair(dexId: string, tokenA: string, tokenB: string, account?: string): Promise<ApiPairLookup>;
  positions(dexId: string, account: string): Promise<ApiAccountPositions>;
  pairsCreated(dexId: string, account: string, page: number): Promise<ApiPage<ApiPool>>;
}

function requireAddress(value: string, what: string): string {
  const v = value.trim();
  if (!ADDRESS_RE.test(v)) throw new SwapApiError("parse", `${what} is not a 32-byte address`);
  return v.toLowerCase();
}

function requireDexId(value: string): string {
  if (!DEX_ID_RE.test(value)) throw new SwapApiError("unknown-dex", "dexId is malformed", 400);
  return value;
}

function requirePage(value: number | undefined): number {
  const n = Math.trunc(value ?? 1);
  return n >= 1 ? n : 1;
}

export function createSwapApiClient(baseUrl: string, options: SwapApiClientOptions = {}): SwapApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? SWAP_API_TIMEOUT_MS;

  async function get<T>(path: string, parse: (v: unknown) => T): Promise<T> {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== "function") throw new SwapApiError("network", "fetch is not available");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(base + path, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
        // Never send cookies/credentials to the API origin.
        credentials: "omit",
        mode: "cors",
      });
    } catch (err) {
      if (controller.signal.aborted) throw new SwapApiError("timeout", `Swap API timed out after ${timeoutMs} ms`);
      throw new SwapApiError("network", err instanceof Error ? err.message : "Swap API unreachable");
    } finally {
      clearTimeout(timer);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message = typeof (body as { message?: unknown } | null)?.message === "string" ? ((body as { message: string }).message).slice(0, 120) : "";
      if (res.status === 404) {
        if (/dex not found/i.test(message)) throw new SwapApiError("unknown-dex", message || "dex not found", 404);
        throw new SwapApiError("not-found", message || "not found", 404);
      }
      throw new SwapApiError("http", message || `Swap API HTTP ${res.status}`, res.status);
    }
    if (body === null) throw new SwapApiError("parse", "Swap API returned a non-JSON body");
    return parse(body);
  }

  // Every method is async so client-side validation failures (bad address /
  // dexId) surface as rejections, never synchronous throws.
  return {
    baseUrl: base,
    dexes: async () => get("/swap/v1/dexes", parseDexList),
    status: async (dexId) => get(`/swap/v1/${requireDexId(dexId)}/status`, parseDexStatus),
    token: async (dexId, address) => get(`/swap/v1/${requireDexId(dexId)}/token/${requireAddress(address, "address")}`, parseTokenFacts),
    tokens: async (dexId, page) =>
      get(`/swap/v1/${requireDexId(dexId)}/tokens?page=${requirePage(page)}`, (v) => parsePage(v, "tokens", parseTokenFacts)),
    pools: async (dexId, opts = {}) => {
      const q = new URLSearchParams();
      q.set("page", String(requirePage(opts.page)));
      q.set("sort", opts.sort === "newest" ? "newest" : "liquidity");
      if (opts.token) q.set("token", requireAddress(opts.token, "token"));
      return get(`/swap/v1/${requireDexId(dexId)}/pools?${q.toString()}`, (v) => parsePage(v, "pools", parsePool));
    },
    pool: async (dexId, pairAddress) => get(`/swap/v1/${requireDexId(dexId)}/pool/${requireAddress(pairAddress, "pairAddress")}`, parsePool),
    route: async (dexId, from, to, k) => {
      const kk = Math.min(5, Math.max(1, Math.trunc(k ?? 3)));
      return get(`/swap/v1/${requireDexId(dexId)}/route/${requireAddress(from, "from")}/${requireAddress(to, "to")}?k=${kk}`, parseRoute);
    },
    pair: async (dexId, tokenA, tokenB, account) => {
      const suffix = account ? `?account=${requireAddress(account, "account")}` : "";
      return get(`/swap/v1/${requireDexId(dexId)}/pair/${requireAddress(tokenA, "tokenA")}/${requireAddress(tokenB, "tokenB")}${suffix}`, parsePairLookup);
    },
    positions: async (dexId, account) =>
      get(`/swap/v1/${requireDexId(dexId)}/account/${requireAddress(account, "account")}/positions`, parsePositions),
    pairsCreated: async (dexId, account, page) =>
      get(`/swap/v1/${requireDexId(dexId)}/account/${requireAddress(account, "account")}/pairs-created?page=${requirePage(page)}`, (v) =>
        parsePage(v, "pairs-created", parsePool),
      ),
  };
}

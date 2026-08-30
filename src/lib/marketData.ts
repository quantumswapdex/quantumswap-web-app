/**
 * Market-data facade: the single entry point for read-only market lookups
 * (pools, reserves, LP supply, pair lookup, routes, token facts, LP positions).
 *
 * API first, RPC fallback. The Swap Read API (`./swapApi.ts`, per-DEX index
 * served by the explorer) answers when it is healthy and indexes the active
 * release's factory; otherwise every read transparently falls back to the
 * extension RPC path the app always had (which needs a connected wallet).
 * Wallet state (balances, allowances), transactions, receipts, deadlines and
 * the exact-out fee pre-flight never come through here - they stay on RPC.
 *
 * Availability: `probeSwapApi()` looks the active release's dexId up in
 * GET /swap/v1/dexes at boot and on every release switch, and only accepts it
 * when the API's factory for that dexId is the release's factory (so a default
 * dexId can never serve another deployment's data). A release with an empty
 * API URL or dexId has the API off (`disabled`) and never fetches. A small
 * circuit breaker marks the API unavailable after consecutive outages and
 * re-probes after a cooldown, so a flapping API degrades to RPC instead of
 * erroring.
 */

import { createStore } from "../ui/store";
import { ZERO_ADDRESS_32, type TokenInfo } from "../config/chain";
import { currentRelease, onReleaseRefresh, swapApiConfiguredDexId, swapApiEnabled, swapApiUrl, wqAddress } from "../config/releases";
import type { PairRecord, PairTokenRef } from "../config/pairs";
import { walletStore } from "../wallet/wallet";
import { pair as pairContract } from "./contracts";
import { sanitizeAddress } from "./sanitize";
import { sanitizeAddressResponse, sanitizeDecimals, sanitizeReserves, sanitizeSymbol } from "./sanitizeResponse";
import {
  discoverAllFromFactoryRpc,
  discoverKnownPairsRpc,
  findPairRecord,
  getRegistry,
  mergePair,
  resolvePairAddressRpc,
} from "./pairRegistry";
import {
  applyApprovedTokenMetadata,
  getAllTokens,
  notifyTokenMetadataChanged,
  readTokenMetadata,
  toPathAddress,
  type TokenMetadata,
} from "../tokens/tokenList";
import { APPROVED_TOKENS } from "../config/chain";
import {
  createSwapApiClient,
  SwapApiError,
  type ApiPool,
  type ApiRouteResponse,
  type ApiTokenFacts,
  type ApiPoolSort,
  type SwapApiClient,
} from "./swapApi";

/**
 * unknown: not probed yet · ok: serving the active release · unavailable:
 * unreachable / outage (breaker open) · no-dex: reachable but the release's
 * dexId is not served for its factory · disabled: the release has no API URL
 * or dexId (extension RPC only, nothing is fetched).
 */
export type MarketStatus = "unknown" | "ok" | "unavailable" | "no-dex" | "disabled";

export interface MarketState {
  status: MarketStatus;
  /** dexId of the active release on the API (null unless status is ok). */
  dexId: string | null;
  indexedBlock: number | null;
  lagBlocks: number;
  /** API reachable but lagging the chain or reporting an explorer error. */
  degraded: boolean;
  apiUrl: string;
}

export const marketStore = createStore<MarketState>({
  status: "unknown",
  dexId: null,
  indexedBlock: null,
  lagBlocks: 0,
  degraded: false,
  apiUrl: "",
});

/** Consecutive outages before the API is considered unavailable. */
export const BREAKER_FAILURES = 2;
/** How long the breaker stays open before a re-probe. */
export const BREAKER_COOLDOWN_MS = 30_000;
/** Index lag (blocks) above which API data is flagged degraded. */
export const DEGRADED_LAG_BLOCKS = 20;

/** Thrown when neither the API nor a connected wallet can serve a read. */
export class MarketUnavailableError extends Error {
  constructor(message = "Market data is unavailable. Connect your wallet to load it from the chain.") {
    super(message);
    this.name = "MarketUnavailableError";
  }
}

let failures = 0;
let openedAt = 0;
let clientCache: { url: string; client: SwapApiClient } | null = null;
let probeSeq = 0;
/** Injectable clock (tests). */
let now: () => number = () => Date.now();

export function setMarketClock(fn: () => number): void {
  now = fn;
}

function client(): SwapApiClient {
  const url = swapApiUrl();
  if (!clientCache || clientCache.url !== url) clientCache = { url, client: createSwapApiClient(url) };
  return clientCache.client;
}

/** Reset breaker + memos (tests, release switches). */
export function resetMarketData(): void {
  failures = 0;
  openedAt = 0;
  routeMemo.clear();
  marketStore.set({ status: "unknown", dexId: null, indexedBlock: null, lagBlocks: 0, degraded: false, apiUrl: swapApiUrl() });
}

/** Drop memoised reads (after a confirmed transaction). */
export function invalidate(): void {
  routeMemo.clear();
}

/**
 * Probe the Swap Read API: confirm via GET /dexes that the active release's
 * dexId is served and belongs to the release's factory. Sets status ok /
 * no-dex / unavailable, or disabled (no fetch) when the release has the API
 * off. Safe to call repeatedly; a newer probe supersedes an in-flight one.
 */
export async function probeSwapApi(): Promise<MarketState> {
  const seq = ++probeSeq;
  const url = swapApiUrl();
  if (!swapApiEnabled()) {
    failures = 0;
    openedAt = 0;
    marketStore.set({ status: "disabled", dexId: null, indexedBlock: null, lagBlocks: 0, degraded: false, apiUrl: url });
    return marketStore.get();
  }
  try {
    const list = await client().dexes();
    if (seq !== probeSeq) return marketStore.get();
    // The release's dexId must be served by this API *and* index the
    // release's factory: the add-form prefills the Beta 2 dexId, so without
    // this check a custom deployment would read Beta 2's pools.
    const factoryAddr = currentRelease().factory.toLowerCase();
    const configured = swapApiConfiguredDexId();
    const candidate = list.dexes.find((d) => d.dexId === configured);
    const dex = candidate && candidate.factoryAddress.toLowerCase() === factoryAddr ? candidate : undefined;
    failures = 0;
    openedAt = 0;
    const degraded = list.degraded || list.lagBlocks > DEGRADED_LAG_BLOCKS;
    marketStore.set(
      dex
        ? { status: "ok", dexId: dex.dexId, indexedBlock: list.indexedBlock, lagBlocks: list.lagBlocks, degraded, apiUrl: url }
        : { status: "no-dex", dexId: null, indexedBlock: list.indexedBlock, lagBlocks: list.lagBlocks, degraded, apiUrl: url },
    );
  } catch {
    if (seq !== probeSeq) return marketStore.get();
    failures = BREAKER_FAILURES;
    openedAt = now();
    marketStore.set({ status: "unavailable", dexId: null, indexedBlock: null, lagBlocks: 0, degraded: false, apiUrl: url });
  }
  return marketStore.get();
}

/** Re-probe on release switches (registered once at module load). */
onReleaseRefresh(() => {
  resetMarketData();
  void probeSwapApi();
});

/** True when the API is serving the active release. */
export function apiAvailable(): boolean {
  return marketStore.get().status === "ok";
}

/** True when a market read can be served (API ok, or wallet connected for RPC). */
export function canRead(): boolean {
  return apiAvailable() || walletStore.get().status === "connected";
}

/** The dexId of the active release on the API, or null. */
export function swapApiDexId(): string | null {
  return marketStore.get().dexId;
}

function recordFailure(err: unknown): void {
  if (!(err instanceof SwapApiError) || !err.isOutage) return;
  failures++;
  if (failures >= BREAKER_FAILURES) {
    openedAt = now();
    marketStore.update((s) => (s.status === "ok" ? { ...s, status: "unavailable", dexId: null } : s));
  }
}

function recordSuccess(indexedBlock?: number): void {
  failures = 0;
  if (indexedBlock !== undefined) {
    marketStore.update((s) => (s.indexedBlock === indexedBlock ? s : { ...s, indexedBlock }));
  }
}

/**
 * When the breaker is open and the cooldown has elapsed, try a cheap
 * `/status` re-probe before deciding the API is still down.
 */
async function maybeReprobe(): Promise<boolean> {
  const state = marketStore.get();
  if (state.status !== "unavailable") return state.status === "ok";
  if (now() - openedAt < BREAKER_COOLDOWN_MS) return false;
  openedAt = now(); // one attempt per cooldown window
  const probed = await probeSwapApi();
  return probed.status === "ok";
}

/**
 * API-first read with RPC fallback. `apiFn` receives the dexId; `rpcFn` is
 * today's chain path (needs a connected wallet). A `not-found` API answer is
 * a real answer and is returned as null without touching the breaker.
 */
async function apiFirst<T>(apiFn: (dexId: string) => Promise<T>, rpcFn: (() => Promise<T>) | null): Promise<T> {
  let usable = apiAvailable();
  if (!usable) usable = await maybeReprobe();
  if (usable) {
    const dexId = marketStore.get().dexId as string;
    try {
      return await apiFn(dexId);
    } catch (err) {
      if (err instanceof SwapApiError && err.kind === "not-found") throw err;
      if (err instanceof SwapApiError && err.kind === "unknown-dex") {
        marketStore.update((s) => ({ ...s, status: "no-dex", dexId: null }));
      } else {
        recordFailure(err);
      }
    }
  }
  if (rpcFn && walletStore.get().status === "connected") return rpcFn();
  throw new MarketUnavailableError();
}

// ---------- views of API/RPC data ----------

export interface PoolView {
  record: PairRecord;
  reserve0: bigint;
  reserve1: bigint;
  lpTotalSupply: bigint;
  /** Both reserves > 0. */
  active: boolean;
  /** API-only extras (undefined on the RPC path). */
  swapCount?: number;
  createdBlock?: number;
  creatorAddress?: string;
  /** API token facts for both sides (names, identityKnown, fee evidence). */
  facts?: { token0: ApiTokenFacts; token1: ApiTokenFacts };
}

export interface PoolPage {
  items: PoolView[];
  page: number;
  pageCount: number;
  totalItems: number;
  source: "api" | "rpc";
}

export interface PairLookupView {
  pairAddress: string | null;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  lpTotalSupply: bigint;
  /** Present only when an account was given and the pair exists. */
  accountLpBalance: bigint | null;
  source: "api" | "rpc";
}

export interface TokenFactsView {
  address: string;
  symbol: string;
  name: string;
  /** null when unknown (API could not decode / not asked); never assume 18 for math. */
  decimals: number | null;
  identityKnown: boolean;
  feeOnTransfer: boolean;
  pairCount: number;
  source: "api" | "rpc";
}

export interface PositionView {
  record: PairRecord;
  lpBalance: bigint;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
}

/** Decimals for a token address from the token list (built-in/imported/WQ), else null. */
function knownDecimals(address: string): number | null {
  const a = address.toLowerCase();
  for (const t of getAllTokens()) {
    if (!t.isNative && t.address.toLowerCase() === a) return t.decimals;
  }
  return null;
}

/** Symbol for a token address from the token list, else the API symbol, else "TKN". */
function refFor(address: string, facts: ApiTokenFacts | undefined): PairTokenRef {
  const a = address.toLowerCase();
  const known = getAllTokens().find((t) => !t.isNative && t.address.toLowerCase() === a);
  if (known) return { address: known.address, symbol: known.symbol, decimals: known.decimals };
  const symbol = facts?.identityKnown ? sanitizeSymbol(facts.symbol) : "";
  const decimals = facts?.decimals ?? null;
  return { address: sanitizeAddress(address) ?? address, symbol: symbol || "TKN", decimals: sanitizeDecimals(decimals ?? 18) };
}

/** Convert an API pool to a registry record + reserves, absorbing it into the registry. */
function absorbPool(p: ApiPool): PoolView {
  const record: PairRecord = {
    pairAddress: sanitizeAddress(p.pairAddress) ?? p.pairAddress,
    token0: refFor(p.token0, p.token0Facts),
    token1: refFor(p.token1, p.token1Facts),
    discovered: true,
  };
  mergePair(record);
  return {
    record,
    reserve0: p.reserve0,
    reserve1: p.reserve1,
    lpTotalSupply: p.lpTotalSupply,
    active: p.reserve0 > 0n && p.reserve1 > 0n,
    swapCount: p.swapCount,
    createdBlock: p.createdBlock,
    creatorAddress: p.creatorAddress,
    facts: { token0: p.token0Facts, token1: p.token1Facts },
  };
}

// ---------- pools ----------

/** One page of the active DEX's pools (API), or the registry with live reserves (RPC). */
export async function getPools(page = 1, sort: ApiPoolSort = "liquidity", token?: string): Promise<PoolPage> {
  return apiFirst<PoolPage>(
    async (dexId) => {
      const res = await client().pools(dexId, { page, sort, token });
      recordSuccess(res.indexedBlock);
      return { items: res.items.map(absorbPool), page: res.page, pageCount: res.pageCount, totalItems: res.totalItems, source: "api" as const };
    },
    async () => {
      await discoverKnownPairsRpc();
      let records = getRegistry();
      if (token) {
        const t = token.toLowerCase();
        records = records.filter((r) => r.token0.address.toLowerCase() === t || r.token1.address.toLowerCase() === t);
      }
      const items: PoolView[] = [];
      for (const record of records) {
        const view = await readPoolRpc(record).catch(() => null);
        if (view) items.push(view);
      }
      return { items, page: 1, pageCount: 1, totalItems: items.length, source: "rpc" as const };
    },
  );
}

async function readPoolRpc(record: PairRecord): Promise<PoolView> {
  const p = pairContract(record.pairAddress);
  const [reservesRaw, totalSupplyRaw] = await Promise.all([p.getReserves(), p.totalSupply()]);
  const reserves = sanitizeReserves(reservesRaw);
  if (!reserves) throw new Error("Could not read pair reserves");
  const lpTotalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
  return {
    record,
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    lpTotalSupply,
    active: reserves.reserve0 > 0n && reserves.reserve1 > 0n,
  };
}

/** One pool by pair address; null when it is not a pool of the active DEX. */
export async function getPool(pairAddress: string): Promise<PoolView | null> {
  try {
    return await apiFirst(
      async (dexId) => {
        const p = await client().pool(dexId, pairAddress);
        recordSuccess();
        return absorbPool(p);
      },
      async () => {
        const known = getRegistry().find((r) => r.pairAddress.toLowerCase() === pairAddress.toLowerCase());
        const p = pairContract(pairAddress);
        const [t0Raw, t1Raw] = await Promise.all([p.token0(), p.token1()]);
        const t0 = sanitizeAddressResponse(t0Raw);
        const t1 = sanitizeAddressResponse(t1Raw);
        if (!t0 || !t1) throw new Error("Could not read pair state");
        const record: PairRecord =
          known ?? {
            pairAddress: sanitizeAddress(pairAddress) ?? pairAddress,
            token0: await resolveRefRpc(t0),
            token1: await resolveRefRpc(t1),
            discovered: true,
          };
        if (!known) mergePair(record);
        return readPoolRpc(record);
      },
    );
  } catch (err) {
    if (err instanceof SwapApiError && err.kind === "not-found") return null;
    throw err;
  }
}

async function resolveRefRpc(address: string): Promise<PairTokenRef> {
  const known = getAllTokens().find((t) => toPathAddress(t).toLowerCase() === address.toLowerCase());
  if (known) return { address, symbol: known.symbol, decimals: known.decimals };
  try {
    const meta = await readTokenMetadata(address);
    return { address, symbol: meta.symbol, decimals: meta.decimals };
  } catch {
    return { address, symbol: "TKN", decimals: 18 };
  }
}

// ---------- pair lookup / registry discovery ----------

/**
 * Pool for two UI tokens (either order). pairAddress is null when no pair
 * exists on the active DEX. With `account`, includes the account's LP balance.
 */
export async function lookupPair(tokenA: TokenInfo, tokenB: TokenInfo, account?: string): Promise<PairLookupView> {
  const aAddr = toPathAddress(tokenA);
  const bAddr = toPathAddress(tokenB);
  const empty: PairLookupView = { pairAddress: null, token0: aAddr, token1: bAddr, reserve0: 0n, reserve1: 0n, lpTotalSupply: 0n, accountLpBalance: null, source: "api" };
  if (aAddr.toLowerCase() === bAddr.toLowerCase()) return empty;
  return apiFirst(
    async (dexId) => {
      const res = await client().pair(dexId, aAddr, bAddr, account);
      recordSuccess(res.indexedBlock);
      if (!res.exists || !res.pair) return empty;
      const view = absorbPool(res.pair);
      return {
        pairAddress: view.record.pairAddress,
        token0: res.pair.token0,
        token1: res.pair.token1,
        reserve0: res.pair.reserve0,
        reserve1: res.pair.reserve1,
        lpTotalSupply: res.pair.lpTotalSupply,
        accountLpBalance: res.accountLpBalance,
        source: "api",
      };
    },
    async () => {
      const pairAddress = await resolvePairAddressRpc(tokenA, tokenB);
      if (!pairAddress) return { ...empty, source: "rpc" };
      const p = pairContract(pairAddress);
      const [reservesRaw, token0Raw, totalSupplyRaw, balRaw] = await Promise.all([
        p.getReserves(),
        p.token0(),
        p.totalSupply(),
        account ? p.balanceOf(account).catch(() => 0n) : Promise.resolve(null),
      ]);
      const reserves = sanitizeReserves(reservesRaw);
      const token0 = sanitizeAddressResponse(token0Raw);
      if (!reserves || !token0) throw new Error("Could not read pair state");
      const aIsToken0 = aAddr.toLowerCase() === token0.toLowerCase();
      const lpTotalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
      const bal = balRaw === null ? null : typeof balRaw === "bigint" ? balRaw : BigInt(balRaw ?? 0);
      return {
        pairAddress,
        token0: aIsToken0 ? aAddr : bAddr,
        token1: aIsToken0 ? bAddr : aAddr,
        reserve0: reserves.reserve0,
        reserve1: reserves.reserve1,
        lpTotalSupply,
        accountLpBalance: bal,
        source: "rpc",
      };
    },
  );
}

/**
 * Pair address for two UI tokens, or null when none exists. Registry hits are
 * free; misses go to the API, then to factory.getPair. Absorbs the result.
 */
export async function resolvePairAddress(tokenA: TokenInfo, tokenB: TokenInfo): Promise<string | null> {
  const aAddr = toPathAddress(tokenA);
  const bAddr = toPathAddress(tokenB);
  if (aAddr.toLowerCase() === bAddr.toLowerCase()) return null;
  const known = findPairRecord(aAddr, bAddr);
  if (known) return known.pairAddress;
  return (await lookupPair(tokenA, tokenB)).pairAddress;
}

/** Discover pairs among the known tokens: one API page when available, else the getPair loop. */
export async function discoverKnownPairs(): Promise<void> {
  await apiFirst(
    async (dexId) => {
      const res = await client().pools(dexId, { page: 1, sort: "liquidity" });
      recordSuccess(res.indexedBlock);
      res.items.forEach(absorbPool);
    },
    discoverKnownPairsRpc,
  );
}

/** Enumerate every pool of the active DEX (paged API), else walk the factory. */
export async function discoverAllFromFactory(limit = 200): Promise<void> {
  await apiFirst(
    async (dexId) => {
      let page = 1;
      let seen = 0;
      for (;;) {
        const res = await client().pools(dexId, { page, sort: "newest" });
        recordSuccess(res.indexedBlock);
        res.items.forEach(absorbPool);
        seen += res.items.length;
        if (page >= res.pageCount || res.items.length === 0 || seen >= limit) break;
        page++;
      }
    },
    () => discoverAllFromFactoryRpc(limit),
  );
}

// ---------- token facts ----------

/**
 * Sanitized token facts. API: identity from the explorer (`identityKnown`),
 * pairCount and fee-on-transfer evidence for the active DEX; decimals from the
 * token list when the API has none. RPC: name/symbol/decimals from the contract.
 * Throws `not-found`-mapped null when the token has no pair on the DEX and no
 * RPC is available.
 */
export async function getTokenFacts(address: string): Promise<TokenFactsView | null> {
  const safe = sanitizeAddress(address);
  if (!safe) return null;
  try {
    return await apiFirst<TokenFactsView>(
      async (dexId) => {
        const f = await client().token(dexId, safe);
        recordSuccess();
        return {
          address: safe,
          symbol: f.symbol,
          name: f.name,
          decimals: f.decimals ?? knownDecimals(safe),
          identityKnown: f.identityKnown,
          feeOnTransfer: f.feeOnTransfer,
          pairCount: f.pairCount,
          source: "api" as const,
        };
      },
      async () => {
        const meta = await readTokenMetadata(safe);
        return {
          address: safe,
          symbol: meta.symbol,
          name: meta.name,
          decimals: meta.decimals,
          identityKnown: true,
          feeOnTransfer: false,
          pairCount: getRegistry().filter((r) => r.token0.address.toLowerCase() === safe.toLowerCase() || r.token1.address.toLowerCase() === safe.toLowerCase()).length,
          source: "rpc" as const,
        };
      },
    );
  } catch (err) {
    if (err instanceof SwapApiError && err.kind === "not-found") return null;
    throw err;
  }
}

/**
 * Token metadata for import flows: API identity when known, completed with
 * decimals from RPC when a wallet is connected. Returns null when the token
 * cannot be described well enough to import (unknown identity or decimals).
 */
export async function tokenMetadataForImport(address: string): Promise<TokenMetadata | null> {
  const safe = sanitizeAddress(address);
  if (!safe) return null;
  if (walletStore.get().status === "connected") {
    try {
      return await readTokenMetadata(safe);
    } catch {
      /* fall through to the API */
    }
  }
  const facts = await getTokenFacts(safe).catch(() => null);
  if (!facts || !facts.identityKnown || facts.decimals === null) return null;
  return { address: safe, name: facts.name || "Unknown Token", symbol: facts.symbol || "TKN", decimals: facts.decimals };
}

/**
 * Refresh the approved built-in tokens' name/symbol (and decimals when the
 * explorer decoded them) from the Swap Read API. No-op when the API is
 * unavailable; a token without a pair on the active DEX (404) keeps its
 * hardcoded values. The chain read (refreshApprovedTokenMetadata) runs after
 * this when a wallet is connected, so on-chain values still win.
 */
export async function refreshApprovedTokenFacts(): Promise<void> {
  if (!apiAvailable()) return;
  let changed = false;
  await Promise.all(
    APPROVED_TOKENS.map(async (t) => {
      const facts = await getTokenFacts(t.address).catch(() => null);
      if (!facts || facts.source !== "api" || !facts.identityKnown) return;
      if (applyApprovedTokenMetadata(t, { name: facts.name, symbol: facts.symbol, decimals: facts.decimals })) changed = true;
    }),
  );
  if (changed) notifyTokenMetadataChanged();
}

/** One page of tokens indexed on the active DEX (API only; empty when unavailable). */
export async function listIndexedTokens(page = 1): Promise<{ items: TokenFactsView[]; page: number; pageCount: number; totalItems: number }> {
  if (!apiAvailable() && !(await maybeReprobe())) return { items: [], page: 1, pageCount: 0, totalItems: 0 };
  const dexId = marketStore.get().dexId as string;
  try {
    const res = await client().tokens(dexId, page);
    recordSuccess(res.indexedBlock);
    return {
      items: res.items.map((f) => ({
        address: f.address,
        symbol: f.symbol,
        name: f.name,
        decimals: f.decimals ?? knownDecimals(f.address),
        identityKnown: f.identityKnown,
        feeOnTransfer: f.feeOnTransfer,
        pairCount: f.pairCount,
        source: "api" as const,
      })),
      page: res.page,
      pageCount: res.pageCount,
      totalItems: res.totalItems,
    };
  } catch (err) {
    recordFailure(err);
    return { items: [], page: 1, pageCount: 0, totalItems: 0 };
  }
}

// ---------- positions ----------

/** An account's LP positions on the active DEX (API), else the registry balanceOf scan (RPC). */
export async function getPositions(account: string): Promise<{ items: PositionView[]; capped: boolean; source: "api" | "rpc" }> {
  return apiFirst<{ items: PositionView[]; capped: boolean; source: "api" | "rpc" }>(
    async (dexId) => {
      const res = await client().positions(dexId, account);
      recordSuccess(res.indexedBlock);
      const items: PositionView[] = res.items
        .filter((p) => p.lpBalance > 0n)
        .map((p) => {
          const view = absorbPool(p);
          return { record: view.record, lpBalance: p.lpBalance, reserve0: p.reserve0, reserve1: p.reserve1, totalSupply: p.lpTotalSupply };
        });
      return { items, capped: res.capped, source: "api" as const };
    },
    async () => {
      try {
        await discoverKnownPairsRpc();
      } catch {
        /* continue with whatever is in the registry */
      }
      const items: PositionView[] = [];
      for (const record of getRegistry()) {
        try {
          const p = pairContract(record.pairAddress);
          const balRaw = await p.balanceOf(account);
          const lpBalance = typeof balRaw === "bigint" ? balRaw : BigInt(balRaw ?? 0);
          if (lpBalance <= 0n) continue;
          const [reservesRaw, totalSupplyRaw] = await Promise.all([p.getReserves(), p.totalSupply()]);
          const reserves = sanitizeReserves(reservesRaw);
          const totalSupply = typeof totalSupplyRaw === "bigint" ? totalSupplyRaw : BigInt(totalSupplyRaw ?? 0);
          if (!reserves || totalSupply <= 0n) continue;
          items.push({ record, lpBalance, reserve0: reserves.reserve0, reserve1: reserves.reserve1, totalSupply });
        } catch {
          /* skip unreadable pair */
        }
      }
      return { items, capped: false, source: "rpc" as const };
    },
  );
}

/** Pools an account created on the active DEX (API only; empty when unavailable). */
export async function getPairsCreated(account: string, page = 1): Promise<PoolPage> {
  if (!apiAvailable() && !(await maybeReprobe())) return { items: [], page: 1, pageCount: 0, totalItems: 0, source: "rpc" };
  const dexId = marketStore.get().dexId as string;
  try {
    const res = await client().pairsCreated(dexId, account, page);
    recordSuccess(res.indexedBlock);
    return { items: res.items.map(absorbPool), page: res.page, pageCount: res.pageCount, totalItems: res.totalItems, source: "api" };
  } catch (err) {
    recordFailure(err);
    return { items: [], page: 1, pageCount: 0, totalItems: 0, source: "rpc" };
  }
}

// ---------- routes ----------

const ROUTE_MEMO_TTL_MS = 15_000;
const routeMemo = new Map<string, { at: number; value: ApiRouteResponse }>();

/**
 * Candidate paths (with reserves) from → to on the active DEX, or null when
 * the API is unavailable (the caller falls back to its own path search).
 * Memoised briefly per dexId + pair.
 */
export async function getRoutes(from: string, to: string, k = 3): Promise<ApiRouteResponse | null> {
  if (!apiAvailable() && !(await maybeReprobe())) return null;
  const dexId = marketStore.get().dexId as string;
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  const key = `${dexId}|${a}|${b}|${k}`;
  const hit = routeMemo.get(key);
  if (hit && now() - hit.at < ROUTE_MEMO_TTL_MS) return hit.value;
  try {
    const res = await client().route(dexId, a, b, k);
    recordSuccess(res.indexedBlock);
    if (routeMemo.size > 500) routeMemo.clear();
    routeMemo.set(key, { at: now(), value: res });
    return res;
  } catch (err) {
    if (err instanceof SwapApiError && err.kind === "unknown-dex") {
      marketStore.update((s) => ({ ...s, status: "no-dex", dexId: null }));
    } else {
      recordFailure(err);
    }
    return null;
  }
}

/** Live per-DEX status line for the releases page (null when unavailable). */
export async function getDexStatus(): Promise<{ pairs: number; activePairs: number; tokens: number; indexedBlock: number; lagBlocks: number } | null> {
  if (!apiAvailable() && !(await maybeReprobe())) return null;
  const dexId = marketStore.get().dexId as string;
  try {
    const s = await client().status(dexId);
    recordSuccess(s.indexedBlock);
    return { pairs: s.pairs, activePairs: s.activePairs, tokens: s.tokens, indexedBlock: s.indexedBlock, lagBlocks: s.lagBlocks };
  } catch (err) {
    recordFailure(err);
    return null;
  }
}

/** Helper for views: WQ-side TVL of a pool in Q base units, or null when the pool has no WQ side. */
export function poolTvlQ(view: PoolView): bigint | null {
  const wq = wqAddress().toLowerCase();
  if (view.record.token0.address.toLowerCase() === wq) return view.reserve0 * 2n;
  if (view.record.token1.address.toLowerCase() === wq) return view.reserve1 * 2n;
  return null;
}

/** True when a pair address is the zero address (no pair). */
export function isZeroPair(address: string | null): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS_32.toLowerCase();
}

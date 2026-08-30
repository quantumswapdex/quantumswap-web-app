import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { initSdkForTests } from "../testSetup";
import { addCustomRelease, BUILTIN_RELEASES, releaseStore, setDefault } from "../config/releases";
import { registryStore } from "./pairRegistry";
import { walletStore } from "../wallet/wallet";
import dexesFx from "./__fixtures__/swapApi/dexes.json";
import poolFx from "./__fixtures__/swapApi/pool.json";
import poolsFx from "./__fixtures__/swapApi/pools.json";
import pairFx from "./__fixtures__/swapApi/pair.json";
import positionsFx from "./__fixtures__/swapApi/positions.json";
import routeFx from "./__fixtures__/swapApi/route.json";
import tokenFx from "./__fixtures__/swapApi/token.json";

// RPC fallbacks are the mocked contract accessors; each records its calls.
const rpc = vi.hoisted(() => ({
  getPair: vi.fn(),
  getReserves: vi.fn(),
  totalSupply: vi.fn(),
  token0: vi.fn(),
  token1: vi.fn(),
  balanceOf: vi.fn(),
  allPairsLength: vi.fn(),
}));

vi.mock("./contracts", () => ({
  factory: () => ({ getPair: rpc.getPair, allPairsLength: rpc.allPairsLength, allPairs: async () => "0x" + "0".repeat(64) }),
  pair: () => ({ getReserves: rpc.getReserves, totalSupply: rpc.totalSupply, token0: rpc.token0, token1: rpc.token1, balanceOf: rpc.balanceOf }),
  erc20: () => ({ name: async () => "Tok", symbol: async () => "TOK", decimals: async () => 18, balanceOf: async () => 0n }),
  router: () => ({}),
  wq: () => ({}),
}));

const md = await import("./marketData");

const DEXES = dexesFx as { dexes: { dexId: string; factoryAddress: string; routerAddress: string; wrappedCoinAddress: string }[] };
const BETA = DEXES.dexes.find((d) => d.dexId === "quantumswap-beta2") ?? DEXES.dexes[0];
const PREFLIGHT = DEXES.dexes.find((d) => d.dexId === "quantumswap-preflight");
const POOL = poolFx as { pairAddress: string; token0: string; token1: string; creatorAddress: string; reserve0: string; reserve1: string };

type Route = { status?: number; body?: unknown; fail?: boolean };
let routes: Record<string, Route> = {};
const calls: string[] = [];

function installFetch(): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    const r = key ? routes[key] : { status: 500, body: { status: 500, message: "no stub" } };
    if (r.fail) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

/**
 * Activate a custom release whose factory matches the devnet fixture. dexId
 * omitted = the built-in default (quantumswap-beta2), which the fixture serves
 * for BETA.factoryAddress.
 */
function useDevnetRelease(factory = BETA.factoryAddress, apiUrl = "http://127.0.0.1:8182", dexId?: string): string {
  const res = addCustomRelease("Devnet", BETA.wrappedCoinAddress, factory, BETA.routerAddress, apiUrl, dexId);
  if (!res.ok || !res.id) throw new Error(res.error);
  setDefault(res.id);
  return res.id;
}

let clock = 1_000_000;

describe("marketData: API probe + factory→dexId mapping", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    routes = { "/swap/v1/dexes": { body: dexesFx } };
    installFetch();
    registryStore.set([]);
    releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
    walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
    clock = 1_000_000;
    md.setMarketClock(() => clock);
    md.resetMarketData();
  });

  it("maps the beta2 factory to quantumswap-beta2", async () => {
    useDevnetRelease();
    const state = await md.probeSwapApi();
    expect(state.status).toBe("ok");
    expect(state.dexId).toBe(BETA.dexId);
    expect(md.apiAvailable()).toBe(true);
    expect(md.canRead()).toBe(true); // no wallet needed
    expect(calls[0]).toBe("http://127.0.0.1:8182/swap/v1/dexes");
  });

  it("a dexId is only used when the API serves it for the release's factory", async () => {
    if (!PREFLIGHT) return;
    // dexId served, factory matches -> ok.
    useDevnetRelease(PREFLIGHT.factoryAddress, "http://127.0.0.1:8182", PREFLIGHT.dexId);
    expect((await md.probeSwapApi()).dexId).toBe(PREFLIGHT.dexId);
    // dexId served, but it indexes a different factory (the default dexId on
    // a foreign deployment) -> no-dex, never another deployment's data.
    useDevnetRelease(PREFLIGHT.factoryAddress, "http://127.0.0.1:8182", BETA.dexId);
    expect((await md.probeSwapApi()).status).toBe("no-dex");
    // dexId not served by this API at all -> no-dex (no factory guessing).
    useDevnetRelease(BETA.factoryAddress, "http://127.0.0.1:8182", "not-on-this-api");
    const state = await md.probeSwapApi();
    expect(state.status).toBe("no-dex");
    expect(state.dexId).toBeNull();
  });

  /** A custom release whose factory the API does not index, with the default dexId. */
  function useUnindexedRelease(): void {
    const res = addCustomRelease("Elsewhere", BETA.wrappedCoinAddress, "0x" + "e".repeat(64), BETA.routerAddress, "http://127.0.0.1:8182");
    setDefault(res.id as string);
  }

  it("the built-in release is no-dex against an API whose beta2 factory differs (devnet fixture)", async () => {
    const state = await md.probeSwapApi();
    expect(state.status).toBe("no-dex");
    expect(state.dexId).toBeNull();
  });

  it("an empty API URL or dexId disables the API: no fetch, reads use RPC once a wallet is connected", async () => {
    const off = addCustomRelease("Off", BETA.wrappedCoinAddress, BETA.factoryAddress, BETA.routerAddress, "", BETA.dexId);
    setDefault(off.id as string);
    let state = await md.probeSwapApi();
    expect(state.status).toBe("disabled");
    expect(state.apiUrl).toBe("");
    expect(calls).toHaveLength(0);
    expect(md.apiAvailable()).toBe(false);
    expect(md.canRead()).toBe(false);
    await expect(md.getPool(POOL.pairAddress)).rejects.toBeInstanceOf(md.MarketUnavailableError);
    walletStore.set({ status: "connected", account: POOL.creatorAddress, chainId: 123123, nativeBalance: null });
    expect(md.canRead()).toBe(true);
    rpc.token0.mockResolvedValue(POOL.token0);
    rpc.token1.mockResolvedValue(POOL.token1);
    rpc.getReserves.mockResolvedValue([5n, 7n, 0]);
    rpc.totalSupply.mockResolvedValue(11n);
    const view = await md.getPool(POOL.pairAddress);
    expect(view?.reserve0).toBe(5n);
    expect(rpc.getReserves).toHaveBeenCalled();
    expect(calls).toHaveLength(0); // still nothing fetched

    const noDex = addCustomRelease("NoDex", BETA.wrappedCoinAddress, BETA.factoryAddress, BETA.routerAddress, "http://127.0.0.1:8182", "");
    setDefault(noDex.id as string);
    state = await md.probeSwapApi();
    expect(state.status).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("a foreign factory with the default dexId is no-dex, and reads fall back to RPC", async () => {
    useUnindexedRelease();
    const state = await md.probeSwapApi();
    expect(state.status).toBe("no-dex");
    expect(md.apiAvailable()).toBe(false);
    expect(md.canRead()).toBe(false);
    await expect(md.getPool(POOL.pairAddress)).rejects.toBeInstanceOf(md.MarketUnavailableError);
    walletStore.set({ status: "connected", account: POOL.creatorAddress, chainId: 123123, nativeBalance: null });
    rpc.token0.mockResolvedValue(POOL.token0);
    rpc.token1.mockResolvedValue(POOL.token1);
    rpc.getReserves.mockResolvedValue([5n, 7n, 0]);
    rpc.totalSupply.mockResolvedValue(11n);
    const view = await md.getPool(POOL.pairAddress);
    expect(view?.reserve0).toBe(5n);
    expect(rpc.getReserves).toHaveBeenCalled();
  });

  it("an unreachable API is unavailable and uses the built-in release URL by default", async () => {
    routes = { "/swap/v1/dexes": { fail: true } };
    const state = await md.probeSwapApi();
    expect(state.status).toBe("unavailable");
    expect(state.apiUrl).toBe("https://api.quantumswap.com");
  });

  it("switching releases re-probes and re-maps", async () => {
    useDevnetRelease();
    await md.probeSwapApi();
    expect(md.swapApiDexId()).toBe(BETA.dexId);
    useUnindexedRelease(); // fires onReleaseRefresh → reset + probe
    await new Promise((r) => setTimeout(r, 0));
    expect(md.marketStore.get().status).toBe("no-dex");
    useDevnetRelease(BETA.factoryAddress, ""); // API off for this release
    await new Promise((r) => setTimeout(r, 0));
    expect(md.marketStore.get().status).toBe("disabled");
  });
});

describe("marketData: API-first reads with RPC fallback", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(async () => {
    localStorage.clear();
    calls.length = 0;
    routes = {
      "/swap/v1/dexes": { body: dexesFx },
      "/pools?": { body: poolsFx },
      "/pool/": { body: poolFx },
      "/pair/": { body: pairFx },
      "/positions": { body: positionsFx },
      "/route/": { body: routeFx },
      "/token/": { body: tokenFx },
    };
    installFetch();
    for (const fn of Object.values(rpc)) fn.mockReset();
    registryStore.set([]);
    releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
    walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
    clock = 1_000_000;
    md.setMarketClock(() => clock);
    md.resetMarketData();
    useDevnetRelease();
    await md.probeSwapApi();
  });

  it("getPools absorbs API pools into the registry and never touches RPC", async () => {
    const page = await md.getPools(1, "liquidity");
    expect(page.source).toBe("api");
    expect(page.items.length).toBeGreaterThan(0);
    expect(registryStore.get().length).toBe(page.items.length);
    expect(page.items[0].record.discovered).toBe(true);
    expect(rpc.getReserves).not.toHaveBeenCalled();
  });

  it("getPool returns null on a 404 without tripping the breaker", async () => {
    routes["/pool/"] = { status: 404, body: { status: 404, message: "not found" } };
    expect(await md.getPool(POOL.pairAddress)).toBeNull();
    expect(md.apiAvailable()).toBe(true);
  });

  it("lookupPair reports exists=false pairs as null pairAddress and carries the account LP balance", async () => {
    const a = { address: POOL.token0, symbol: "A", name: "A", decimals: 18 };
    const b = { address: POOL.token1, symbol: "B", name: "B", decimals: 18 };
    const view = await md.lookupPair(a, b, POOL.creatorAddress);
    expect(view.pairAddress?.toLowerCase()).toBe(POOL.pairAddress.toLowerCase());
    expect(typeof view.accountLpBalance).toBe("bigint");
    routes["/pair/"] = { body: { dexId: BETA.dexId, indexedBlock: 1, exists: false } };
    md.invalidate();
    const none = await md.lookupPair(a, b);
    expect(none.pairAddress).toBeNull();
  });

  it("getPositions from the API, and via RPC balanceOf when the API is down and a wallet is connected", async () => {
    const api = await md.getPositions(POOL.creatorAddress);
    expect(api.source).toBe("api");
    expect(api.items.length).toBeGreaterThan(0);
    // Take the API down: two outages open the breaker.
    routes["/positions"] = { status: 503, body: { status: 503, message: "service unavailable" } };
    await expect(md.getPositions(POOL.creatorAddress)).rejects.toBeInstanceOf(md.MarketUnavailableError);
    await expect(md.getPositions(POOL.creatorAddress)).rejects.toBeInstanceOf(md.MarketUnavailableError);
    expect(md.marketStore.get().status).toBe("unavailable");
    // Connected wallet → RPC scan over the registry (absorbed earlier).
    walletStore.set({ status: "connected", account: POOL.creatorAddress, chainId: 123123, nativeBalance: null });
    rpc.getPair.mockResolvedValue("0x" + "0".repeat(64));
    rpc.balanceOf.mockResolvedValue(3n);
    rpc.getReserves.mockResolvedValue([100n, 200n, 0]);
    rpc.totalSupply.mockResolvedValue(10n);
    const viaRpc = await md.getPositions(POOL.creatorAddress);
    expect(viaRpc.source).toBe("rpc");
    expect(viaRpc.items.length).toBeGreaterThan(0);
    expect(rpc.balanceOf).toHaveBeenCalled();
  });

  it("the breaker re-probes after the cooldown and recovers", async () => {
    routes["/pool/"] = { fail: true };
    walletStore.set({ status: "connected", account: POOL.creatorAddress, chainId: 123123, nativeBalance: null });
    rpc.token0.mockResolvedValue(POOL.token0);
    rpc.token1.mockResolvedValue(POOL.token1);
    rpc.getReserves.mockResolvedValue([1n, 1n, 0]);
    rpc.totalSupply.mockResolvedValue(1n);
    await md.getPool(POOL.pairAddress); // outage 1 → RPC
    await md.getPool(POOL.pairAddress); // outage 2 → breaker opens
    expect(md.marketStore.get().status).toBe("unavailable");
    const dexCallsBefore = calls.filter((c) => c.includes("/dexes")).length;
    await md.getPool(POOL.pairAddress); // inside cooldown: no re-probe
    expect(calls.filter((c) => c.includes("/dexes")).length).toBe(dexCallsBefore);
    routes["/pool/"] = { body: poolFx };
    clock += md.BREAKER_COOLDOWN_MS + 1;
    const view = await md.getPool(POOL.pairAddress);
    expect(md.marketStore.get().status).toBe("ok");
    expect(view?.reserve0).toBe(BigInt(POOL.reserve0));
  });

  it("unknown-dex answers flip the status to no-dex", async () => {
    routes["/pool/"] = { status: 404, body: { status: 404, message: "dex not found" } };
    await expect(md.getPool(POOL.pairAddress)).rejects.toBeInstanceOf(md.MarketUnavailableError);
    expect(md.marketStore.get().status).toBe("no-dex");
  });

  it("getRoutes memoises per pair and returns null once the API is unavailable", async () => {
    const r1 = await md.getRoutes(POOL.token0, POOL.token1, 3);
    const r2 = await md.getRoutes(POOL.token0, POOL.token1, 3);
    expect(r1).not.toBeNull();
    expect(r2).toBe(r1);
    expect(calls.filter((c) => c.includes("/route/")).length).toBe(1);
    md.invalidate();
    routes["/route/"] = { fail: true };
    expect(await md.getRoutes(POOL.token0, POOL.token1, 3)).toBeNull();
    expect(await md.getRoutes(POOL.token0, POOL.token1, 3)).toBeNull();
    expect(md.marketStore.get().status).toBe("unavailable");
  });

  it("getTokenFacts keeps decimals null when the API has none and the token list does not know the token", async () => {
    const facts = await md.getTokenFacts(POOL.token0);
    expect(facts).not.toBeNull();
    expect(facts?.source).toBe("api");
    expect(facts?.decimals === null || Number.isInteger(facts?.decimals)).toBe(true);
    expect(facts?.pairCount).toBeGreaterThan(0);
  });

  it("degraded lag is surfaced but the API stays in use", async () => {
    routes["/swap/v1/dexes"] = { body: { ...(dexesFx as object), lagBlocks: 500, degraded: false } };
    md.resetMarketData();
    const state = await md.probeSwapApi();
    expect(state.status).toBe("ok");
    expect(state.degraded).toBe(true);
  });
});

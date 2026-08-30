import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { initSdkForTests } from "../testSetup";
import type { TokenInfo } from "../config/chain";
import { BUILTIN_RELEASES, releaseStore } from "../config/releases";
import { registryStore } from "./pairRegistry";
import { tokenStore } from "../tokens/tokenList";
import { walletStore } from "../wallet/wallet";
import { parseRoute, type ApiRouteResponse } from "./swapApi";
import routeFx from "./__fixtures__/swapApi/route.json";
import { getAmountIn, getAmountOut } from "./quoteMath";

// The market-data facade is mocked: `getRoutes` returns whatever the test
// installs (null = API unavailable), so the finder's API branch is exercised
// without HTTP. The router mock records whether the chain quote was used.
const mocks = vi.hoisted(() => ({
  routes: null as unknown,
  routerOut: null as ((amountIn: bigint, path: string[]) => Promise<bigint[]>) | null,
  routerIn: null as ((amountOut: bigint, path: string[]) => Promise<bigint[]>) | null,
  routerCalls: 0,
  getPairCalls: 0,
}));

vi.mock("./marketData", () => ({
  getRoutes: async () => mocks.routes,
  invalidate: () => {},
}));

vi.mock("./contracts", () => ({
  router: () => ({
    getAmountsOut: async (amountIn: bigint, path: string[]) => {
      mocks.routerCalls++;
      if (!mocks.routerOut) throw new Error("router unavailable");
      return mocks.routerOut(amountIn, path);
    },
    getAmountsIn: async (amountOut: bigint, path: string[]) => {
      mocks.routerCalls++;
      if (!mocks.routerIn) throw new Error("router unavailable");
      return mocks.routerIn(amountOut, path);
    },
  }),
  factory: () => ({
    getPair: async () => {
      mocks.getPairCalls++;
      return "0x" + "0".repeat(64);
    },
  }),
}));

const { findBestRoute, findBestRouteExactOut, InsufficientLiquidityError } = await import("./routeFinder");

const api: ApiRouteResponse = parseRoute(routeFx);
const FROM: TokenInfo = { address: api.fromToken, symbol: "LIO", name: "Lio", decimals: 18 };
const TO: TokenInfo = { address: api.toToken, symbol: "TIG", name: "Tiger", decimals: 18 };

/** Expected local output for a candidate path (chained constant-product). */
function localOut(amountIn: bigint, path: ApiRouteResponse["paths"][number]): bigint | null {
  let amount = amountIn;
  for (const hop of path.hops) {
    const r = api.pairs[hop.pairAddress];
    const inIs0 = r.token0 === hop.tokenIn;
    const reserveIn = inIs0 ? r.reserve0 : r.reserve1;
    const reserveOut = inIs0 ? r.reserve1 : r.reserve0;
    if (reserveIn <= 0n || reserveOut <= 0n) return null;
    amount = getAmountOut(amount, reserveIn, reserveOut);
  }
  return amount;
}

describe("findBestRoute with Swap Read API candidates", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(() => {
    registryStore.set([]);
    tokenStore.set([]);
    releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
    walletStore.set({ status: "disconnected", account: null, chainId: null, nativeBalance: null });
    mocks.routes = api;
    mocks.routerOut = null;
    mocks.routerIn = null;
    mocks.routerCalls = 0;
    mocks.getPairCalls = 0;
  });

  it("picks the candidate with the best local output and labels it an estimate without a wallet", async () => {
    const amountIn = 10n ** 18n;
    const route = await findBestRoute(amountIn, FROM, TO, 5);
    expect(route).not.toBeNull();
    expect(route!.source).toBe("api-estimate");
    expect(route!.indexedBlock).toBe(api.indexedBlock);
    // The chosen path yields the maximum over all API candidates.
    const outs = api.paths.map((p) => localOut(amountIn, p)).filter((o): o is bigint => o !== null);
    expect(route!.out).toBe(outs.reduce((m, o) => (o > m ? o : m), 0n));
    expect(route!.path[0]).toBe(api.fromToken);
    expect(route!.path[route!.path.length - 1]).toBe(api.toToken);
    // No pair-existence fan-out and no router call happened.
    expect(mocks.getPairCalls).toBe(0);
    expect(mocks.routerCalls).toBe(0);
  });

  it("uses the router quote on the API-chosen path when a wallet is connected", async () => {
    walletStore.set({ status: "connected", account: "0x" + "1".repeat(64), chainId: 123123, nativeBalance: null });
    mocks.routerOut = async (amountIn, path) => [amountIn, ...path.slice(1).map((_, i) => amountIn / BigInt(i + 2))];
    const route = await findBestRoute(1000n, FROM, TO, 5);
    expect(route!.source).toBe("router");
    expect(mocks.routerCalls).toBe(1);
    expect(route!.out).toBe(1000n / BigInt(route!.path.length));
    expect(mocks.getPairCalls).toBe(0);
  });

  it("keeps the estimate when the wallet is connected but the router call fails", async () => {
    walletStore.set({ status: "connected", account: "0x" + "1".repeat(64), chainId: 123123, nativeBalance: null });
    mocks.routerOut = null; // throws
    const route = await findBestRoute(1000n, FROM, TO, 5);
    expect(route!.source).toBe("api-estimate");
    expect(mocks.routerCalls).toBe(1);
  });

  it("returns null when the API has no liquid path", async () => {
    mocks.routes = { ...api, paths: [] };
    expect(await findBestRoute(1000n, FROM, TO, 5)).toBeNull();
  });

  it("throws InsufficientLiquidityError when every candidate is drained", async () => {
    const drained: ApiRouteResponse = {
      ...api,
      pairs: Object.fromEntries(Object.entries(api.pairs).map(([k, r]) => [k, { ...r, reserve0: 0n, reserve1: 0n }])),
    };
    mocks.routes = drained;
    await expect(findBestRoute(1000n, FROM, TO, 5)).rejects.toBeInstanceOf(InsufficientLiquidityError);
  });

  it("respects maxTokens by dropping longer candidates", async () => {
    const route = await findBestRoute(1000n, FROM, TO, 2);
    if (api.paths.some((p) => p.hops.length === 1)) {
      expect(route!.path).toHaveLength(2);
    } else {
      expect(route).toBeNull();
    }
  });

  it("exact-out: local math over reserves, router when connected, insufficient when amountOut >= reserves", async () => {
    const amountOut = 10n ** 18n;
    const est = await findBestRouteExactOut(amountOut, FROM, TO, 5);
    expect(est!.source).toBe("api-estimate");
    // Sanity: the estimate is consistent with the forward formula on a direct path.
    const direct = api.paths.find((p) => p.hops.length === 1);
    if (direct) {
      const r = api.pairs[direct.hops[0].pairAddress];
      const inIs0 = r.token0 === api.fromToken;
      const reserveIn = inIs0 ? r.reserve0 : r.reserve1;
      const reserveOut = inIs0 ? r.reserve1 : r.reserve0;
      expect(est!.amountIn <= getAmountIn(amountOut, reserveIn, reserveOut)).toBe(true);
    }
    walletStore.set({ status: "connected", account: "0x" + "1".repeat(64), chainId: 123123, nativeBalance: null });
    mocks.routerIn = async (out, path) => [out * 2n, ...path.slice(1).map(() => out)];
    const chain = await findBestRouteExactOut(amountOut, FROM, TO, 5);
    expect(chain!.source).toBe("router");
    expect(chain!.amountIn).toBe(amountOut * 2n);
    // Asking for more than any pool holds is insufficient liquidity, not "no route".
    const huge = Object.values(api.pairs).reduce((m, r) => (r.reserve0 + r.reserve1 > m ? r.reserve0 + r.reserve1 : m), 0n) * 10n;
    await expect(findBestRouteExactOut(huge, FROM, TO, 5)).rejects.toBeInstanceOf(InsufficientLiquidityError);
  });

  it("falls back to the RPC pair-existence search when the API is unavailable", async () => {
    mocks.routes = null;
    walletStore.set({ status: "connected", account: "0x" + "1".repeat(64), chainId: 123123, nativeBalance: null });
    const route = await findBestRoute(1000n, FROM, TO, 5);
    expect(route).toBeNull(); // factory mock knows no pairs
    expect(mocks.getPairCalls).toBeGreaterThan(0);
  });
});

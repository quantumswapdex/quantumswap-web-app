import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { initSdkForTests } from "../testSetup";
import { WQ_ADDRESS, type TokenInfo } from "../config/chain";
import { addCustomRelease, BUILTIN_RELEASES, releaseStore, setDefault, wqAddress } from "../config/releases";
import { mergePair, registryStore } from "./pairRegistry";
import { importToken, tokenStore } from "../tokens/tokenList";

const HEI = "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d";
const Y2Q = "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7";
const T1 = "0x" + "1".repeat(64);
const T2 = "0x" + "2".repeat(64);
const FAKE_PAIR_ADDRESS = "0x" + "f".repeat(64);

// Simulated on-chain pools, keyed by a sorted, lowercased token pair.
const mocks = vi.hoisted(() => {
  const pools = new Set<string>();
  const poolKey = (a: string, b: string): string => [a.toLowerCase(), b.toLowerCase()].sort().join("|");
  return { pools, poolKey };
});

vi.mock("./contracts", () => ({
  router: () => ({
    getAmountsOut: async (amountIn: bigint, path: string[]): Promise<bigint[]> => {
      let amount = amountIn;
      const out: bigint[] = [amount];
      for (let i = 0; i < path.length - 1; i++) {
        if (!mocks.pools.has(mocks.poolKey(path[i], path[i + 1]))) {
          throw new Error("INSUFFICIENT_LIQUIDITY");
        }
        // 1:1 reserves with a 0.30% fee per hop.
        amount = (amount * 997n) / 1000n;
        out.push(amount);
      }
      return out;
    },
    getAmountsIn: async (amountOut: bigint, path: string[]): Promise<bigint[]> => {
      let amount = amountOut;
      const amounts: bigint[] = [amount];
      for (let i = path.length - 1; i > 0; i--) {
        if (!mocks.pools.has(mocks.poolKey(path[i - 1], path[i]))) {
          throw new Error("INSUFFICIENT_LIQUIDITY");
        }
        // Inverse of the 0.30% fee per hop, rounding up like the router.
        amount = (amount * 1000n) / 997n + 1n;
        amounts.unshift(amount);
      }
      return amounts;
    },
  }),
  factory: () => ({
    getPair: async (a: string, b: string): Promise<string> =>
      mocks.pools.has(mocks.poolKey(a, b)) ? FAKE_PAIR_ADDRESS : "0x" + "0".repeat(64),
  }),
}));

const { findBestRoute, findBestRouteExactOut, clearRouteCache, InsufficientLiquidityError } = await import("./routeFinder");

function setPools(pairs: [string, string][]): void {
  mocks.pools.clear();
  for (const [a, b] of pairs) mocks.pools.add(mocks.poolKey(a, b));
}

function pairRecord(pairAddr: string, t0: string, t1: string) {
  return {
    pairAddress: pairAddr,
    token0: { address: t0, symbol: "T0", decimals: 18 },
    token1: { address: t1, symbol: "T1", decimals: 18 },
    discovered: true,
  };
}

const HEI_TOKEN: TokenInfo = { address: HEI, symbol: "hei", name: "Heisen", decimals: 18 };
const Y2Q_TOKEN: TokenInfo = { address: Y2Q, symbol: "Y2Q", name: "Y2Q", decimals: 18 };

describe("findBestRoute", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(() => {
    registryStore.set([]);
    tokenStore.set([]);
    mocks.pools.clear();
    clearRouteCache();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
  });

  it("routes 2-hop via WQ when no direct pool exists", async () => {
    setPools([
      [HEI, wqAddress()],
      [Y2Q, wqAddress()],
    ]);
    mergePair(pairRecord("0x" + "p".repeat(64), HEI, wqAddress()));
    mergePair(pairRecord("0x" + "q".repeat(64), Y2Q, wqAddress()));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), wqAddress().toLowerCase(), Y2Q.toLowerCase()]);
    expect(route!.out).toBeGreaterThan(0n);
    // 2 hops => two 0.30% fee deductions.
    expect(route!.out).toBe(((1_000_000n * 997n) / 1000n) * 997n / 1000n);
  });

  it("returns null when no route of any length exists", async () => {
    setPools([]);
    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).toBeNull();
  });

  it("prefers the direct 1-hop route when the pool exists", async () => {
    setPools([[HEI, Y2Q]]);
    mergePair(pairRecord("0x" + "r".repeat(64), HEI, Y2Q));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), Y2Q.toLowerCase()]);
  });

  it("takes the direct pool even when the registry only knows a longer route", async () => {
    // Registry is cold for HEI-Y2Q but the pool exists on-chain: the
    // factory.getPair fallback must discover it and route direct.
    setPools([
      [HEI, Y2Q],
      [HEI, wqAddress()],
      [Y2Q, wqAddress()],
    ]);
    mergePair(pairRecord("0x" + "p".repeat(64), HEI, wqAddress()));
    mergePair(pairRecord("0x" + "q".repeat(64), Y2Q, wqAddress()));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), Y2Q.toLowerCase()]);
  });

  it("routes 2-hop via a non-WQ intermediate even with a cold registry", async () => {
    importToken({ address: T1, name: "T1", symbol: "TK1", decimals: 18 });
    // Pools HEI-T1 and T1-Y2Q exist, but NO WQ pools and an EMPTY registry.
    // Imported tokens are hop candidates, and factory.getPair (not the
    // registry) provides the pair-existence edges.
    setPools([
      [HEI, T1],
      [T1, Y2Q],
    ]);

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), T1.toLowerCase(), Y2Q.toLowerCase()]);
    // 2 hops => two 0.30% fee deductions.
    expect(route!.out).toBe(((1_000_000n * 997n) / 1000n) * 997n / 1000n);
  });

  it("routes a 4-hop (5-token) path when that is the only connection", async () => {
    importToken({ address: T1, name: "T1", symbol: "TK1", decimals: 18 });
    importToken({ address: T2, name: "T2", symbol: "TK2", decimals: 18 });
    // Chain HEI -> T1 -> WQ -> T2 -> Y2Q (5 tokens, 4 hops); no shorter path.
    setPools([
      [HEI, T1],
      [T1, wqAddress()],
      [wqAddress(), T2],
      [T2, Y2Q],
    ]);
    mergePair(pairRecord("0x" + "a".repeat(64), HEI, T1));
    mergePair(pairRecord("0x" + "b".repeat(64), T1, wqAddress()));
    mergePair(pairRecord("0x" + "c".repeat(64), wqAddress(), T2));
    mergePair(pairRecord("0x" + "d".repeat(64), T2, Y2Q));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([
      HEI.toLowerCase(),
      T1.toLowerCase(),
      wqAddress().toLowerCase(),
      T2.toLowerCase(),
      Y2Q.toLowerCase(),
    ]);
    // 4 hops => four 0.30% fee deductions.
    let expected = 1_000_000n;
    for (let i = 0; i < 4; i++) expected = (expected * 997n) / 1000n;
    expect(route!.out).toBe(expected);
  });

  it("picks the shortest route when both short and long routes exist", async () => {
    importToken({ address: T1, name: "T1", symbol: "TK1", decimals: 18 });
    importToken({ address: T2, name: "T2", symbol: "TK2", decimals: 18 });
    // Both HEI -> WQ -> Y2Q (2 hops) and HEI -> T1 -> T2 -> Y2Q (3 hops) exist.
    setPools([
      [HEI, wqAddress()],
      [wqAddress(), Y2Q],
      [HEI, T1],
      [T1, T2],
      [T2, Y2Q],
    ]);

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), wqAddress().toLowerCase(), Y2Q.toLowerCase()]);
  });

  it("throws InsufficientLiquidityError when the only structural route cannot be quoted", async () => {
    // The registry claims a HEI-Y2Q pair, but the router cannot quote it
    // (e.g. drained pool): findBestRoute must not return a broken route, and
    // must signal "not enough liquidity" rather than "no route".
    mergePair(pairRecord("0x" + "r".repeat(64), HEI, Y2Q));
    setPools([]);

    await expect(findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5)).rejects.toBeInstanceOf(InsufficientLiquidityError);
  });

  it("routes via the active release's WQ (custom release), not the original Beta 2 WQ", async () => {
    const WQ2 = "0x" + "9".repeat(64);
    const FAC2 = "0x" + "8".repeat(64);
    const ROUT2 = "0x" + "7".repeat(64);
    const res = addCustomRelease("Custom Hub", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);
    setDefault(res.id as string);

    // The active hub is now the custom WQ, not the Beta 2 WQ_ADDRESS.
    expect(wqAddress().toLowerCase()).toBe(WQ2.toLowerCase());

    setPools([
      [HEI, WQ2],
      [WQ2, Y2Q],
    ]);
    mergePair(pairRecord("0x" + "p".repeat(64), HEI, WQ2));
    mergePair(pairRecord("0x" + "q".repeat(64), WQ2, Y2Q));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), WQ2.toLowerCase(), Y2Q.toLowerCase()]);
    // The original Beta 2 WQ must not appear in the path.
    expect(route!.path).not.toContain(WQ_ADDRESS.toLowerCase());
  });

  it("exact-out: quotes the required input over the direct route", async () => {
    setPools([[HEI, Y2Q]]);
    mergePair(pairRecord("0x" + "r".repeat(64), HEI, Y2Q));

    const route = await findBestRouteExactOut(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), Y2Q.toLowerCase()]);
    // Inverse of one 0.30% fee hop, rounded up.
    expect(route!.amountIn).toBe((1_000_000n * 1000n) / 997n + 1n);
  });

  it("exact-out: routes 2-hop via WQ when no direct pool exists", async () => {
    setPools([
      [HEI, wqAddress()],
      [Y2Q, wqAddress()],
    ]);
    mergePair(pairRecord("0x" + "p".repeat(64), HEI, wqAddress()));
    mergePair(pairRecord("0x" + "q".repeat(64), Y2Q, wqAddress()));

    const route = await findBestRouteExactOut(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), wqAddress().toLowerCase(), Y2Q.toLowerCase()]);
    // Two inverse fee hops, each rounded up (applied back-to-front).
    const afterHop2 = (1_000_000n * 1000n) / 997n + 1n;
    expect(route!.amountIn).toBe((afterHop2 * 1000n) / 997n + 1n);
  });

  it("exact-out: returns null when no route exists", async () => {
    setPools([]);
    expect(await findBestRouteExactOut(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5)).toBeNull();
  });

  it("exact-out: throws InsufficientLiquidityError when the structural route cannot be quoted", async () => {
    // Registry claims a pair but the router reverts (drained / output >= reserves).
    mergePair(pairRecord("0x" + "r".repeat(64), HEI, Y2Q));
    setPools([]);
    await expect(findBestRouteExactOut(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5)).rejects.toBeInstanceOf(InsufficientLiquidityError);
  });

  it("caches negative getPair results within the TTL", async () => {
    setPools([]);
    expect(await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5)).toBeNull();
    // A pool appearing right after is not seen until the cache is cleared.
    setPools([[HEI, Y2Q]]);
    expect(await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5)).toBeNull();
    clearRouteCache();
    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), Y2Q.toLowerCase()]);
  });
});
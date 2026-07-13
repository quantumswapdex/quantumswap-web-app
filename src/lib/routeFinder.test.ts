import { describe, it, expect, beforeEach, vi } from "vitest";
import { WQ_ADDRESS, type TokenInfo } from "../config/chain";
import { mergePair, registryStore } from "./pairRegistry";
import { importToken, tokenStore } from "../tokens/tokenList";

const HEI = "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d";
const Y2Q = "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7";
const T1 = "0x" + "1".repeat(64);
const T2 = "0x" + "2".repeat(64);

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
  }),
}));

const { findBestRoute } = await import("./routeFinder");

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
  beforeEach(() => {
    registryStore.set([]);
    tokenStore.set([]);
    mocks.pools.clear();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("routes 2-hop via WQ when no direct pool exists", async () => {
    setPools([
      [HEI, WQ_ADDRESS],
      [Y2Q, WQ_ADDRESS],
    ]);
    mergePair(pairRecord("0x" + "p".repeat(64), HEI, WQ_ADDRESS));
    mergePair(pairRecord("0x" + "q".repeat(64), Y2Q, WQ_ADDRESS));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([HEI.toLowerCase(), WQ_ADDRESS.toLowerCase(), Y2Q.toLowerCase()]);
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

  it("routes 2-hop via a non-WQ intermediate even with a cold registry", async () => {
    importToken({ address: T1, name: "T1", symbol: "TK1", decimals: 18 });
    // Pools HEI-T1 and T1-Y2Q exist, but NO WQ pools and an EMPTY registry.
    // The old WQ-only baseline would miss this; brute-force 2-hop finds it.
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
      [T1, WQ_ADDRESS],
      [WQ_ADDRESS, T2],
      [T2, Y2Q],
    ]);
    mergePair(pairRecord("0x" + "a".repeat(64), HEI, T1));
    mergePair(pairRecord("0x" + "b".repeat(64), T1, WQ_ADDRESS));
    mergePair(pairRecord("0x" + "c".repeat(64), WQ_ADDRESS, T2));
    mergePair(pairRecord("0x" + "d".repeat(64), T2, Y2Q));

    const route = await findBestRoute(1_000_000n, HEI_TOKEN, Y2Q_TOKEN, 5);
    expect(route).not.toBeNull();
    expect(route!.path).toEqual([
      HEI.toLowerCase(),
      T1.toLowerCase(),
      WQ_ADDRESS.toLowerCase(),
      T2.toLowerCase(),
      Y2Q.toLowerCase(),
    ]);
    // 4 hops => four 0.30% fee deductions.
    let expected = 1_000_000n;
    for (let i = 0; i < 4; i++) expected = (expected * 997n) / 1000n;
    expect(route!.out).toBe(expected);
  });
});

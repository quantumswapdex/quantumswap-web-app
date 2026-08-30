import { describe, it, expect, vi } from "vitest";
import { createSwapApiClient, SwapApiError, parseDexList, parsePool, parseRoute, parseTokenFacts } from "./swapApi";
import dexesFx from "./__fixtures__/swapApi/dexes.json";
import statusFx from "./__fixtures__/swapApi/status.json";
import tokenFx from "./__fixtures__/swapApi/token.json";
import tokensFx from "./__fixtures__/swapApi/tokens.json";
import poolsFx from "./__fixtures__/swapApi/pools.json";
import poolFx from "./__fixtures__/swapApi/pool.json";
import routeFx from "./__fixtures__/swapApi/route.json";
import pairFx from "./__fixtures__/swapApi/pair.json";
import positionsFx from "./__fixtures__/swapApi/positions.json";
import pairsCreatedFx from "./__fixtures__/swapApi/pairs-created.json";

const DEX = (dexesFx as { dexes: { dexId: string }[] }).dexes[0].dexId;
const POOL = poolFx as { pairAddress: string; token0: string; token1: string; creatorAddress: string; reserve0: string };
const ADDR_RE = /^0x[0-9a-f]{64}$/;

/** fetch stub returning canned JSON bodies per URL substring. */
function stubFetch(routes: Record<string, { status?: number; body?: unknown; raw?: string; delayMs?: number }>) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response("{}", { status: 500 });
    const r = routes[key];
    if (r.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, r.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    const text = r.raw !== undefined ? r.raw : JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

function clientWith(routes: Parameters<typeof stubFetch>[0], timeoutMs = 4000) {
  const { fetchFn, calls } = stubFetch(routes);
  return { client: createSwapApiClient("http://127.0.0.1:8182/", { fetchFn, timeoutMs }), calls };
}

describe("swapApi client: all 10 operations parse their devnet fixtures", () => {
  it("dexes()", async () => {
    const { client, calls } = clientWith({ "/swap/v1/dexes": { body: dexesFx } });
    const res = await client.dexes();
    expect(calls[0]).toBe("http://127.0.0.1:8182/swap/v1/dexes");
    expect(res.dexes.length).toBeGreaterThan(0);
    expect(res.dexes[0].factoryAddress).toMatch(ADDR_RE);
    expect(typeof res.indexedBlock).toBe("number");
    expect(res.lagBlocks).toBeGreaterThanOrEqual(0);
  });

  it("status(dexId)", async () => {
    const { client } = clientWith({ "/status": { body: statusFx } });
    const res = await client.status(DEX);
    expect(res.dexId).toBe(DEX);
    expect(res.pairs).toBeGreaterThan(0);
    expect(res.activePairs).toBeLessThanOrEqual(res.pairs);
  });

  it("token(dexId, address) keeps decimals null when the explorer has none", async () => {
    const { client } = clientWith({ "/token/": { body: tokenFx } });
    const res = await client.token(DEX, POOL.token0);
    expect(res.address).toBe(POOL.token0.toLowerCase());
    expect(res.pairCount).toBeGreaterThan(0);
    expect(res.decimals === null || Number.isInteger(res.decimals)).toBe(true);
    if (res.identityKnown) expect(res.symbol.length).toBeGreaterThan(0);
  });

  it("tokens(dexId, page)", async () => {
    const { client, calls } = clientWith({ "/tokens?page=1": { body: tokensFx } });
    const res = await client.tokens(DEX, 1);
    expect(calls[0]).toContain("/tokens?page=1");
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.totalItems).toBeGreaterThanOrEqual(res.items.length);
  });

  it("pools(dexId, {sort, token}) parses reserves as bigint and lowercases addresses", async () => {
    const { client, calls } = clientWith({ "/pools?": { body: poolsFx } });
    const res = await client.pools(DEX, { page: 1, sort: "liquidity", token: POOL.token0.toUpperCase().replace("0X", "0x") });
    expect(calls[0]).toContain("sort=liquidity");
    expect(calls[0]).toContain(`token=${POOL.token0.toLowerCase()}`);
    expect(res.items.length).toBeGreaterThan(0);
    for (const p of res.items) {
      expect(typeof p.reserve0).toBe("bigint");
      expect(p.pairAddress).toMatch(ADDR_RE);
      expect(p.token0Facts.address).toBe(p.token0);
    }
  });

  it("pool(dexId, pair)", async () => {
    const { client } = clientWith({ "/pool/": { body: poolFx } });
    const res = await client.pool(DEX, POOL.pairAddress);
    expect(res.pairAddress).toBe(POOL.pairAddress.toLowerCase());
    expect(res.reserve0).toBe(BigInt(POOL.reserve0));
    expect(typeof res.lpTotalSupply).toBe("bigint");
    expect(res.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("route(dexId, from, to, k) links every hop to a pool in pairs", async () => {
    const { client, calls } = clientWith({ "/route/": { body: routeFx } });
    const res = await client.route(DEX, POOL.token0, POOL.token1, 9);
    expect(calls[0]).toContain("?k=5"); // clamped to the contract max
    expect(res.paths.length).toBeGreaterThan(0);
    for (const path of res.paths) {
      expect(path.hops[0].tokenIn).toBe(res.fromToken);
      expect(path.hops[path.hops.length - 1].tokenOut).toBe(res.toToken);
      for (const hop of path.hops) expect(res.pairs[hop.pairAddress]).toBeDefined();
    }
    expect(res.tokens[res.fromToken]).toBeDefined();
  });

  it("pair(dexId, a, b, account)", async () => {
    const { client, calls } = clientWith({ "/pair/": { body: pairFx } });
    const res = await client.pair(DEX, POOL.token0, POOL.token1, POOL.creatorAddress);
    expect(calls[0]).toContain(`?account=${POOL.creatorAddress.toLowerCase()}`);
    expect(res.exists).toBe(true);
    expect(res.pair?.pairAddress).toBe(POOL.pairAddress.toLowerCase());
    expect(typeof res.accountLpBalance).toBe("bigint");
  });

  it("positions(dexId, account)", async () => {
    const { client } = clientWith({ "/positions": { body: positionsFx } });
    const res = await client.positions(DEX, POOL.creatorAddress);
    expect(res.account).toBe(POOL.creatorAddress.toLowerCase());
    expect(res.items.length).toBeGreaterThan(0);
    for (const p of res.items) expect(p.lpBalance > 0n).toBe(true);
  });

  it("pairsCreated(dexId, account, page)", async () => {
    const { client } = clientWith({ "/pairs-created?page=1": { body: pairsCreatedFx } });
    const res = await client.pairsCreated(DEX, POOL.creatorAddress, 1);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0].creatorAddress).toBe(POOL.creatorAddress.toLowerCase());
  });
});

describe("swapApi client: malformed bodies are rejected (parse)", () => {
  const good = poolFx as Record<string, unknown>;

  it("missing reserve0", () => {
    const bad = { ...good };
    delete bad.reserve0;
    expect(() => parsePool(bad)).toThrow(SwapApiError);
    try {
      parsePool(bad);
    } catch (e) {
      expect((e as SwapApiError).kind).toBe("parse");
    }
  });

  it("non-hex quantity", () => {
    expect(() => parsePool({ ...good, lpTotalSupply: "lots" })).toThrow(/malformed/);
  });

  it("20-byte address", () => {
    expect(() => parsePool({ ...good, pairAddress: "0x" + "a".repeat(40) })).toThrow(/malformed/);
  });

  it("oversized symbol is truncated to 16 chars, not rejected", () => {
    const facts = parseTokenFacts({ ...(tokenFx as object), identityKnown: true, symbol: "X".repeat(40), name: "Y".repeat(100) });
    expect(facts.symbol).toHaveLength(16);
    expect(facts.name).toHaveLength(48);
  });

  it("identityKnown=false blanks symbol and name even when present", () => {
    const facts = parseTokenFacts({ ...(tokenFx as object), identityKnown: false, symbol: "SPOOF", name: "Spoof" });
    expect(facts.symbol).toBe("");
    expect(facts.name).toBe("");
  });

  it("route hop referencing a pool missing from pairs", () => {
    const r = JSON.parse(JSON.stringify(routeFx)) as { pairs: Record<string, unknown> };
    r.pairs = {};
    expect(() => parseRoute(r)).toThrow(/pair missing/);
  });

  it("dexes with a malformed dexId", () => {
    expect(() => parseDexList({ ...(dexesFx as object), dexes: [{ dexId: "bad id!", name: "x", factoryAddress: POOL.pairAddress, routerAddress: POOL.pairAddress, wrappedCoinAddress: POOL.pairAddress, feeBps: 30 }] })).toThrow(/dexId/);
  });
});

describe("swapApi client: transport errors map to SwapApiError kinds", () => {
  async function kindOf(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return "ok";
    } catch (e) {
      return e instanceof SwapApiError ? `${e.kind}:${e.status ?? ""}` : "other";
    }
  }

  it("400 → http (not an outage)", async () => {
    const { client } = clientWith({ "/pool/": { status: 400, body: { status: 400, message: "pairAddress must be 0x…" } } });
    expect(await kindOf(client.pool(DEX, POOL.pairAddress))).toBe("http:400");
  });

  it("404 not found → not-found; 404 dex not found → unknown-dex", async () => {
    const { client } = clientWith({ "/pool/": { status: 404, body: { status: 404, message: "not found" } }, "/status": { status: 404, body: { status: 404, message: "dex not found" } } });
    expect(await kindOf(client.pool(DEX, POOL.pairAddress))).toBe("not-found:404");
    expect(await kindOf(client.status("nosuchdex"))).toBe("unknown-dex:404");
  });

  it("500 → http outage", async () => {
    const { client } = clientWith({ "/dexes": { status: 500, body: { status: 500, message: "boom" } } });
    const err = (await client.dexes().catch((e) => e)) as SwapApiError;
    expect(err.kind).toBe("http");
    expect(err.isOutage).toBe(true);
  });

  it("non-JSON body → parse", async () => {
    const { client } = clientWith({ "/dexes": { raw: "<html>gateway</html>" } });
    expect(await kindOf(client.dexes())).toBe("parse:");
  });

  it("timeout → timeout", async () => {
    const { client } = clientWith({ "/dexes": { body: dexesFx, delayMs: 200 } }, 20);
    expect(await kindOf(client.dexes())).toBe("timeout:");
  });

  it("network failure → network", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const client = createSwapApiClient("http://127.0.0.1:1", { fetchFn });
    expect(await kindOf(client.dexes())).toBe("network:");
  });

  it("a malformed address never reaches fetch", async () => {
    const { client, calls } = clientWith({ "/pool/": { body: poolFx } });
    await expect(client.pool(DEX, "0x1234")).rejects.toBeInstanceOf(SwapApiError);
    await expect(client.route(DEX, POOL.token0, "nope")).rejects.toBeInstanceOf(SwapApiError);
    expect(calls).toHaveLength(0);
  });

  it("a malformed dexId is rejected client-side as unknown-dex", async () => {
    const { client, calls } = clientWith({ "/status": { body: statusFx } });
    expect(await kindOf(client.status("a".repeat(65)))).toBe("unknown-dex:400");
    expect(calls).toHaveLength(0);
  });
});

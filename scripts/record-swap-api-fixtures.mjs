#!/usr/bin/env node
/**
 * Record Swap Read API responses from a running listener (default: the local
 * devnet at http://127.0.0.1:8182) into src/lib/__fixtures__/swapApi/*.json,
 * one file per operation of api/swap-api.yaml. The unit tests parse these
 * fixtures, so re-run this after the API contract changes.
 *
 *   node scripts/record-swap-api-fixtures.mjs [baseUrl]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] ?? process.env.SWAP_API_URL ?? "http://127.0.0.1:8182").replace(/\/+$/, "");
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/__fixtures__/swapApi");

async function get(p) {
  const res = await fetch(base + p, { headers: { accept: "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const dexes = await get("/swap/v1/dexes");
  const dex = dexes.dexes[0];
  if (!dex) throw new Error("no DEX configured on the swap API");
  const d = dex.dexId;
  const pools = await get(`/swap/v1/${d}/pools?sort=liquidity`);
  const pool = pools.items[0];
  if (!pool) throw new Error(`dex ${d} has no pools; seed the devnet first`);
  const account = pool.creatorAddress;
  const files = {
    dexes,
    status: await get(`/swap/v1/${d}/status`),
    token: await get(`/swap/v1/${d}/token/${pool.token0}`),
    tokens: await get(`/swap/v1/${d}/tokens?page=1`),
    pools,
    pool: await get(`/swap/v1/${d}/pool/${pool.pairAddress}`),
    route: await get(`/swap/v1/${d}/route/${pool.token0}/${pool.token1}?k=3`),
    pair: await get(`/swap/v1/${d}/pair/${pool.token0}/${pool.token1}?account=${account}`),
    positions: await get(`/swap/v1/${d}/account/${account}/positions`),
    "pairs-created": await get(`/swap/v1/${d}/account/${account}/pairs-created?page=1`),
  };
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(outDir, `${name}.json`), JSON.stringify(body, null, 2) + "\n", "utf8");
  }
  console.log(`recorded ${Object.keys(files).length} fixtures from ${base} (dexId ${d}) into ${outDir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Standalone route probe against the public QuantumCoin RPC.
 * Usage: node scripts/probe-route.mjs <tokenA> <tokenB> [amountIn] [inter1 inter2 ...]
 *
 * Brute-forces 1-hop and 2-hop routes via WQ, the built-in approved tokens,
 * and any extra intermediate addresses passed on the command line. Use this to
 * confirm which route on-chain exists when the app reports "No liquidity pool
 * exists".
 */
import qc from "quantumcoin";
import { Config, Initialize } from "quantumcoin/config";
import { QuantumSwapV2Factory, QuantumSwapV2Router02 } from "quantumswap";

const RPC = "https://public.rpc.quantumcoinapi.com";
const CHAIN_ID = 123123;
const FACTORY_ADDRESS = "0xbbF45a1B60044669793B444eD01Eb33e03Bb8cf3c5b6ae7887B218D05C5Cbf1d";
const ROUTER_ADDRESS = "0x41323EF72662185f44a03ea0ad8094a0C9e925aB1102679D8e957e838054aac5";
const WQ_ADDRESS = "0x0E49c26cd1ca19bF8ddA2C8985B96783288458754757F4C9E00a5439A7291628";
const HEI = "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d";
const Y2Q = "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7";

const A = (process.argv[2] ?? "").toLowerCase();
const B = (process.argv[3] ?? "").toLowerCase();
const AMOUNT_IN = process.argv[4] ?? "1000000000000000000"; // 1e18
// Extra intermediate token addresses (optional, after amountIn).
const EXTRA_INTER = process.argv.slice(5).map((s) => s.toLowerCase());

if (!A || !B) {
  console.error("usage: node scripts/probe-route.mjs <tokenA> <tokenB> [amountIn] [inter1 inter2 ...]");
  process.exit(1);
}

const provider = new qc.JsonRpcProvider(RPC);
await Initialize(new Config(CHAIN_ID, RPC));
const factory = QuantumSwapV2Factory.connect(FACTORY_ADDRESS, provider);
const router = QuantumSwapV2Router02.connect(ROUTER_ADDRESS, provider);

const ZERO = "0x" + "0".repeat(64);

async function pairOf(x, y) {
  try {
    const p = await factory.getPair(x, y);
    return typeof p === "string" ? p : String(p);
  } catch (e) {
    return "ERR:" + (e?.shortMessage || e?.message || String(e));
  }
}

async function amountsOut(amountIn, path) {
  try {
    const r = await router.getAmountsOut(amountIn, path);
    return r;
  } catch (e) {
    return "REVERT: " + (e?.shortMessage || e?.message || String(e));
  }
}

function short(addr) {
  return addr === WQ_ADDRESS ? "WQ" : addr.slice(0, 8) + "..." + addr.slice(-4);
}

// Candidate intermediates: WQ first, then built-ins, then extras. Dedup, drop A/B.
const intermediates = [];
const seen = new Set();
for (const addr of [WQ_ADDRESS, HEI, Y2Q, ...EXTRA_INTER]) {
  const a = addr.toLowerCase();
  if (a === A || a === B || seen.has(a)) continue;
  seen.add(a);
  intermediates.push(a);
}

(async () => {
  console.log("RPC:", RPC);
  console.log("A:", A, "(" + short(A) + ")");
  console.log("B:", B, "(" + short(B) + ")");
  console.log("amountIn:", AMOUNT_IN, "wei");
  console.log("intermediates:", intermediates.map(short).join(", ") || "(none)");
  console.log();

  // Pair existence checks for A and B against each candidate intermediate.
  console.log("== pool existence ==");
  const pairChecks = [
    ["A-B", A, B],
    ...intermediates.flatMap((X) => [
      [`A-${short(X)}`, A, X],
      [`${short(X)}-B`, X, B],
    ]),
  ];
  for (const [label, x, y] of pairChecks) {
    const p = await pairOf(x, y);
    const exists = p && p.toLowerCase() !== ZERO && !String(p).startsWith("ERR");
    console.log(`  getPair(${label.padEnd(12)}) = ${exists ? "[POOL] " + p : "[no pool]"}`);
  }
  console.log();

  // Probe candidate routes: direct, then 2-hop via each intermediate.
  console.log("== getAmountsOut probes ==");
  const routes = [["A > B", [A, B]]];
  for (const X of intermediates) routes.push([`A > ${short(X)} > B`, [A, X, B]]);

  let best = null;
  for (const [label, path] of routes) {
    const r = await amountsOut(BigInt(AMOUNT_IN), path);
    if (Array.isArray(r)) {
      const out = BigInt(r[r.length - 1]);
      console.log(`  ${label.padEnd(22)} = OK  out=${out.toString()}`);
      if (!best || out > best.out) best = { label, path, out };
    } else {
      console.log(`  ${label.padEnd(22)} = ${r}`);
    }
  }
  console.log();
  if (best) {
    console.log(`BEST ROUTE: ${best.label}  out=${best.out.toString()}`);
    console.log("  path:", best.path.map(short).join(" > "));
  } else {
    console.log("BEST ROUTE: none found via the given intermediates.");
    console.log("  If a route exists via another token, pass it as an extra arg:");
    console.log("  node scripts/probe-route.mjs <A> <B> <amountIn> <intermediateAddr>");
  }
})().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});

/**
 * Live known-pairs registry. Seeds from the embedded config, persists
 * user-discovered pairs to localStorage, and resolves pair addresses via
 * factory.getPair on demand (absorbing the result). Explorers read from here so
 * cold start costs zero RPC beyond the reserves of visible pairs.
 */

import { createStore } from "../ui/store";
import { loadSeedPairs, validatePairRecord, type PairRecord, type PairTokenRef } from "../config/pairs";
import { ZERO_ADDRESS_32, type TokenInfo } from "../config/chain";
import { factory, pair as pairContract } from "./contracts";
import { sanitizeAddress } from "./sanitize";
import { sanitizeAddressResponse, sanitizeDecimals, sanitizeSymbol } from "./sanitizeResponse";
import { getAllTokens, readTokenMetadata, toPathAddress } from "../tokens/tokenList";

const STORAGE_KEY = "qs.discovered-pairs.v1";

export const registryStore = createStore<PairRecord[]>([]);

/** Canonical, order-independent key for a token pair. */
function pairKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}_${y}`;
}

function loadDiscovered(): PairRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PairRecord[] = [];
    for (const entry of parsed) {
      const record = validatePairRecord(entry);
      if (record) out.push(record);
    }
    return out;
  } catch {
    return [];
  }
}

function persistDiscovered(list: PairRecord[]): void {
  try {
    const discovered = list.filter((p) => p.discovered);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(discovered));
  } catch {
    /* ignore */
  }
}

/** Seed the registry from config + localStorage. Call once at startup. */
export function initPairRegistry(): void {
  const seed = loadSeedPairs();
  const discovered = loadDiscovered();
  const byKey = new Map<string, PairRecord>();
  for (const rec of [...seed, ...discovered]) {
    byKey.set(pairKey(rec.token0.address, rec.token1.address), rec);
  }
  registryStore.set([...byKey.values()]);
}

/** Merge a pair record into the registry (dedupe by canonical token key). */
export function mergePair(record: PairRecord): void {
  registryStore.update((list) => {
    const key = pairKey(record.token0.address, record.token1.address);
    const next = list.filter((p) => pairKey(p.token0.address, p.token1.address) !== key);
    next.push(record);
    persistDiscovered(next);
    return next;
  });
}

export function getRegistry(): PairRecord[] {
  return registryStore.get();
}

/** Look up a known pair record by two token addresses. */
export function findPairRecord(aAddr: string, bAddr: string): PairRecord | null {
  const key = pairKey(aAddr, bAddr);
  return registryStore.get().find((p) => pairKey(p.token0.address, p.token1.address) === key) ?? null;
}

function tokenRefFor(address: string): PairTokenRef {
  const known = getAllTokens().find((t) => toPathAddress(t).toLowerCase() === address.toLowerCase());
  if (known) return { address, symbol: known.symbol, decimals: known.decimals };
  return { address, symbol: "TKN", decimals: 18 };
}

/**
 * Resolve a pair address for two tokens: check the registry first, else call
 * factory.getPair. Returns the pair address or null if none exists. Absorbs a
 * newly found pair into the registry.
 */
export async function resolvePairAddress(tokenA: TokenInfo, tokenB: TokenInfo): Promise<string | null> {
  const aAddr = toPathAddress(tokenA);
  const bAddr = toPathAddress(tokenB);
  if (aAddr.toLowerCase() === bAddr.toLowerCase()) return null;

  const known = findPairRecord(aAddr, bAddr);
  if (known) return known.pairAddress;

  const raw = await factory().getPair(aAddr, bAddr);
  const pairAddr = sanitizeAddressResponse(raw);
  if (!pairAddr || pairAddr.toLowerCase() === ZERO_ADDRESS_32.toLowerCase()) return null;

  mergePair({
    pairAddress: pairAddr,
    token0: { address: aAddr, symbol: tokenA.symbol, decimals: tokenA.decimals },
    token1: { address: bAddr, symbol: tokenB.symbol, decimals: tokenB.decimals },
    discovered: true,
  });
  return pairAddr;
}

/** Discover pairs among the built-in/imported tokens (a handful of getPair calls). */
export async function discoverKnownPairs(): Promise<void> {
  const tokens = getAllTokens();
  const seen = new Set(registryStore.get().map((p) => pairKey(p.token0.address, p.token1.address)));
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const aAddr = toPathAddress(tokens[i]);
      const bAddr = toPathAddress(tokens[j]);
      if (aAddr.toLowerCase() === bAddr.toLowerCase()) continue;
      const key = pairKey(aAddr, bAddr);
      if (seen.has(key)) continue;
      try {
        await resolvePairAddress(tokens[i], tokens[j]);
      } catch {
        /* skip unreachable pair */
      }
      seen.add(key);
    }
  }
}

/**
 * Heavier walk: enumerate every pair from the factory and merge it in, reading
 * token metadata per side. Used by the explorer's optional "Load all pairs".
 */
export async function discoverAllFromFactory(limit = 200): Promise<void> {
  const f = factory();
  const lengthRaw = await f.allPairsLength();
  const total = Math.min(Number(lengthRaw ?? 0), limit);
  for (let i = 0; i < total; i++) {
    try {
      const pairAddrRaw = await f.allPairs(BigInt(i));
      const pairAddr = sanitizeAddressResponse(pairAddrRaw);
      if (!pairAddr) continue;
      const p = pairContract(pairAddr);
      const [t0Raw, t1Raw] = await Promise.all([p.token0(), p.token1()]);
      const t0 = sanitizeAddressResponse(t0Raw);
      const t1 = sanitizeAddressResponse(t1Raw);
      if (!t0 || !t1) continue;
      const [ref0, ref1] = await Promise.all([resolveRef(t0), resolveRef(t1)]);
      mergePair({ pairAddress: pairAddr, token0: ref0, token1: ref1, discovered: true });
    } catch {
      /* skip */
    }
  }
}

async function resolveRef(address: string): Promise<PairTokenRef> {
  const known = getAllTokens().find((t) => toPathAddress(t).toLowerCase() === address.toLowerCase());
  if (known) return { address, symbol: known.symbol, decimals: known.decimals };
  try {
    const meta = await readTokenMetadata(address);
    return { address, symbol: sanitizeSymbol(meta.symbol) || "TKN", decimals: sanitizeDecimals(meta.decimals) };
  } catch {
    return tokenRefFor(address);
  }
}

/** Absorb a raw discovered pair (used by search when probing a pair address). */
export function absorbDiscoveredPair(pairAddress: string, token0: PairTokenRef, token1: PairTokenRef): void {
  const safe = sanitizeAddress(pairAddress);
  if (!safe) return;
  mergePair({ pairAddress: safe, token0, token1, discovered: true });
}

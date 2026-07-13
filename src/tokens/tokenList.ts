/**
 * Token registry: built-in (native/wrapped/approved) tokens plus user-imported
 * tokens. Imports are sanitized, stablecoin-name-filtered (approved addresses
 * bypass), persisted to localStorage, and re-validated on every read.
 */

import {
  NATIVE_TOKEN,
  APPROVED_TOKENS,
  NATIVE_SENTINEL,
  impersonatesStablecoin,
  isRecognizedAddress,
  type TokenInfo,
} from "../config/chain";
import { wqAddress, wqToken } from "../config/releases";
import { createStore } from "../ui/store";
import { erc20 } from "../lib/contracts";
import { extensionProvider } from "../lib/extensionProvider";
import { sanitizeAddress } from "../lib/sanitize";
import { sanitizeDecimals, sanitizeName, sanitizeSymbol } from "../lib/sanitizeResponse";

export interface ImportedToken extends TokenInfo {
  imported: true;
  verified: false;
}

const STORAGE_KEY = "qs.imported-tokens.v1";

export const tokenStore = createStore<ImportedToken[]>(loadImported());

function loadImported(): ImportedToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ImportedToken[] = [];
    for (const entry of parsed) {
      const address = sanitizeAddress(entry?.address);
      if (!address) continue;
      const symbol = sanitizeSymbol(entry?.symbol);
      const name = sanitizeName(entry?.name);
      // Re-apply the stablecoin filter on read (unless recognized/approved).
      if (!isRecognizedAddress(address) && impersonatesStablecoin(symbol, name)) continue;
      out.push({
        address,
        symbol: symbol || "TKN",
        name: name || "Unknown Token",
        decimals: sanitizeDecimals(entry?.decimals),
        imported: true,
        verified: false,
      });
    }
    return dedupe(out);
  } catch {
    return [];
  }
}

function persist(list: ImportedToken[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

tokenStore.subscribe(persist);

function dedupe(list: ImportedToken[]): ImportedToken[] {
  const seen = new Set<string>();
  const out: ImportedToken[] = [];
  for (const t of list) {
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** All tokens shown by default: built-ins first, then imported. The wrapped-Q
 * entry resolves to the active release's WQ so a custom release with a different
 * WQ address is represented correctly in selectors and path building. */
export function getAllTokens(): TokenInfo[] {
  return [NATIVE_TOKEN, wqToken(), ...APPROVED_TOKENS, ...tokenStore.get()];
}

/** Find a token in the built-in or imported set by address (or native sentinel). */
export function findToken(addressOrSentinel: string): TokenInfo | null {
  const key = addressOrSentinel.toLowerCase();
  for (const t of getAllTokens()) {
    if (t.address.toLowerCase() === key) return t;
  }
  return null;
}

export interface TokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

/** Read + sanitize on-chain ERC-20 metadata for an address. */
export async function readTokenMetadata(address: string): Promise<TokenMetadata> {
  const safe = sanitizeAddress(address);
  if (!safe) throw new Error("Invalid token address");
  const token = erc20(safe);
  const [nameRaw, symbolRaw, decimalsRaw] = await Promise.all([
    token.name().catch(() => ""),
    token.symbol().catch(() => ""),
    token.decimals().catch(() => 18),
  ]);
  return {
    address: safe,
    name: sanitizeName(nameRaw) || "Unknown Token",
    symbol: sanitizeSymbol(symbolRaw) || "TKN",
    decimals: sanitizeDecimals(decimalsRaw),
  };
}

/** Read a token balance (base units) for an account. Native uses provider balance. */
export async function readTokenBalance(token: TokenInfo, account: string): Promise<bigint> {
  const owner = sanitizeAddress(account);
  if (!owner) return 0n;
  try {
    if (token.isNative) {
      return extensionProvider.getBalance(owner, "latest");
    }
    const raw = await erc20(token.address).balanceOf(owner);
    return typeof raw === "bigint" ? raw : BigInt(raw ?? 0);
  } catch {
    return 0n;
  }
}

export interface ImportCheck {
  ok: boolean;
  reason?: string;
  token?: TokenMetadata;
}

/** Validate an address for import: fetch metadata, apply the stablecoin filter. */
export async function checkImport(address: string): Promise<ImportCheck> {
  const safe = sanitizeAddress(address);
  if (!safe) return { ok: false, reason: "Not a valid 32-byte QuantumCoin address." };
  if (findToken(safe)) return { ok: false, reason: "This token is already in your list." };
  let meta: TokenMetadata;
  try {
    meta = await readTokenMetadata(safe);
  } catch {
    return { ok: false, reason: "Could not read token details on-chain." };
  }
  if (!isRecognizedAddress(safe) && impersonatesStablecoin(meta.symbol, meta.name)) {
    return {
      ok: false,
      reason: "This token uses a stablecoin/fiat-style name or symbol and cannot be imported.",
      token: meta,
    };
  }
  return { ok: true, token: meta };
}

/** Commit an import after the user acknowledges the warning. */
export function importToken(meta: TokenMetadata): ImportedToken {
  const token: ImportedToken = {
    address: meta.address,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals,
    imported: true,
    verified: false,
  };
  tokenStore.update((list) => dedupe([...list, token]));
  return token;
}

export function removeImportedToken(address: string): void {
  const key = address.toLowerCase();
  tokenStore.update((list) => list.filter((t) => t.address.toLowerCase() !== key));
}

/** Map a UI token to the on-chain address used in paths (native -> WQ). */
export function toPathAddress(token: TokenInfo): string {
  return token.address === NATIVE_SENTINEL ? wqAddress() : token.address;
}

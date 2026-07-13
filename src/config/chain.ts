/**
 * Network + protocol configuration for the QuantumSwap Web App.
 *
 * All values are copied verbatim from the QuantumSwap desktop wallet / browser
 * extension so the web app targets the exact same deployed contracts. QuantumCoin
 * addresses are 32 bytes (0x + 64 hex chars); never assume Ethereum's 20-byte form.
 */

export const CHAIN_ID = 123123;
export const NETWORK_NAME = "MAINNET";

/** Block explorer (used only to build outbound links; never fetched by this app). */
export const BLOCK_EXPLORER = "https://quantumscan.com";

/** Where to send users who do not have the QuantumSwap browser extension. */
export const EXTENSION_INSTALL_URL = "https://quantumswap.com/extension.html";

/** Core DEX contracts (from quantumswap-wallet-desktop/src/index.js:359-361). */
export const WQ_ADDRESS =
  "0x0E49c26cd1ca19bF8ddA2C8985B96783288458754757F4C9E00a5439A7291628";
export const FACTORY_ADDRESS =
  "0xbbF45a1B60044669793B444eD01Eb33e03Bb8cf3c5b6ae7887B218D05C5Cbf1d";
export const ROUTER_ADDRESS =
  "0x41323EF72662185f44a03ea0ad8094a0C9e925aB1102679D8e957e838054aac5";

/** 32-byte zero address (pair-existence checks compare against this). */
export const ZERO_ADDRESS_32 = "0x" + "0".repeat(64);

/** Native coin metadata. In swap/liquidity paths, "Q" maps to WQ. */
export const NATIVE_SYMBOL = "Q";
export const NATIVE_NAME = "QuantumCoin";
export const NATIVE_DECIMALS = 18;

/**
 * Sentinel address used to represent the native coin inside the token model.
 * It is never sent to the chain; swap/liquidity code substitutes WQ_ADDRESS.
 */
export const NATIVE_SENTINEL = "native:Q";

/** Constant-product (x*y=k) liquidity-provider fee: 0.30%. */
export const LP_FEE_BPS = 30;

/** Default swap settings. */
export const DEFAULT_SLIPPAGE_PERCENT = 0.5;

/**
 * Fixed transaction deadline offset (seconds), added to the latest chain block
 * timestamp per transaction - the same pattern QuantumSwap.js uses (block
 * timestamp + offset; the router checks block.timestamp <= deadline). Not user
 * configurable. 1200s mirrors the desktop wallet.
 */
export const DEADLINE_OFFSET_SECONDS = 1200;

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** True for the native coin pseudo-token (Q). */
  isNative?: boolean;
  /** Approved tokens are trusted and bypass the stablecoin-name filter. */
  approved?: boolean;
}

/**
 * The native coin as a pseudo-token for the UI. Uses the sentinel address; when
 * building on-chain paths, callers swap this for WQ_ADDRESS.
 */
export const NATIVE_TOKEN: TokenInfo = {
  address: NATIVE_SENTINEL,
  symbol: NATIVE_SYMBOL,
  name: NATIVE_NAME,
  decimals: NATIVE_DECIMALS,
  isNative: true,
  approved: true,
};

export const WQ_TOKEN: TokenInfo = {
  address: WQ_ADDRESS,
  symbol: "WQ",
  name: "Wrapped QuantumCoin",
  decimals: 18,
  approved: true,
};

/**
 * Approved token whitelist (from quantumswap-wallet-desktop/src/js/tokenfilter.js).
 * Decimals default to 18 but are re-read on-chain when the token is loaded.
 */
export const HEISEN_TOKEN: TokenInfo = {
  address: "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d",
  symbol: "hei",
  name: "Heisen",
  decimals: 18,
  approved: true,
};

export const Y2Q_TOKEN: TokenInfo = {
  address: "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7",
  symbol: "Y2Q",
  name: "Y2Q",
  decimals: 18,
  approved: true,
};

export const APPROVED_TOKENS: TokenInfo[] = [HEISEN_TOKEN, Y2Q_TOKEN];

/**
 * Default token pair preselected by the swap / create-pair / add-liquidity
 * forms when the route does not specify tokens.
 */
export const DEFAULT_PAIR_TOKEN_A: TokenInfo = HEISEN_TOKEN;
export const DEFAULT_PAIR_TOKEN_B: TokenInfo = Y2Q_TOKEN;

/** Full built-in list shown by default (native + wrapped + approved). */
export const BUILTIN_TOKENS: TokenInfo[] = [NATIVE_TOKEN, WQ_TOKEN, ...APPROVED_TOKENS];

/** Lowercased set of approved/recognized addresses that bypass the name filter. */
export const RECOGNIZED_ADDRESSES = new Set<string>(
  [WQ_ADDRESS, ...APPROVED_TOKENS.map((t) => t.address)].map((a) => a.toLowerCase()),
);

/**
 * Stablecoin-impersonator patterns (ported verbatim from the desktop wallet's
 * tokenfilter.js). Case-insensitive substring match on symbol OR name.
 */
export const STABLECOIN_PATTERNS: readonly string[] = [
  "usd",
  "dai",
  "tether",
  "stable",
  "stablecoin",
  "frax",
  "fdusd",
  "lusd",
  "tusd",
  "gusd",
  "pyusd",
  "eurt",
  "eurc",
  "eurs",
  "dollar",
  "euro",
  "yen",
  "gbpt",
  "cny",
  "inr",
  "rupee",
  "rupiah",
];

/**
 * Returns true if the given symbol/name looks like a stablecoin impersonator.
 * Runs on already-sanitized/normalized strings (see sanitizeResponse.ts) so
 * zero-width/bidi obfuscation cannot smuggle a match past it.
 */
export function impersonatesStablecoin(symbol?: string | null, name?: string | null): boolean {
  const s = (symbol ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (s.length === 0 && n.length === 0) return false;
  for (const p of STABLECOIN_PATTERNS) {
    if (s.length !== 0 && s.includes(p)) return true;
    if (n.length !== 0 && n.includes(p)) return true;
  }
  return false;
}

/** True if the address is a trusted/approved token (bypasses the name filter). */
export function isRecognizedAddress(address: string): boolean {
  return RECOGNIZED_ADDRESSES.has(address.toLowerCase());
}

/** Build an explorer link for a transaction hash. */
export function explorerTxUrl(hash: string): string {
  return `${BLOCK_EXPLORER}/txn/${hash}`;
}

/** Build an explorer link for an account/contract address. */
export function explorerAddressUrl(address: string): string {
  return `${BLOCK_EXPLORER}/account/${address}`;
}

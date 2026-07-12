/**
 * Read runner over the browser extension (`window.quantumcoin`). Implements the
 * minimal provider surface the quantumcoin `Contract` needs (`call` +
 * `getBlockNumber`) plus a few extra reads, forwarding every request to the
 * allowlisted `eth_*` JSON-RPC passthrough. All chain traffic goes through the
 * extension - this app never opens its own RPC/HTTP connection.
 *
 * Reads require a connected site, so this runner is only used after wallet
 * connect. Every response is validated before it is returned.
 */

import type { QuantumCoinProvider } from "../types/global";
import { sanitizeTxHash, toNumberOrNull } from "./sanitizeResponse";

export class ProviderUnavailableError extends Error {
  constructor() {
    super("No QuantumCoin provider found. Install/enable the QuantumSwap extension, then reload.");
    this.name = "ProviderUnavailableError";
  }
}

function provider(): QuantumCoinProvider {
  const p = window.quantumcoin;
  if (!p) throw new ProviderUnavailableError();
  return p;
}

async function request<T = unknown>(method: string, params?: unknown): Promise<T> {
  return (await provider().request({ method, params })) as T;
}

interface CallTx {
  to?: string;
  data?: string;
  from?: string;
  value?: string | bigint;
}

/**
 * Provider runner passed to `Contract.connect(addr, extensionProvider)`.
 * Duck-typed as a provider by the SDK (`call` + `getBlockNumber` present).
 */
export const extensionProvider = {
  async call(tx: CallTx, blockTag: string | number = "latest"): Promise<string> {
    const payload: Record<string, unknown> = {};
    if (tx.to) payload.to = tx.to;
    if (tx.data) payload.data = tx.data;
    if (tx.from) payload.from = tx.from;
    if (tx.value !== undefined && tx.value !== null) {
      payload.value = typeof tx.value === "bigint" ? "0x" + tx.value.toString(16) : tx.value;
    }
    const raw = await request<unknown>("eth_call", [payload, normalizeBlockTag(blockTag)]);
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]*$/.test(raw)) {
      throw new Error("Unexpected eth_call response");
    }
    return raw;
  },

  async getBlockNumber(): Promise<number> {
    const raw = await request<unknown>("eth_blockNumber");
    const n = toNumberOrNull(raw);
    if (n === null) throw new Error("Unexpected eth_blockNumber response");
    return n;
  },

  async getCode(address: string, blockTag: string | number = "latest"): Promise<string> {
    const raw = await request<unknown>("eth_getCode", [address, normalizeBlockTag(blockTag)]);
    return typeof raw === "string" ? raw : "0x";
  },

  async getBalance(address: string, blockTag: string | number = "latest"): Promise<bigint> {
    const raw = await request<unknown>("eth_getBalance", [address, normalizeBlockTag(blockTag)]);
    return typeof raw === "string" && /^0x[0-9a-fA-F]+$/.test(raw) ? BigInt(raw) : 0n;
  },

  async getTransactionReceipt(hash: string): Promise<unknown> {
    const safe = sanitizeTxHash(hash);
    if (!safe) throw new Error("Invalid transaction hash");
    return request<unknown>("eth_getTransactionReceipt", [safe]);
  },

  async getBlockByNumber(blockTag: string | number = "latest", includeTx = false): Promise<any> {
    return request<any>("eth_getBlockByNumber", [normalizeBlockTag(blockTag), includeTx]);
  },

  async getLogs(filter: unknown): Promise<any[]> {
    const logs = await request<unknown>("eth_getLogs", [filter]);
    return Array.isArray(logs) ? logs : [];
  },
};

function normalizeBlockTag(blockTag: string | number): string {
  if (typeof blockTag === "number") return "0x" + blockTag.toString(16);
  return blockTag || "latest";
}

/** Fetch the latest block timestamp (seconds); used for swap/liquidity deadlines. */
export async function getLatestBlockTimestamp(): Promise<number> {
  try {
    const block = await extensionProvider.getBlockByNumber("latest", false);
    const ts = toNumberOrNull(block?.timestamp);
    if (ts !== null) return ts;
  } catch {
    /* fall through */
  }
  return Math.floor(Date.now() / 1000);
}

/** True if the extension provider is present. */
export function hasProvider(): boolean {
  return Boolean(window.quantumcoin);
}

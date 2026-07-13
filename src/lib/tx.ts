/**
 * Transaction writer. Writes never go through `contract.send()` (which needs a
 * signer runner); instead we encode calldata with the SDK Interface and submit
 * via the extension's `qc_sendTransaction`, always passing the static `abi` so
 * the wallet can decode + re-encode + byte-compare the calldata (WYSIWYS).
 */

import type { QuantumCoinProvider } from "../types/global";
import { ProviderUnavailableError, extensionProvider } from "./extensionProvider";
import { sanitizeTxHash, toNumberOrNull } from "./sanitizeResponse";
import { toHexWei } from "./format";

function provider(): QuantumCoinProvider {
  const p = window.quantumcoin;
  if (!p) throw new ProviderUnavailableError();
  return p;
}

export interface SendTxParams {
  /** Recipient contract. Omit (undefined) to deploy a new contract. */
  to?: string;
  data: string;
  value?: bigint;
  abi: readonly unknown[];
  /**
   * Creation bytecode (0x-prefixed, no constructor args) for a contract
   * deployment. The extension requires this to verify the deploy tx: it
   * strips the bytecode prefix from `data`, decodes the constructor args via
   * `abi`, re-encodes, and byte-compares. Without it the extension rejects an
   * unverifiable deployment. Ignored for calls to existing contracts.
   */
  bytecode?: string;
}

/** Submit a transaction through the wallet approval popup. Returns the txHash. */
export async function sendTx(params: SendTxParams): Promise<string> {
  const txParams: Record<string, unknown> = {
    data: params.data,
    value: toHexWei(params.value ?? 0n),
    abi: params.abi,
  };
  // Omitting `to` signals a contract deployment to the extension.
  if (params.to) txParams.to = params.to;
  if (params.bytecode) txParams.bytecode = params.bytecode;
  const res = await provider().request({
    method: "qc_sendTransaction",
    params: txParams,
  });
  const txHash = sanitizeTxHash((res as { txHash?: unknown } | null)?.txHash);
  if (!txHash) throw new Error("Wallet did not return a transaction hash");
  return txHash;
}

export interface TxReceipt {
  status: number | null;
  contractAddress: string | null;
  blockNumber: number | null;
}

/** Poll for a mined receipt via the read passthrough. */
export async function waitForReceipt(
  txHash: string,
  { tries = 40, intervalMs = 3000 }: { tries?: number; intervalMs?: number } = {},
): Promise<TxReceipt | null> {
  const safe = sanitizeTxHash(txHash);
  if (!safe) return null;
  for (let i = 0; i < tries; i++) {
    const raw = (await extensionProvider.getTransactionReceipt(safe)) as Record<string, unknown> | null;
    if (raw) {
      return {
        status: toNumberOrNull(raw.status),
        contractAddress: typeof raw.contractAddress === "string" ? raw.contractAddress : null,
        blockNumber: toNumberOrNull(raw.blockNumber),
      };
    }
    await sleep(intervalMs);
  }
  return null;
}

/** Resolve once a transaction is mined and successful; reject otherwise. */
export async function waitForReceiptSuccess(hash: string): Promise<void> {
  const receipt = await waitForReceipt(hash);
  if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed on-chain");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

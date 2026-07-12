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
  to: string;
  data: string;
  value?: bigint;
  abi: readonly unknown[];
}

/** Submit a transaction through the wallet approval popup. Returns the txHash. */
export async function sendTx(params: SendTxParams): Promise<string> {
  const res = await provider().request({
    method: "qc_sendTransaction",
    params: {
      to: params.to,
      data: params.data,
      value: toHexWei(params.value ?? 0n),
      abi: params.abi,
    },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

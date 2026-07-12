/**
 * Ambient types for the QuantumSwap browser-extension provider (EIP-1193-shaped)
 * injected at `window.quantumcoin`, plus the preloader globals set in index.html.
 */

export interface QcRequestArgs {
  method: string;
  params?: unknown;
}

export type QcEvent =
  | "connect"
  | "accountsChanged"
  | "chainChanged"
  | "disconnect"
  | "transactionResult";

export interface QcTransactionResult {
  txHash: string;
  status: "succeeded" | "failed" | "timeout";
}

export interface QuantumCoinProvider {
  isQuantumCoin?: boolean;
  request(args: QcRequestArgs): Promise<unknown>;
  on(event: string, handler: (payload: any) => void): void;
  addListener?(event: string, handler: (payload: any) => void): void;
  removeListener?(event: string, handler: (payload: any) => void): void;
  off?(event: string, handler: (payload: any) => void): void;
  removeAllListeners?(event?: string): void;
  enable?(): Promise<string[]>;
}

declare global {
  interface Window {
    quantumcoin?: QuantumCoinProvider;
    __QS_CHUNKS__?: { url: string; bytes: number }[];
    __qsHidePreloader?: () => void;
  }
}

export {};

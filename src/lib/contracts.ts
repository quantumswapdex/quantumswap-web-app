/**
 * Typed contract accessors bound to the extension read runner, plus calldata
 * encoders for writes. The generated `quantumswap` wrappers already carry the
 * static ABIs used for WYSIWYS.
 */

import qc from "quantumcoin";
import {
  IERC20,
  QuantumSwapV2Factory,
  QuantumSwapV2Pair,
  QuantumSwapV2Router02,
  WQ,
} from "quantumswap";
import { extensionProvider } from "./extensionProvider";
import { factoryAddress, routerAddress, wqAddress } from "../config/releases";

export const ROUTER_ABI = QuantumSwapV2Router02.abi;
export const FACTORY_ABI = QuantumSwapV2Factory.abi;
export const PAIR_ABI = QuantumSwapV2Pair.abi;
export const ERC20_ABI = IERC20.abi;
export const WQ_ABI = WQ.abi;

/** Factory contract (reads). Binds to the active release's factory at call time. */
export function factory(): QuantumSwapV2Factory {
  return QuantumSwapV2Factory.connect(factoryAddress(), extensionProvider);
}

/** Router contract (reads: quotes; writes are encoded + sent via tx.ts). */
export function router(): QuantumSwapV2Router02 {
  return QuantumSwapV2Router02.connect(routerAddress(), extensionProvider);
}

/** Pair contract at a given address (reads). */
export function pair(address: string): QuantumSwapV2Pair {
  return QuantumSwapV2Pair.connect(address, extensionProvider);
}

/** ERC-20 token contract at a given address (reads). */
export function erc20(address: string): IERC20 {
  return IERC20.connect(address, extensionProvider);
}

/** Wrapped-Q contract (reads + wrap/unwrap encoding). Binds to the active release. */
export function wq(): WQ {
  return WQ.connect(wqAddress(), extensionProvider);
}

let ifaceCache: Record<string, InstanceType<typeof qc.Interface>> | null = null;

function ifaces() {
  if (!ifaceCache) {
    ifaceCache = {
      router: new qc.Interface(ROUTER_ABI as unknown[]),
      factory: new qc.Interface(FACTORY_ABI as unknown[]),
      pair: new qc.Interface(PAIR_ABI as unknown[]),
      erc20: new qc.Interface(ERC20_ABI as unknown[]),
      wq: new qc.Interface(WQ_ABI as unknown[]),
    };
  }
  return ifaceCache;
}

export function encodeRouter(method: string, args: unknown[]): string {
  return ifaces().router.encodeFunctionData(method, args);
}
export function encodeFactory(method: string, args: unknown[]): string {
  return ifaces().factory.encodeFunctionData(method, args);
}
export function encodeErc20(method: string, args: unknown[]): string {
  return ifaces().erc20.encodeFunctionData(method, args);
}
export function encodeWq(method: string, args: unknown[]): string {
  return ifaces().wq.encodeFunctionData(method, args);
}

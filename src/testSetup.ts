/**
 * Test helper: the QuantumCoin SDK's address utils (qc.isAddress / qc.getAddress,
 * used by sanitizeAddress) require `Initialize()` to have been called, otherwise
 * they throw and sanitizeAddress returns null. Call this in `beforeAll` from any
 * test file that exercises address validation so those paths behave as in the
 * running app. Idempotent within a test file.
 */
import { Config, Initialize } from "quantumcoin/config";

let initialized = false;

export async function initSdkForTests(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    await Initialize(new Config(123123, "https://public.rpc.quantumcoinapi.com"));
  } catch {
    /* Initialize is best-effort; address utils still become available. */
  }
}

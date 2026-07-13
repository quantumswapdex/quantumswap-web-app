import { describe, it, expect, beforeAll } from "vitest";
import { Config, Initialize } from "quantumcoin/config";
import { CHAIN_ID } from "../config/chain";
import { CREATED_TOKEN_ABI, CREATED_TOKEN_BYTECODE, createdTokenDeployData } from "./createdToken";

beforeAll(async () => {
  // qc.Interface requires the SDK to be initialized with chain config.
  await Initialize(new Config(CHAIN_ID, "https://public.rpc.quantumcoinapi.com"));
});

describe("createdToken", () => {
  it("embeds bytecode and a constructor in the ABI", () => {
    expect(CREATED_TOKEN_BYTECODE.startsWith("0x")).toBe(true);
    // optimized typical ERC20 bytecode (~3.1 KB)
    expect(CREATED_TOKEN_BYTECODE.length - 2).toBeGreaterThan(2000);
    const hasCtor = (CREATED_TOKEN_ABI as unknown[]).some(
      (f) => (f as { type?: string }).type === "constructor",
    );
    expect(hasCtor).toBe(true);
  });

  it("encodes deploy data as bytecode + abi-encoded constructor args", () => {
    const data = createdTokenDeployData("MyToken", "MTK", 18, 1_000_000n * 10n ** 18n);
    expect(data.startsWith(CREATED_TOKEN_BYTECODE)).toBe(true);
    // appended constructor args (4 head + dynamic string data)
    expect(data.length).toBeGreaterThan(CREATED_TOKEN_BYTECODE.length + 200);
    // The wallet rejects odd-length hex ("hex string must have an even length"),
    // so both the bytecode and the full deploy payload must be even-length.
    expect((CREATED_TOKEN_BYTECODE.length - 2) % 2).toBe(0);
    expect((data.length - 2) % 2).toBe(0);
    // Must be clean hex.
    expect(/^0x[0-9a-fA-F]*$/.test(data)).toBe(true);
  });
});

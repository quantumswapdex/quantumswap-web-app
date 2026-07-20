import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { initSdkForTests } from "../testSetup";

// Records the address each contract accessor binds to, keyed by contract type.
const bound = vi.hoisted(() => ({
  factory: [] as string[],
  router: [] as string[],
  wq: [] as string[],
}));

// Mock the `quantumswap` ABI wrappers so .connect records the bound address
// instead of needing a live extension. IERC20 / Pair are stubbed (unused here).
vi.mock("quantumswap", () => {
  const make = (bucket: string[]) => ({
    connect: (addr: string) => {
      bucket.push(addr);
      return { address: addr };
    },
    abi: [],
  });
  return {
    QuantumSwapV2Factory: make(bound.factory),
    QuantumSwapV2Router02: make(bound.router),
    QuantumSwapV2Pair: { connect: () => ({}), abi: [] },
    IERC20: { connect: () => ({}), abi: [] },
    WQ: make(bound.wq),
  };
});

import { FACTORY_ADDRESS, ROUTER_ADDRESS, WQ_ADDRESS } from "../config/chain";
import { sanitizeAddress } from "../lib/sanitize";
import { addCustomRelease, BUILTIN_RELEASES, releaseStore, setDefault } from "../config/releases";
import { factory, router, wq } from "./contracts";

const WQ2 = "0x" + "a".repeat(64);
const FAC2 = "0x" + "b".repeat(64);
const ROUT2 = "0x" + "c".repeat(64);

function reset(): void {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
  bound.factory.length = 0;
  bound.router.length = 0;
  bound.wq.length = 0;
}

describe("contracts bind to the active release", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(reset);

  it("binds the Beta 2 addresses by default", () => {
    factory();
    router();
    wq();
    expect(bound.factory.at(-1)).toBe(FACTORY_ADDRESS);
    expect(bound.router.at(-1)).toBe(ROUTER_ADDRESS);
    expect(bound.wq.at(-1)).toBe(WQ_ADDRESS);
  });

  it("re-binds to a custom release's addresses after setDefault (never the original)", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);
    setDefault(res.id as string);

    factory();
    router();
    wq();

    expect(bound.factory.at(-1)).toBe(sanitizeAddress(FAC2));
    expect(bound.router.at(-1)).toBe(sanitizeAddress(ROUT2));
    expect(bound.wq.at(-1)).toBe(sanitizeAddress(WQ2));

    // The main guard: none of the accessors silently kept the original release.
    expect(bound.factory.at(-1)).not.toBe(FACTORY_ADDRESS);
    expect(bound.router.at(-1)).not.toBe(ROUTER_ADDRESS);
    expect(bound.wq.at(-1)).not.toBe(WQ_ADDRESS);
  });

  it("re-binds back to Beta 2 when the custom release is removed", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    setDefault(res.id as string);
    factory();
    expect(bound.factory.at(-1)).toBe(sanitizeAddress(FAC2));

    // removeCustom of the active custom falls back to beta-2 (see releases.test.ts).
    releaseStore.update((prev) => ({
      releases: prev.releases.filter((r) => r.id !== res.id),
      defaultId: BUILTIN_RELEASES[0].id,
    }));

    factory();
    router();
    wq();
    expect(bound.factory.at(-1)).toBe(FACTORY_ADDRESS);
    expect(bound.router.at(-1)).toBe(ROUTER_ADDRESS);
    expect(bound.wq.at(-1)).toBe(WQ_ADDRESS);
  });
});

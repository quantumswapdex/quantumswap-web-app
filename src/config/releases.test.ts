import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { initSdkForTests } from "../testSetup";
import {
  addCustomRelease,
  BUILTIN_RELEASES,
  currentRelease,
  factoryAddress,
  initReleases,
  isCustomActive,
  loadReleases,
  releaseStore,
  removeCustom,
  routerAddress,
  setDefault,
  wqAddress,
} from "./releases";
import { FACTORY_ADDRESS, ROUTER_ADDRESS, WQ_ADDRESS } from "./chain";
import { sanitizeAddress } from "../lib/sanitize";
import { registryStore } from "../lib/pairRegistry";

const WQ2 = "0x" + "a".repeat(64);
const FAC2 = "0x" + "b".repeat(64);
const ROUT2 = "0x" + "c".repeat(64);
const WQ3 = "0x" + "d".repeat(64);
const FAC3 = "0x" + "e".repeat(64);
const ROUT3 = "0x" + "f".repeat(64);

function reset(): void {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
}

describe("releases store", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(reset);

  it("defaults to the Beta 1 built-in release", () => {
    expect(currentRelease().id).toBe("beta-1");
    expect(currentRelease().builtin).toBe(true);
    expect(wqAddress()).toBe(WQ_ADDRESS);
    expect(factoryAddress()).toBe(FACTORY_ADDRESS);
    expect(routerAddress()).toBe(ROUTER_ADDRESS);
    expect(isCustomActive()).toBe(false);
  });

  it("rejects invalid custom releases", () => {
    expect(addCustomRelease("", WQ2, FAC2, ROUT2).ok).toBe(false); // empty name
    expect(addCustomRelease("   ", WQ2, FAC2, ROUT2).ok).toBe(false); // blank name
    expect(addCustomRelease("Foo", "0x123", FAC2, ROUT2).ok).toBe(false); // too short
    expect(addCustomRelease("Foo", WQ2.slice(2), FAC2, ROUT2).ok).toBe(false); // missing 0x
    expect(addCustomRelease("Foo", "0x" + "z".repeat(64), FAC2, ROUT2).ok).toBe(false); // non-hex
    expect(addCustomRelease("Foo", WQ2, "not-an-address", ROUT2).ok).toBe(false); // bad factory
    expect(releaseStore.get().releases.filter((r) => !r.builtin)).toHaveLength(0);
  });

  it("accepts a valid custom release and appends it as non-builtin", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    const customs = releaseStore.get().releases.filter((r) => !r.builtin);
    expect(customs).toHaveLength(1);
    expect(customs[0].builtin).toBe(false);
    expect(customs[0].name).toBe("Prod 1");
    // Built-ins remain first and intact.
    expect(releaseStore.get().releases[0].id).toBe("beta-1");
  });

  it("switches the active release via setDefault and reflects it in the accessors", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);
    setDefault(res.id as string);
    expect(currentRelease().id).toBe(res.id);
    expect(isCustomActive()).toBe(true);
    expect(wqAddress()).toBe(sanitizeAddress(WQ2));
    expect(factoryAddress()).toBe(sanitizeAddress(FAC2));
    expect(routerAddress()).toBe(sanitizeAddress(ROUT2));
    // Crucially, not the original Beta 1 constants.
    expect(wqAddress()).not.toBe(WQ_ADDRESS);
    expect(factoryAddress()).not.toBe(FACTORY_ADDRESS);
    expect(routerAddress()).not.toBe(ROUTER_ADDRESS);
  });

  it("setDefault is a no-op for an unknown id", () => {
    setDefault("does-not-exist");
    expect(currentRelease().id).toBe("beta-1");
  });

  it("setDefault refreshes: clears discovered pairs and dispatches hashchange", () => {
    registryStore.set([
      {
        pairAddress: "0x" + "1".repeat(64),
        token0: { address: WQ2, symbol: "T0", decimals: 18 },
        token1: { address: FAC2, symbol: "T1", decimals: 18 },
        discovered: true,
      },
    ]);
    try {
      localStorage.setItem("qs.discovered-pairs.v1", "[{\"stub\":true}]");
    } catch {
      /* ignore */
    }
    const onHash = vi.fn();
    window.addEventListener("hashchange", onHash);

    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    setDefault(res.id as string);

    expect(registryStore.get()).toHaveLength(0);
    expect(localStorage.getItem("qs.discovered-pairs.v1")).toBeNull();
    expect(onHash).toHaveBeenCalled();
    window.removeEventListener("hashchange", onHash);
  });

  it("removeCustom of the active custom release falls back to Beta 1 and refreshes", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    setDefault(res.id as string);
    expect(isCustomActive()).toBe(true);

    const onHash = vi.fn();
    window.addEventListener("hashchange", onHash);
    removeCustom(res.id as string);
    expect(currentRelease().id).toBe("beta-1");
    expect(isCustomActive()).toBe(false);
    expect(releaseStore.get().releases.find((r) => r.id === res.id)).toBeUndefined();
    expect(onHash).toHaveBeenCalled();
    window.removeEventListener("hashchange", onHash);
  });

  it("removeCustom of a non-active custom release does not refresh", () => {
    const a = addCustomRelease("A", WQ2, FAC2, ROUT2);
    const b = addCustomRelease("B", WQ3, FAC3, ROUT3);
    setDefault(a.id as string);

    const onHash = vi.fn();
    window.addEventListener("hashchange", onHash);
    removeCustom(b.id as string); // removing a non-default custom
    expect(currentRelease().id).toBe(a.id); // active unchanged
    expect(onHash).not.toHaveBeenCalled();
    window.removeEventListener("hashchange", onHash);
  });

  it("removeCustom refuses to remove a built-in", () => {
    removeCustom("beta-1");
    expect(releaseStore.get().releases.find((r) => r.id === "beta-1")).toBeDefined();
    expect(currentRelease().id).toBe("beta-1");
  });

  it("persists customs + defaultId and reloads them via loadReleases", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    setDefault(res.id as string);

    const reloaded = loadReleases();
    expect(reloaded.defaultId).toBe(res.id);
    const reloadedCustom = reloaded.releases.find((r) => r.id === res.id);
    expect(reloadedCustom).toBeDefined();
    expect(reloadedCustom?.builtin).toBe(false);
    expect(reloadedCustom?.wq).toBe(sanitizeAddress(WQ2));
    // Built-ins always present.
    expect(reloaded.releases.some((r) => r.id === "beta-1")).toBe(true);
  });

  it("a custom release survives a fresh load even without being made default", () => {
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);
    // Adding does not activate the release; simulate a page reload by re-deriving
    // state from persisted localStorage. The custom must still be present.
    const reloaded = loadReleases();
    expect(reloaded.releases.find((r) => r.id === res.id)).toBeDefined();
    expect(reloaded.releases.find((r) => r.id === res.id)?.wq).toBe(sanitizeAddress(WQ2));
  });

  it("initReleases restores persisted customs dropped by the import-time load", () => {
    // Regression: the store is created at module-import time, before the SDK's
    // Initialize() runs, when sanitizeAddress rejects every address. Simulate
    // that pruned state (built-ins only, but a custom still in localStorage)
    // and verify bootstrap's initReleases() brings the custom back.
    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);
    setDefault(res.id as string);
    const persistedRaw = localStorage.getItem("qs.releases.v1") as string;
    expect(persistedRaw).toBeTruthy();
    // Import-time state: store holds built-ins only, storage still intact.
    releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
    localStorage.setItem("qs.releases.v1", persistedRaw);
    initReleases();
    expect(releaseStore.get().releases.find((r) => r.id === res.id)).toBeDefined();
    expect(releaseStore.get().defaultId).toBe(res.id);
  });

  it("loadReleases falls back to Beta 1 when storage is empty or corrupt", () => {
    try {
      localStorage.setItem("qs.releases.v1", "{not json");
    } catch {
      /* ignore */
    }
    const reloaded = loadReleases();
    expect(reloaded.defaultId).toBe("beta-1");
    expect(reloaded.releases).toHaveLength(1);
    expect(reloaded.releases[0].id).toBe("beta-1");
  });

  it("loadReleases drops persisted customs with invalid addresses", () => {
    try {
      localStorage.setItem(
        "qs.releases.v1",
        JSON.stringify({
          releases: [{ id: "custom-bad", name: "Bad", wq: "0xnope", factory: FAC2, router: ROUT2 }],
          defaultId: "beta-1",
        }),
      );
    } catch {
      /* ignore */
    }
    const reloaded = loadReleases();
    expect(reloaded.releases.find((r) => r.id === "custom-bad")).toBeUndefined();
    expect(reloaded.releases).toHaveLength(1); // built-in only
  });

  it("built-ins win: a persisted custom colliding with a built-in id is dropped", () => {
    try {
      localStorage.setItem(
        "qs.releases.v1",
        JSON.stringify({
          releases: [{ id: "beta-1", name: "Imposter", wq: WQ2, factory: FAC2, router: ROUT2 }],
          defaultId: "beta-1",
        }),
      );
    } catch {
      /* ignore */
    }
    const reloaded = loadReleases();
    const beta = reloaded.releases.find((r) => r.id === "beta-1");
    expect(beta?.name).toBe("Beta 1");
    expect(beta?.wq).toBe(WQ_ADDRESS);
  });
});

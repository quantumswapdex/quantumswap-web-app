import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { initSdkForTests } from "../testSetup";
import { releasesView } from "./releases";
import { addCustomRelease, BUILTIN_RELEASES, releaseStore } from "../config/releases";

const WQ2 = "0x" + "a".repeat(64);
const FAC2 = "0x" + "b".repeat(64);
const ROUT2 = "0x" + "c".repeat(64);

describe("releases view across navigation", () => {
  beforeAll(() => initSdkForTests());
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    releaseStore.set({ releases: [...BUILTIN_RELEASES], defaultId: BUILTIN_RELEASES[0].id });
  });

  it("a custom release still appears after unmounting and re-mounting the view", () => {
    const v1 = releasesView();
    expect(v1.node.textContent).toContain("Beta 2");

    const res = addCustomRelease("Prod 1", WQ2, FAC2, ROUT2);
    expect(res.ok).toBe(true);

    // The active view's store subscription should re-render with the new release.
    expect(v1.node.textContent).toContain("Prod 1");

    // Navigate away: router calls cleanup, dropping the view's subscription.
    v1.cleanup?.();

    // Navigate back: a fresh view is built and reads the (singleton) store.
    const v2 = releasesView();
    expect(v2.node.textContent).toContain("Prod 1");
  });
});

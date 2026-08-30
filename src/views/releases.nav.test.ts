import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { initSdkForTests } from "../testSetup";
import { releasesView } from "./releases";
import { addCustomRelease, BUILTIN_RELEASES, releaseStore } from "../config/releases";
import { SWAP_API_DEX_ID, SWAP_API_URL } from "../config/chain";

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

  it("cards show each release's API URL and dexId; empty ones read as off", () => {
    const off = addCustomRelease("Offline", WQ2, FAC2, ROUT2, "", "");
    expect(off.ok).toBe(true);
    const v = releasesView();
    const text = v.node.textContent ?? "";
    expect(text).toContain(SWAP_API_URL);
    expect(text).toContain(SWAP_API_DEX_ID);
    expect(text).not.toContain("(default)");
    expect(text).toContain("Off (using extension RPC)");
    v.cleanup?.();
  });

  it("the add-release form is prefilled with the built-in API URL and dexId", () => {
    const v = releasesView();
    const root = v.node as HTMLElement;
    document.body.appendChild(root);
    const addBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Add custom release");
    expect(addBtn).toBeDefined();
    addBtn?.click();
    const urlInput = document.querySelector<HTMLInputElement>('input[aria-label^="Swap Read API URL"]');
    const dexInput = document.querySelector<HTMLInputElement>('input[aria-label^="Swap Read API dexId"]');
    expect(urlInput?.value).toBe(SWAP_API_URL);
    expect(dexInput?.value).toBe(SWAP_API_DEX_ID);
    document.querySelector<HTMLButtonElement>('[role="dialog"] .pop-close')?.click();
    v.cleanup?.();
    root.remove();
  });
});

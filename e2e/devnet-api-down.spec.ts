import { test, expect, type Page } from "@playwright/test";
import { collectErrors, DEVNET, rpcReachable, seedDevnetRelease, stubProvider, swapApiReachable } from "./_devnet";

/**
 * Devnet end-to-end, API DOWN: every /swap/v1/ request is aborted (or answered
 * 500). Without a wallet the views degrade to their connect/empty states with
 * no console errors; with the funded account connected every view renders via
 * the extension RPC fallback. Skipped when the devnet stack is not running.
 */

let apiUp = false;
let rpcUp = false;

test.beforeAll(async () => {
  apiUp = await swapApiReachable();
  rpcUp = await rpcReachable();
});

test.beforeEach(async () => {
  test.skip(!apiUp, "Swap Read API not reachable on the devnet (127.0.0.1:8182)");
});

// Aborted/failed fetches are logged by the browser as resource errors; that
// is the expected signal here, not an app error.
const NETWORK_NOISE = [/Failed to load resource/i, /net::ERR_/i, /ERR_FAILED/i];

async function killApi(page: Page, mode: "abort" | "500"): Promise<void> {
  await page.route("**/swap/v1/**", (route) =>
    mode === "abort"
      ? route.abort("failed")
      : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ status: 500, message: "boom" }) }),
  );
}

for (const mode of ["abort", "500"] as const) {
  test(`API ${mode}: without a wallet the views show connect states, no errors`, async ({ page }) => {
    const errors = collectErrors(page, NETWORK_NOISE);
    await killApi(page, mode);
    await seedDevnetRelease(page);
    await stubProvider(page);
    await page.goto("/#/explore/pools");
    await expect(page.locator("main")).toContainText("Connect your wallet to discover and load pool data.");
    for (const hash of [`#/explore/pools/${DEVNET.LIO_WQ}`, "#/positions", `#/swap/${DEVNET.LIO}/${DEVNET.TIG}`, "#/explore/tokens", "#/releases"]) {
      await page.goto(`/${hash}`);
      await expect(page.locator("main")).not.toBeEmpty();
    }
    await expect(page.locator("main")).toContainText("Swap Read API unavailable");
    expect(errors).toEqual([]);
  });
}

test("API aborted: with the funded account the pool explorer and quote work over RPC", async ({ page }) => {
  test.skip(!rpcUp, "devnet node RPC not reachable (127.0.0.1:8545)");
  const errors = collectErrors(page, NETWORK_NOISE);
  await killApi(page, "abort");
  await seedDevnetRelease(page);
  await stubProvider(page, { account: DEVNET.FUNDED, forwardRpc: true });
  await page.goto("/#/explore/pools");
  // discoverKnownPairsRpc finds LIO-WQ / TIG-WQ / LIO-TIG through factory.getPair
  // (the RPC path labels the wrapped side after the native token, "Q").
  await expect(page.locator("main")).toContainText(/LIO \/ (WQ|Q)|(WQ|Q) \/ LIO/, { timeout: 30_000 });
  await page.goto(`/#/swap/${DEVNET.LIO}/${DEVNET.TIG}`);
  await page.locator("main input").first().fill("1");
  await expect(page.locator("main")).toContainText("Minimum received", { timeout: 30_000 });
  await expect(page.locator("main")).not.toContainText("Estimated from indexed reserves");
  await page.goto("/#/positions");
  await expect(page.locator("main")).toContainText(/LIO \/ (WQ|Q)|(WQ|Q) \/ LIO/, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

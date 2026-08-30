import { test, expect, type Page } from "@playwright/test";
import {
  collectErrors,
  DEVNET,
  dismissConnectModal,
  recordSwapApiRequests,
  rpcReachable,
  seedDevnetRelease,
  stubProvider,
  swapApiReachable,
  SWAP_API_OPERATIONS,
} from "./_devnet";

/**
 * Devnet end-to-end: the app reads market data from the LOCAL Swap Read API
 * (http://127.0.0.1:8182) for the devnet release seeded into localStorage.
 * Skipped when the devnet stack is not running. Two provider stubs:
 *  - installed-not-connected: every view renders from the API alone;
 *  - funded: the seed account is "connected" and eth_* calls go to the real
 *    devnet node, so router quotes and RPC-backed pieces are exercised too.
 * The final test asserts that all ten API operations were called.
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

async function openWithoutWallet(page: Page, hash: string): Promise<string[]> {
  const errors = collectErrors(page);
  await seedDevnetRelease(page);
  await stubProvider(page);
  await page.goto(`/${hash}`);
  await expect(page.locator("header")).toContainText("Quantum");
  await dismissConnectModal(page);
  return errors;
}

test.describe("without a connected wallet (API only)", () => {
  test("the release card shows the API index", async ({ page }) => {
    const errors = await openWithoutWallet(page, "#/releases");
    await expect(page.locator("main")).toContainText("Devnet");
    await expect(page.locator("main")).toContainText(/Swap Read API: indexed \d+ pools/);
    await expect(page.locator("main")).toContainText("http://127.0.0.1:8182");
    expect(errors).toEqual([]);
  });

  test("pool explorer lists devnet pools with reserves, sort and paging", async ({ page }) => {
    const errors = await openWithoutWallet(page, "#/explore/pools");
    const table = page.locator("table.tbl");
    await expect(table).toBeVisible();
    await expect(page.locator("main")).toContainText(/LIO \/ WQ|WQ \/ LIO/);
    await expect(page.locator("main")).toContainText(/Indexed at block\s*\d+/);
    await expect(page.locator("main")).toContainText(/Page 1 of \d+/);
    await page.getByRole("button", { name: "Sort pools" }).click();
    await expect(page.getByRole("button", { name: "Sort pools" })).toHaveText("Sort: newest");
    await expect(table).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator("main")).toContainText(/Page 2 of \d+/);
    expect(errors).toEqual([]);
  });

  test("pair detail renders reserves and LP supply from the API", async ({ page }) => {
    const errors = await openWithoutWallet(page, `#/explore/pools/${DEVNET.LIO_WQ}`);
    await expect(page.locator("main")).toContainText("Reserves & price");
    await expect(page.locator("main")).toContainText("LP total supply");
    await expect(page.locator("main")).toContainText(/LIO \/ WQ|WQ \/ LIO/);
    await expect(page.locator("main")).toContainText(/Indexed at block\s*\d+/);
    expect(errors).toEqual([]);
  });

  test("token explorer shows the indexed tokens and token detail lists LIO's pools", async ({ page }) => {
    const errors = await openWithoutWallet(page, "#/explore/tokens");
    await expect(page.locator("main")).toContainText(/Indexed on this DEX \(\d+\)/);
    await page.goto(`/#/explore/tokens/${DEVNET.LIO}`);
    await expect(page.locator("main")).toContainText("LIO");
    await expect(page.locator("main")).toContainText(/LIO \/ WQ|WQ \/ LIO/);
    await expect(page.locator("main")).toContainText(/LIO \/ TIG|TIG \/ LIO/);
    expect(errors).toEqual([]);
  });

  test("swap quotes LIO → TIG from indexed reserves and labels it an estimate", async ({ page }) => {
    const errors = await openWithoutWallet(page, `#/swap/${DEVNET.LIO}/${DEVNET.TIG}`);
    const from = page.locator("main input").first();
    await from.fill("1");
    await expect(page.locator("main")).toContainText("Estimated from indexed reserves");
    await expect(page.locator("main")).toContainText(/Route/);
    await expect(page.locator("main")).toContainText(/LIO .* TIG/);
    // Exact-out on the To field is quoted the same way.
    await page.locator("main input").nth(1).fill("1");
    await expect(page.locator("main")).toContainText("Maximum sold");
    await expect(page.locator("main")).toContainText("Estimated from indexed reserves");
    expect(errors).toEqual([]);
  });

  test("add liquidity and create pair show pool data with a connect CTA", async ({ page }) => {
    const errors = await openWithoutWallet(page, `#/pools/add/${DEVNET.LIO}/${DEVNET.TIG}`);
    await page.locator("main input").first().fill("1");
    await expect(page.locator("main")).toContainText("LIO price");
    await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();
    await page.goto(`/#/pools/create/${DEVNET.LIO}/${DEVNET.TIG}`);
    await expect(page.locator("main")).toContainText("A pair already exists for these tokens");
    expect(errors).toEqual([]);
  });

  test("global search resolves a pair address and a token address through the API", async ({ page }) => {
    const errors = await openWithoutWallet(page, "#/");
    const search = page.getByLabel("Global search");
    await search.fill(DEVNET.LIO_WQ);
    await search.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("Found a pair");
    await page.keyboard.press("Escape");
    await search.fill(DEVNET.TIG);
    await search.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("TIG");
    expect(errors).toEqual([]);
  });
});

test.describe("with the funded devnet account connected", () => {
  test.beforeEach(async () => {
    test.skip(!rpcUp, "devnet node RPC not reachable (127.0.0.1:8545)");
  });

  test("positions and created pools come from the API; the swap quote upgrades to the router", async ({ page }) => {
    const errors = collectErrors(page);
    await seedDevnetRelease(page);
    await stubProvider(page, { account: DEVNET.FUNDED, forwardRpc: true });
    await page.goto("/#/positions");
    await expect(page.locator("main")).toContainText(/LIO \/ WQ|WQ \/ LIO/);
    await expect(page.locator("main")).toContainText(/Pools you created \(\d+\)/);
    await expect(page.locator("main")).toContainText(/Indexed at block\s*\d+/);

    await page.goto(`/#/swap/${DEVNET.LIO}/${DEVNET.TIG}`);
    await page.locator("main input").first().fill("1");
    await expect(page.locator("main")).toContainText("Minimum received");
    await expect(page.locator("main")).not.toContainText("Estimated from indexed reserves");

    await page.goto(`/#/pools/remove/${DEVNET.LIO_WQ}`);
    await expect(page.locator("main")).toContainText("Your LP balance");
    expect(errors).toEqual([]);
  });
});

test("every Swap Read API operation is exercised across a walk of the app", async ({ page }) => {
  test.skip(!rpcUp, "devnet node RPC not reachable (127.0.0.1:8545)");
  const urls = recordSwapApiRequests(page);
  const errors = collectErrors(page);
  await seedDevnetRelease(page);
  await stubProvider(page, { account: DEVNET.FUNDED, forwardRpc: true });
  for (const hash of [
    "#/releases",
    "#/explore/pools",
    `#/explore/pools/${DEVNET.LIO_WQ}`,
    "#/explore/tokens",
    `#/explore/tokens/${DEVNET.LIO}`,
    `#/pools/add/${DEVNET.LIO}/${DEVNET.TIG}`,
    "#/positions",
    `#/swap/${DEVNET.LIO}/${DEVNET.TIG}`,
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.locator("main")).not.toBeEmpty();
    if (hash.startsWith("#/swap")) {
      await page.locator("main input").first().fill("1");
      await expect(page.locator("main")).toContainText(/Route/);
    }
    if (hash.startsWith("#/positions")) await expect(page.locator("main")).toContainText(/Pools you created/);
    if (hash.startsWith("#/releases")) await expect(page.locator("main")).toContainText(/Swap Read API: indexed/);
  }
  const missing = Object.entries(SWAP_API_OPERATIONS)
    .filter(([, re]) => !urls.some((u) => re.test(u)))
    .map(([op]) => op);
  expect(missing, `operations never requested:\n${urls.join("\n")}`).toEqual([]);
  expect(errors).toEqual([]);
});

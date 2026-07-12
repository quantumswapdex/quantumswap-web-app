/** Ad-hoc check: burger "Home" item and brand link both lead to "/" (front page = swap). */
import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://localhost:4176";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(`
  window.quantumcoin = {
    isQuantumCoin: true,
    request: async ({ method }) => {
      switch (method) {
        case "qc_accounts": return [];
        case "qc_chainId": return 123123;
        default: throw new Error("stub: " + method);
      }
    },
    on: () => {}, addListener: () => {}, removeListener: () => {}, off: () => {}, removeAllListeners: () => {},
  };
`);
const page = await ctx.newPage();

await page.goto(base + "/#/pools");
await page.waitForTimeout(600);
const dismiss = page.getByRole("button", { name: /browse without connecting/i });
if (await dismiss.count()) await dismiss.click();

// Burger -> Home
await page.getByRole("button", { name: "Menu" }).click();
const home = page.locator(".burger-menu a", { hasText: "Home" }).first();
console.log("home is first menu link:", (await page.locator(".burger-menu a").first().innerText()) === "Home");
await home.click();
await page.waitForTimeout(800);
console.log("after Home click url:", page.url(), "| swap heading:", await page.locator("h1, h2").first().innerText());
console.log("home link active:", await page.locator(".burger-menu a", { hasText: "Home" }).first().evaluate((n) => n.classList.contains("active")));
console.log("swap link active:", await page.locator(".burger-menu a", { hasText: "Swap" }).first().evaluate((n) => n.classList.contains("active")));

// Brand -> Home
await page.goto(base + "/#/activity");
await page.waitForTimeout(600);
if (await dismiss.count()) await dismiss.click();
await page.waitForTimeout(200);
await page.locator("a.brand").click();
await page.waitForTimeout(800);
console.log("after brand click url:", page.url(), "| heading:", await page.locator("h1, h2").first().innerText());

await browser.close();

/**
 * Ad-hoc visual check of the redesigned shell (not part of the test suite).
 * Serves dist/ via `vite preview` started externally; takes screenshots of the
 * front page (desktop + mobile), the burger menu, the account dialog (with a
 * stubbed connected wallet), and mobile search.
 *
 * Usage: node e2e/_visual-check.mjs <baseURL>
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://localhost:4173";
const outDir = "e2e/_shots";
mkdirSync(outDir, { recursive: true });

const ACCOUNT = "0x" + "ab12".repeat(16);

function stub(connected) {
  return `
    window.quantumcoin = {
      isQuantumCoin: true,
      request: async ({ method }) => {
        switch (method) {
          case "qc_accounts": return ${connected ? `["${ACCOUNT}"]` : "[]"};
          case "qc_requestAccounts": return ["${ACCOUNT}"];
          case "qc_chainId": return 123123;
          case "qc_getBalance": return "0x8ac7230489e80000";
          default: throw new Error("stub: " + method);
        }
      },
      on: () => {}, addListener: () => {}, removeListener: () => {}, off: () => {}, removeAllListeners: () => {},
    };
  `;
}

const browser = await chromium.launch();

async function shots(connected, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(stub(connected));
  const page = await ctx.newPage();
  await page.goto(base + "/#/");
  await page.waitForTimeout(800);
  // Dismiss the connect modal if present.
  const dismiss = page.getByRole("button", { name: /browse without connecting/i });
  if (await dismiss.count()) await dismiss.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/${tag}-desktop-front.png` });

  await page.getByRole("button", { name: "Menu" }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/${tag}-desktop-menu.png` });
  await page.keyboard.press("Escape");

  if (connected) {
    await page.locator("header button[aria-haspopup='dialog']").first().click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${outDir}/${tag}-desktop-account.png` });
    await page.keyboard.press("Escape");
  }

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${tag}-mobile-front.png` });
  await page.getByRole("button", { name: "Menu" }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/${tag}-mobile-menu.png` });
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/${tag}-mobile-search.png` });

  await ctx.close();
}

await shots(true, "connected");
await shots(false, "disconnected");
await browser.close();
console.log("done ->", outDir);

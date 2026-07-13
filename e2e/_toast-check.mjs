/**
 * Ad-hoc visual check of the per-action status toasts (not part of the suite).
 * Stubs the wallet so a wrap tx "submits" and "mines", then screenshots the
 * pending (cyan wrap accent) and success states.
 *
 * Usage: node e2e/_toast-check.mjs <baseURL>
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://localhost:4173";
const outDir = "e2e/_shots";
mkdirSync(outDir, { recursive: true });

const ACCOUNT = "0x" + "ab12".repeat(16);
const TX_HASH = "0x" + "12".repeat(32);

const stub = `
  let receiptCalls = 0;
  window.quantumcoin = {
    isQuantumCoin: true,
    request: async ({ method }) => {
      switch (method) {
        case "qc_accounts":
        case "qc_requestAccounts": return ["${ACCOUNT}"];
        case "qc_chainId": return 123123;
        case "qc_getBalance": return "0x8ac7230489e80000";
        case "qc_sendTransaction": return { txHash: "${TX_HASH}" };
        case "eth_blockNumber": return "0x10";
        case "eth_getBalance": return "0x8ac7230489e80000";
        case "eth_call": return "0x" + "0".repeat(64);
        case "eth_getTransactionReceipt":
          // First poll: still pending; afterwards: mined OK.
          return ++receiptCalls < 2 ? null : { status: "0x1", blockNumber: "0x11", contractAddress: null };
        default: throw new Error("stub: " + method);
      }
    },
    on: () => {}, addListener: () => {}, removeListener: () => {}, off: () => {}, removeAllListeners: () => {},
  };
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(stub);
const page = await ctx.newPage();

await page.goto(base + "/#/");
await page.waitForTimeout(800);

await page.locator(".io-box .amount").first().fill("1.5");
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Wrap" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/toast-wrap-pending.png` });
await page.locator(".toast").first().screenshot({ path: `${outDir}/toast-wrap-pending-crop.png` });

await page.waitForTimeout(3500);
await page.screenshot({ path: `${outDir}/toast-wrap-success.png` });
await page.locator(".toast").first().screenshot({ path: `${outDir}/toast-wrap-success-crop.png` });

await browser.close();
console.log("done ->", outDir);

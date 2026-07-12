import { test as base, expect } from "@playwright/test";

/**
 * Injected before any app script runs. Simulates the QuantumSwap extension being
 * installed (so the app mounts the full shell) but with no connected account
 * (the "browse without connecting" state). Read calls reject, which the views
 * handle gracefully with empty/error states.
 */
function stubProvider(): void {
  (window as unknown as { quantumcoin: unknown }).quantumcoin = {
    isQuantumCoin: true,
    request: async ({ method }: { method: string }) => {
      switch (method) {
        case "qc_accounts":
          return [];
        case "qc_chainId":
          return 123123;
        default:
          throw new Error("QS-E2E: wallet not connected");
      }
    },
    on: () => {},
    addListener: () => {},
    removeListener: () => {},
    off: () => {},
    removeAllListeners: () => {},
  };
}

// Approved token address (Heisen) for the token-detail route.
const HEISEN = "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d";

const ROUTES: { name: string; path: string }[] = [
  { name: "Home", path: "#/" },
  { name: "Swap", path: "#/swap" },
  { name: "Pools", path: "#/pools" },
  { name: "Add liquidity", path: "#/pools/add" },
  { name: "Create pair", path: "#/pools/create" },
  { name: "Pool Explorer", path: "#/explore/pools" },
  { name: "Token Explorer", path: "#/explore/tokens" },
  { name: "Token detail", path: `#/explore/tokens/${HEISEN}` },
  { name: "Positions", path: "#/positions" },
  { name: "Activity", path: "#/activity" },
  { name: "Settings", path: "#/settings" },
  { name: "Not found", path: "#/does-not-exist" },
];

// Benign browser messages unrelated to app health that we intentionally ignore.
const IGNORED_CONSOLE = [/Content Security Policy directive 'frame-ancestors' is ignored/i];

interface Fixtures {
  errors: string[];
}

const test = base.extend<Fixtures>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });
    await use(errors);
  },
});

// Inject the stub provider before any app script runs, for every test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(stubProvider);
});

for (const route of ROUTES) {
  test(`renders ${route.name} (${route.path}) without wallet`, async ({ page, errors }) => {
    await page.goto(`/${route.path}`);

    // The app shell mounts (extension detected but not connected).
    await expect(page.locator("header")).toContainText("Quantum");
    // The routed view rendered something into the main outlet.
    await expect(page.locator("main")).not.toBeEmpty();

    // No uncaught exceptions or console errors on load (catches the SDK
    // "Cannot destructure property 'Contract'" chunk-init regression).
    expect(errors, `Errors on ${route.path}:\n${errors.join("\n")}`).toEqual([]);
  });
}

test("does not show the extension-missing install dialog when detected", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByText("Install the QuantumSwap extension")).toHaveCount(0);
  // But the connect prompt is offered since we are not connected.
  await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();
});

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests run against the PRODUCTION build (via `vite preview`),
 * so bundling/chunking issues (like SDK chunk init order) are caught in a real
 * browser. Tests navigate every page WITHOUT a connected wallet, using a stub
 * `window.quantumcoin` provider that reports the extension as installed but with
 * no connected accounts.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

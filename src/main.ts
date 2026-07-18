/**
 * Bootstrap: initialize the SDK config, detect the extension provider, wire the
 * stores, mount the app shell, register routes, and hide the preloader.
 */

// Self-hosted fonts (CSP: font-src 'self').
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "./index.css";
import { Config, Initialize } from "quantumcoin/config";
import { CHAIN_ID } from "./config/chain";
import { initReleases } from "./config/releases";
import { appRouter } from "./app/router";
import { createAppShell } from "./ui/components/appShell";
import { brandBackdrop, openInstallModal, openConnectModal } from "./ui/components/gateModals";
import { initWallet, walletStore } from "./wallet/wallet";
import { startWalletToasts } from "./wallet/walletToast";
import { initPairRegistry } from "./lib/pairRegistry";
import { initTxHistory } from "./lib/txStore";
import { initTheme } from "./theme/theme";

import { swapView } from "./views/swap";
import { poolsView } from "./views/pools";
import { addLiquidityView } from "./views/addLiquidity";
import { createPairView } from "./views/createPair";
import { removeLiquidityView } from "./views/removeLiquidity";
import { poolExplorerView } from "./views/poolExplorer";
import { pairDetailView } from "./views/pairDetail";
import { tokenExplorerView } from "./views/tokenExplorer";
import { tokenDetailView } from "./views/tokenDetail";
import { positionsView } from "./views/positions";
import { activityView } from "./views/activity";
import { settingsView } from "./views/settings";
import { releasesView } from "./views/releases";
import { createTokenView } from "./views/createToken";
import { notFoundView } from "./views/notFound";

function hidePreloader(): void {
  if (typeof window.__qsHidePreloader === "function") window.__qsHidePreloader();
  window.dispatchEvent(new Event("qs:app-ready"));
}

function registerRoutes(): void {
  appRouter
    // The front page is the swap panel (swap-only landing).
    .add("/", swapView, { theme: "violet" })
    .add("swap", swapView, { theme: "violet" })
    .add("swap/:from", swapView, { theme: "violet" })
    .add("swap/:from/:to", swapView, { theme: "violet" })
    .add("pools", poolsView, { theme: "nebula" })
    .add("pools/add", addLiquidityView, { theme: "nebula" })
    .add("pools/add/:tokenA", addLiquidityView, { theme: "nebula" })
    .add("pools/add/:tokenA/:tokenB", addLiquidityView, { theme: "nebula" })
    .add("pools/create", createPairView, { theme: "nebula" })
    .add("pools/create/:tokenA", createPairView, { theme: "nebula" })
    .add("pools/create/:tokenA/:tokenB", createPairView, { theme: "nebula" })
    .add("pools/remove/:pairAddress", removeLiquidityView, { theme: "nebula" })
    .add("explore/pools", poolExplorerView, { theme: "cyan" })
    .add("explore/pools/:pairAddress", pairDetailView, { theme: "cyan" })
    .add("explore/tokens", tokenExplorerView, { theme: "emerald" })
    .add("explore/tokens/:address", tokenDetailView, { theme: "emerald" })
    .add("tokens/create", createTokenView, { theme: "emerald" })
    .add("positions", positionsView, { theme: "nebula" })
    .add("activity", activityView, { theme: "amber" })
    .add("settings", settingsView, { theme: "amber" })
    .add("releases", releasesView, { theme: "amber" })
    .setNotFound(notFoundView);
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;

  // Apply the stored theme preference before the shell paints.
  initTheme();

  // Config only - all chain transport goes through the extension, not this URL.
  try {
    await Initialize(new Config(CHAIN_ID, "https://public.rpc.quantumcoinapi.com"));
  } catch {
    /* Initialize failure still lets the extension-missing panel render. */
  }

  // Now that the SDK's address utils work, reload persisted custom releases
  // (they are dropped by the import-time load; see initReleases).
  initReleases();

  await initWallet();

  // Toast on extension-driven connect / disconnect / account changes.
  startWalletToasts();

  // Extension not detected: show a blocking install dialog over a branded backdrop.
  if (walletStore.get().status === "no-provider") {
    root.replaceChildren(brandBackdrop());
    hidePreloader();
    openInstallModal();
    return;
  }

  initPairRegistry();
  initTxHistory();

  const { root: shell, outlet } = createAppShell();
  root.replaceChildren(shell);
  registerRoutes();
  appRouter.start(outlet);

  hidePreloader();

  // Extension detected but not yet connected: prompt to connect.
  if (walletStore.get().status !== "connected") {
    openConnectModal();
  }
}

void bootstrap();

/**
 * Shared helpers for the devnet end-to-end specs: the local devnet deployment
 * (a custom release pointing at the local Swap Read API), stub extension
 * providers (installed-not-connected, or a funded account whose eth_* calls
 * are forwarded to the real devnet node), and reachability checks so the
 * specs skip cleanly on machines without the devnet stack.
 *
 * Devnet stack (see quantumscan/tools/devnet-api-e2e): node RPC on :8545,
 * quantumscan read API on :8181, Swap Read API on :8182.
 */
import type { Page } from "@playwright/test";

export const DEVNET_API = (process.env.DEVNET_SWAPAPI_URL ?? "http://127.0.0.1:8182").replace(/\/+$/, "");
export const DEVNET_RPC = process.env.DEVNET_RPC_URL ?? "http://127.0.0.1:8545";
export const DEVNET_CHAIN_ID = 123123;

/** Devnet DEX deployment (dexId quantumswap-beta2 on the local Swap Read API). */
export const DEVNET_RELEASE = {
  id: "custom-devnet",
  name: "Devnet",
  wq: "0x761e72c47866b7ef2358d6c9770a49db7c9c4c7e23949d556f1ce798ff8e2f6e",
  factory: "0x4936ede416c82663adcb898d68ad12aad0131b0e19ae876b35e7b0d25ad7a319",
  router: "0x957320a8b1a3ca3fdd4ac3ab7191060cc315dff08de367f7e2962296c8aae7a4",
  apiUrl: DEVNET_API,
  dexId: "quantumswap-beta2",
};

/** Seeded devnet tokens / pools / accounts (quantumscan devnet manifest). */
export const DEVNET = {
  LIO: "0x6467cdc39eacf95e04654c827d412d752e1430b8be214f0fd6cee672eab1e8d3",
  TIG: "0x6555fa080b18fca061506497046488ab5ef5f0c6afd6f49a0631a670e1565827",
  LIO_WQ: "0x0b8610ae9414682c6e4ca635cf16805495a2540a585889c9469276c96e622d5b",
  TIG_WQ: "0xc4da927bf1c7ee2ec2fd8a2474d3a68db0f1bc64193ed8cd39df5e7ff6a7615e",
  LIO_TIG: "0x114dbd57b41ba669cd5cfbd4d6041c3843326c5706fc79c179fb2ed37a3e58a1",
  /** Funded seed account: created every pool and holds LP in all of them. */
  FUNDED: "0x1a846abe71c8b989e8337c55d608be81c28ab3b2e40c83eaa2a68d516049aec6",
};

/** True when the local Swap Read API answers /swap/v1/dexes. */
export async function swapApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DEVNET_API}/swap/v1/dexes`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when the devnet node RPC answers. */
export async function rpcReachable(): Promise<boolean> {
  try {
    const res = await fetch(DEVNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Persist the devnet release as the active one (plus the two devnet tokens as
 * imports so swap/liquidity forms can resolve them without a wallet) before
 * any app script runs.
 */
export async function seedDevnetRelease(page: Page): Promise<void> {
  await page.addInitScript(
    ({ release, tokens }) => {
      localStorage.setItem("qs.releases.v1", JSON.stringify({ releases: [release], defaultId: release.id }));
      localStorage.setItem(
        "qs.imported-tokens.v1",
        JSON.stringify(
          tokens.map((t) => ({ address: t.address, symbol: t.symbol, name: t.name, decimals: 18, imported: true, verified: false })),
        ),
      );
    },
    {
      release: DEVNET_RELEASE,
      tokens: [
        { address: DEVNET.LIO, symbol: "LIO", name: "Lio" },
        { address: DEVNET.TIG, symbol: "TIG", name: "Tiger" },
      ],
    },
  );
}

export interface StubProviderOptions {
  /** Connected account; omit for the installed-but-not-connected state. */
  account?: string;
  /** Forward eth_* calls to the devnet node (needs `exposeRpcBridge`). */
  forwardRpc?: boolean;
}

/**
 * Install a stub `window.quantumcoin` before any app script runs. Without an
 * account it mirrors the smoke spec (reads reject). With `forwardRpc`, chain
 * reads/quotes go to the real devnet node through the Node-side bridge so the
 * RPC fallback and router quotes are exercised for real.
 */
export async function stubProvider(page: Page, opts: StubProviderOptions = {}): Promise<void> {
  if (opts.forwardRpc) await exposeRpcBridge(page);
  await page.addInitScript(
    ({ account, forwardRpc, chainId }) => {
      const w = window as unknown as {
        quantumcoin: unknown;
        __qsRpc?: (method: string, params: unknown[]) => Promise<unknown>;
      };
      w.quantumcoin = {
        isQuantumCoin: true,
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          switch (method) {
            case "qc_accounts":
            case "qc_requestAccounts":
              return account ? [account] : [];
            case "qc_chainId":
              return chainId;
            default:
              if (forwardRpc && w.__qsRpc) return w.__qsRpc(method, params ?? []);
              throw new Error("QS-E2E: wallet not connected");
          }
        },
        on: () => {},
        addListener: () => {},
        removeListener: () => {},
        off: () => {},
        removeAllListeners: () => {},
      };
    },
    { account: opts.account ?? null, forwardRpc: Boolean(opts.forwardRpc), chainId: DEVNET_CHAIN_ID },
  );
}

/** Node-side JSON-RPC bridge the stub provider forwards eth_* calls to. */
async function exposeRpcBridge(page: Page): Promise<void> {
  await page.exposeFunction("__qsRpc", async (method: string, params: unknown[]) => {
    const res = await fetch(DEVNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? "rpc error");
    return body.result;
  });
}

/**
 * Collect uncaught page errors and console errors (minus known-benign ones).
 * "Failed to load resource" lines are the browser's own network log for
 * fetches the app already handles (an unreachable API host, or an expected
 * 404 such as a built-in token that has no pool on the devnet); they are not
 * app errors and are ignored.
 */
export function collectErrors(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  const ignored = [/Content Security Policy directive 'frame-ancestors' is ignored/i, /Failed to load resource/i, ...ignore];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignored.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

/** Close the boot-time "Connect your wallet" dialog (dismissable) so the page is clickable. */
export async function dismissConnectModal(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
}

/** Record every Swap Read API request URL the page issues. */
export function recordSwapApiRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/swap/v1/")) urls.push(u);
  });
  return urls;
}

/** The ten operation patterns of api/swap-api.yaml, keyed by operationId. */
export const SWAP_API_OPERATIONS: Record<string, RegExp> = {
  ListSwapDexes: /\/swap\/v1\/dexes$/,
  GetSwapDexStatus: /\/swap\/v1\/[^/]+\/status$/,
  GetSwapToken: /\/swap\/v1\/[^/]+\/token\/0x[0-9a-f]{64}$/,
  ListSwapTokens: /\/swap\/v1\/[^/]+\/tokens\?/,
  ListSwapPools: /\/swap\/v1\/[^/]+\/pools\?/,
  GetSwapPool: /\/swap\/v1\/[^/]+\/pool\/0x[0-9a-f]{64}$/,
  GetSwapRoute: /\/swap\/v1\/[^/]+\/route\/0x[0-9a-f]{64}\/0x[0-9a-f]{64}\?k=/,
  GetSwapPair: /\/swap\/v1\/[^/]+\/pair\/0x[0-9a-f]{64}\/0x[0-9a-f]{64}/,
  GetSwapAccountPositions: /\/swap\/v1\/[^/]+\/account\/0x[0-9a-f]{64}\/positions$/,
  ListSwapAccountPairsCreated: /\/swap\/v1\/[^/]+\/account\/0x[0-9a-f]{64}\/pairs-created\?/,
};

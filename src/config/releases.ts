/**
 * Release switcher: the app talks to one on-chain deployment at a time, defined
 * by its three core contracts (WQ, Factory, Router). The built-in "Beta 2"
 * release mirrors the constants in `./chain.ts`; users can add custom releases
 * (e.g. a prod deployment or a test fixture) at runtime and choose which one is
 * active. The active release is persisted to localStorage and read at call time
 * by `src/lib/contracts.ts` and the views, so switching a release takes effect
 * everywhere without a rebuild.
 *
 * Modelled on `./settings.ts`: a `createStore` whose changes auto-persist.
 */

import { createStore } from "../ui/store";
import { sanitizeAddress, sanitizeDexId, sanitizeUrl } from "../lib/sanitize";
import { FACTORY_ADDRESS, ROUTER_ADDRESS, SWAP_API_DEX_ID, SWAP_API_URL, WQ_ADDRESS, type TokenInfo } from "./chain";
import { registryStore } from "../lib/pairRegistry";

export interface Release {
  id: string;
  name: string;
  wq: string;
  factory: string;
  router: string;
  /**
   * Swap Read API base URL for this deployment. The built-in release and the
   * add-release form default to `SWAP_API_URL`; a custom release (e.g. a
   * devnet) can point at its own read index. Empty string = the Swap Read API
   * is off for this release and every market read uses the extension RPC.
   */
  apiUrl: string;
  /**
   * dexId of this deployment on the Swap Read API (every scoped call is
   * /swap/v1/{dexId}/...). Defaults to `SWAP_API_DEX_ID`. Empty string = the
   * Swap Read API is off for this release (extension RPC only). The market
   * layer also checks that the API's factory for this dexId matches the
   * release's factory before using it (`src/lib/marketData.ts`).
   */
  dexId: string;
  /** Built-ins ship in code and cannot be removed or edited. */
  builtin: boolean;
}

export interface ReleaseState {
  /** Built-ins first, then user-added customs. */
  releases: Release[];
  /** id of the active release. */
  defaultId: string;
}

const STORAGE_KEY = "qs.releases.v1";
const BETA_ID = "beta-2";

/**
 * The single built-in release. Addresses are the Beta 2 deployment constants
 * from `./chain.ts`; adding more built-ins here is the only code change needed
 * to ship a new predefined release (e.g. a prod deployment).
 */
export const BUILTIN_RELEASES: Release[] = [
  {
    id: BETA_ID,
    name: "Beta 2",
    wq: WQ_ADDRESS,
    factory: FACTORY_ADDRESS,
    router: ROUTER_ADDRESS,
    apiUrl: SWAP_API_URL,
    dexId: SWAP_API_DEX_ID,
    builtin: true,
  },
];

/** Shape persisted to localStorage: customs only, plus the chosen default id. */
interface PersistedState {
  releases: Omit<Release, "builtin">[];
  defaultId: string;
}

/** Callbacks run after the active release changes (caches are invalidated). */
const refreshListeners = new Set<() => void>();

/**
 * Register a hook that runs whenever the active release changes (setDefault /
 * removeCustom of the active release). Used by the market-data layer to
 * re-probe the Swap Read API without this module importing it.
 */
export function onReleaseRefresh(fn: () => void): () => void {
  refreshListeners.add(fn);
  return () => refreshListeners.delete(fn);
}

/** Re-derive the full release state from code + localStorage. Exported for tests. */
export function loadReleases(): ReleaseState {
  const customs: Release[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const list = Array.isArray(parsed?.releases) ? parsed.releases : [];
      const builtinIds = new Set(BUILTIN_RELEASES.map((r) => r.id));
      for (const entry of list) {
        if (!entry || builtinIds.has(entry.id)) continue;
        const wq = sanitizeAddress(entry.wq);
        const factory = sanitizeAddress(entry.factory);
        const router = sanitizeAddress(entry.router);
        if (!wq || !factory || !router) continue;
        customs.push({
          id: String(entry.id),
          name: String(entry.name ?? "").trim() || "Custom release",
          wq,
          factory,
          router,
          apiUrl: resolvePersistedField(entry.apiUrl, sanitizeUrl, SWAP_API_URL),
          dexId: resolvePersistedField(entry.dexId, sanitizeDexId, SWAP_API_DEX_ID),
          builtin: false,
        });
      }
    }
  } catch {
    /* corrupt or missing storage - fall back to built-ins only */
  }

  const releases = [...BUILTIN_RELEASES, ...customs];
  const persistedDefault = tryParseDefault();
  const defaultId =
    persistedDefault && releases.some((r) => r.id === persistedDefault)
      ? persistedDefault
      : BUILTIN_RELEASES[0].id;
  return { releases, defaultId };
}

/**
 * Resolve a persisted Swap Read API field (apiUrl / dexId) without dropping the
 * release: a missing key means the release was saved before the field existed
 * and keeps the behaviour it had (the default); an explicitly empty value is
 * the user's "off" choice and stays empty; a present-but-invalid value falls
 * back to the default.
 */
function resolvePersistedField(raw: unknown, sanitize: (v: unknown) => string | null, fallback: string): string {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "string" && raw.trim() === "") return "";
  return sanitize(raw) ?? fallback;
}

function tryParseDefault(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return typeof parsed?.defaultId === "string" ? parsed.defaultId : null;
  } catch {
    return null;
  }
}

export const releaseStore = createStore<ReleaseState>(loadReleases());

/**
 * Re-derive the store from localStorage once the SDK is ready. This module is
 * evaluated (and `loadReleases` first runs) at import time, before bootstrap
 * awaits `Initialize()`; until then `sanitizeAddress` cannot validate any
 * address (the SDK address utils throw), so every persisted custom release is
 * dropped from the initial state. Bootstrap must call this after `Initialize()`
 * so persisted customs survive a page load.
 */
export function initReleases(): void {
  releaseStore.set(loadReleases());
}

releaseStore.subscribe((state) => {
  try {
    const persisted: PersistedState = {
      releases: state.releases
        .filter((r) => !r.builtin)
        .map(({ id, name, wq, factory, router, apiUrl, dexId }) => ({ id, name, wq, factory, router, apiUrl, dexId })),
      defaultId: state.defaultId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* ignore quota / private mode */
  }
});

/** The currently active release (defensive fallback to the first built-in). */
export function currentRelease(): Release {
  const { releases, defaultId } = releaseStore.get();
  return releases.find((r) => r.id === defaultId) ?? BUILTIN_RELEASES[0];
}

/** Active release's wrapped-Q address (call-time, reflects the current release). */
export function wqAddress(): string {
  return currentRelease().wq;
}

/** Active release's factory address (call-time). */
export function factoryAddress(): string {
  return currentRelease().factory;
}

/** Active release's router address (call-time). */
export function routerAddress(): string {
  return currentRelease().router;
}

/**
 * Active release's Swap Read API base URL (call-time). Empty when the Swap
 * Read API is off for this release; check `swapApiEnabled()` before use.
 */
export function swapApiUrl(): string {
  return currentRelease().apiUrl;
}

/**
 * Active release's Swap Read API dexId (call-time), or null when the release
 * has it empty (Swap Read API off).
 */
export function swapApiConfiguredDexId(): string | null {
  return currentRelease().dexId || null;
}

/**
 * True when the active release has both a Swap Read API URL and a dexId. When
 * false every market read goes to the extension RPC (`src/lib/marketData.ts`).
 */
export function swapApiEnabled(): boolean {
  const rel = currentRelease();
  return rel.apiUrl !== "" && rel.dexId !== "";
}

/**
 * The active release's wrapped-Q as a UI token (call-time). Mirrors the shape of
 * `WQ_TOKEN` in `./chain.ts` but resolves to the active release's WQ address, so
 * wrap/unwrap detection and the default "To" token stay correct under a custom
 * release with a different WQ.
 */
export function wqToken(): TokenInfo {
  return { address: wqAddress(), symbol: "WQ", name: "Wrapped QuantumCoin", decimals: 18, approved: true };
}

/** True when a user-added (non-built-in) release is active - drives the banner. */
export function isCustomActive(): boolean {
  return !currentRelease().builtin;
}

export interface AddResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/**
 * Validate + append a custom release. Returns the new id on success.
 *
 * `apiUrl` / `dexId`: omitted (undefined) = the built-in defaults
 * (`SWAP_API_URL` / `SWAP_API_DEX_ID`); an empty string = the user cleared the
 * field, so the Swap Read API is off for this release (extension RPC only);
 * a non-empty value must be an http(s) base URL (see sanitizeUrl) / a valid
 * dexId (see sanitizeDexId).
 */
export function addCustomRelease(name: string, wq: string, factory: string, router: string, apiUrl?: string, dexId?: string): AddResult {
  const trimmedName = (name ?? "").trim();
  if (!trimmedName) return { ok: false, error: "Enter a name for the release." };
  if (trimmedName.length > 60) return { ok: false, error: "Release name is too long (max 60 characters)." };

  const wqAddr = sanitizeAddress(wq);
  const factoryAddr = sanitizeAddress(factory);
  const routerAddr = sanitizeAddress(router);
  if (!wqAddr) return { ok: false, error: "WQ address is not a valid 32-byte address." };
  if (!factoryAddr) return { ok: false, error: "Factory address is not a valid 32-byte address." };
  if (!routerAddr) return { ok: false, error: "Router address is not a valid 32-byte address." };
  const trimmedUrl = apiUrl === undefined ? SWAP_API_URL : apiUrl.trim();
  const safeUrl = trimmedUrl ? sanitizeUrl(trimmedUrl) : "";
  if (safeUrl === null) return { ok: false, error: "Swap Read API URL must be an http(s) URL without credentials or query." };
  const trimmedDexId = dexId === undefined ? SWAP_API_DEX_ID : dexId.trim();
  const safeDexId = trimmedDexId ? sanitizeDexId(trimmedDexId) : "";
  if (safeDexId === null) return { ok: false, error: "Swap Read API dexId may only contain letters, digits, - and _ (max 64)." };

  const id = uniqueCustomId();
  const release: Release = {
    id,
    name: trimmedName,
    wq: wqAddr,
    factory: factoryAddr,
    router: routerAddr,
    apiUrl: safeUrl,
    dexId: safeDexId,
    builtin: false,
  };
  releaseStore.update((prev) => ({
    ...prev,
    releases: [...prev.releases, release],
  }));
  return { ok: true, id };
}

/** Activate a release by id and refresh the app to use it. No-op if unknown. */
export function setDefault(id: string): void {
  const state = releaseStore.get();
  if (!state.releases.some((r) => r.id === id)) return;
  if (state.defaultId === id) return;
  releaseStore.update((prev) => ({ ...prev, defaultId: id }));
  applyRefreshSideEffects();
}

/** Remove a custom release. If it was active, fall back to Beta 2 + refresh. */
export function removeCustom(id: string): void {
  const state = releaseStore.get();
  const target = state.releases.find((r) => r.id === id);
  if (!target || target.builtin) return;
  const wasDefault = state.defaultId === id;
  releaseStore.update((prev) => ({
    releases: prev.releases.filter((r) => r.id !== id),
    defaultId: wasDefault ? BUILTIN_RELEASES[0].id : prev.defaultId,
  }));
  if (wasDefault) applyRefreshSideEffects();
}

/**
 * Invalidate per-factory caches and force the current route to re-render so the
 * whole app picks up the newly active release. Discovered pairs belong to a
 * specific factory and are stale under a new release, so they are dropped.
 */
function applyRefreshSideEffects(): void {
  registryStore.set([]);
  try {
    localStorage.removeItem("qs.discovered-pairs.v1");
  } catch {
    /* ignore */
  }
  for (const fn of [...refreshListeners]) {
    try {
      fn();
    } catch {
      /* a listener must never break the switch */
    }
  }
  // Re-render the current route without a full page reload. The router listens
  // on `hashchange` and re-renders into the outlet; location.hash is unchanged.
  window.dispatchEvent(new Event("hashchange"));
}

function uniqueCustomId(): string {
  const existing = new Set(releaseStore.get().releases.map((r) => r.id));
  let id = "";
  let n = 0;
  do {
    id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (n++ > 50) break;
  } while (existing.has(id));
  return id;
}

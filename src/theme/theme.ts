/**
 * Theme model + application logic (Phase 11).
 *
 * Five page-group themes are applied via the `data-theme` attribute on <html>.
 * By default the active theme follows the current route ("auto"); the optional
 * switcher lets the user pin a single theme, persisted to localStorage and
 * re-validated on read.
 */

import { createStore } from "../ui/store";

export type ThemeId = "violet" | "cyan" | "nebula" | "emerald" | "amber";
export type ThemeMode = "auto" | ThemeId;

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Which page group this theme belongs to (shown in the switcher). */
  group: string;
  /** Primary + secondary swatch colors for the switcher UI. */
  swatch: string;
  swatch2: string;
}

export const THEMES: ThemeMeta[] = [
  { id: "violet", label: "Quantum Violet", group: "Home & Swap", swatch: "#6c3bff", swatch2: "#00e5ff" },
  { id: "cyan", label: "Cyan Flux", group: "Pools & Pair detail", swatch: "#00e5ff", swatch2: "#6c3bff" },
  { id: "nebula", label: "Nebula Purple", group: "Liquidity & Positions", swatch: "#a855f7", swatch2: "#6c3bff" },
  { id: "emerald", label: "Emerald Quantum", group: "Tokens", swatch: "#34d399", swatch2: "#00e5ff" },
  { id: "amber", label: "Amber Core", group: "Activity & Settings", swatch: "#f59e0b", swatch2: "#fcd34d" },
];

const DEFAULT_THEME: ThemeId = "violet";
const STORAGE_KEY = "qs.theme-mode.v1";
const VALID_MODES: readonly ThemeMode[] = ["auto", "violet", "cyan", "nebula", "emerald", "amber"];

function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

function loadMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_MODES as readonly string[]).includes(raw)) return raw as ThemeMode;
  } catch {
    /* ignore storage errors */
  }
  return "auto";
}

/** Current user preference: "auto" (follow route) or a pinned theme id. */
export const themeStore = createStore<ThemeMode>(loadMode());

/** The theme requested by the current route (used when the mode is "auto"). */
let routeTheme: ThemeId = DEFAULT_THEME;

/** The theme actually applied given the current mode + route. */
export function effectiveTheme(): ThemeId {
  const mode = themeStore.get();
  return mode === "auto" ? routeTheme : mode;
}

function applyEffective(): void {
  document.documentElement.setAttribute("data-theme", effectiveTheme());
}

/** Called by the router on each navigation with that route's theme. */
export function setRouteTheme(theme: string): void {
  if (isThemeId(theme)) routeTheme = theme;
  applyEffective();
}

/** Called by the switcher when the user changes their preference. */
export function setThemeMode(mode: ThemeMode): void {
  themeStore.set(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore storage errors */
  }
  applyEffective();
}

/** Apply the stored preference at startup (before the shell mounts). */
export function initTheme(): void {
  applyEffective();
}

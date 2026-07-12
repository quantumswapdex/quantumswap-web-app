/**
 * User settings store (slippage, expert mode) persisted to localStorage and
 * re-validated on read. The transaction deadline is intentionally not a
 * setting: it is a fixed offset from the chain block timestamp
 * (see DEADLINE_OFFSET_SECONDS in config/chain.ts).
 */

import { createStore } from "../ui/store";
import { DEFAULT_SLIPPAGE_PERCENT } from "./chain";
import { sanitizeSlippage } from "../lib/sanitize";

export interface Settings {
  slippagePercent: number;
  expertMode: boolean;
}

const STORAGE_KEY = "qs.settings.v1";

function load(): Settings {
  const fallback: Settings = {
    slippagePercent: DEFAULT_SLIPPAGE_PERCENT,
    expertMode: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      slippagePercent: sanitizeSlippage(parsed.slippagePercent) ?? fallback.slippagePercent,
      expertMode: parsed.expertMode === true,
    };
  } catch {
    return fallback;
  }
}

export const settingsStore = createStore<Settings>(load());

settingsStore.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
});

export function setSlippage(value: number): void {
  const s = sanitizeSlippage(value);
  if (s === null) return;
  settingsStore.update((prev) => ({ ...prev, slippagePercent: s }));
}

export function setExpertMode(on: boolean): void {
  settingsStore.update((prev) => ({ ...prev, expertMode: on }));
}

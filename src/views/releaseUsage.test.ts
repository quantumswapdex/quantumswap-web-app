import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Regression guard: none of the modules that build on-chain targets may import
 * the original `WQ_ADDRESS` / `FACTORY_ADDRESS` / `ROUTER_ADDRESS` constants
 * from `config/chain`. They must resolve the active release's addresses at call
 * time via `src/config/releases.ts`, otherwise switching releases would silently
 * keep using the original (Beta 2) deployment.
 *
 * This is a source-level audit (reads file text) so it catches a re-introduced
 * compile-time import even when the offending code path isn't exercised at test
 * time. Whitelisted: `config/releases.ts` (defines Beta 2 from the constants)
 * and `config/chain.ts` (defines the constants) — both legitimately reference them.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const AUDITED: string[] = [
  "./swap.ts",
  "./addLiquidity.ts",
  "./removeLiquidity.ts",
  "./createPair.ts",
  "./shared.ts",
  "./settings.ts",
  "./poolExplorer.ts",
  "./pairDetail.ts",
  "../lib/contracts.ts",
  "../lib/routeFinder.ts",
  "../tokens/tokenList.ts",
];

const FORBIDDEN = /\b(?:WQ_ADDRESS|FACTORY_ADDRESS|ROUTER_ADDRESS)\b/;

describe("no view/lib imports the original release address constants", () => {
  for (const rel of AUDITED) {
    it(`${rel} does not import WQ_ADDRESS/FACTORY_ADDRESS/ROUTER_ADDRESS`, () => {
      const file = path.resolve(HERE, rel);
      const src = readFileSync(file, "utf8");
      expect(FORBIDDEN.test(src)).toBe(false);
    });
  }
});

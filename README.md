# QuantumSwap Web App (Beta / Test Version)

A decentralized exchange (DEX) front end for the **QuantumCoin** network. QuantumSwap
lets you swap tokens, provide liquidity, create pairs, and explore pools directly
from the browser — every read and every transaction flows through the **QuantumSwap
browser extension**, so the app is fully self-custodial and never talks to a
third-party RPC or scan API.

Built with **Vite + vanilla TypeScript** (no UI framework) and a small hand-rolled
UI layer: a type-safe, XSS-safe DOM builder, a hash router, and a minimal pub/sub
store. The only runtime dependencies are the `quantumcoin` and `quantumswap` SDKs.

> **Beta / Test Version.** This software is provided without warranty. Always verify
> contract addresses before trading. Use at your own risk.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Running Locally](#running-locally)
- [Building for Production](#building-for-production)
- [Testing & Quality Checks](#testing--quality-checks)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Design](#design)
- [Security](#security)
- [Continuous Integration](#continuous-integration)
- [Links](#links)
- [Disclaimer](#disclaimer)

## Features

QuantumSwap serves two kinds of users:

**Traders**
- **Swap** tokens with live quotes, price impact, minimum-received, a 0.30% LP fee,
  and route display.
- Native **Q ⇄ WQ** wrap/unwrap plus the wrapped-native (`*ETH`-style) router
  variants where applicable.
- Configurable **slippage tolerance** plus an expert mode. The transaction deadline
  is fixed (chain block timestamp + a constant offset), matching the desktop wallet.

**Liquidity providers**
- **Add liquidity** with reserve-ratio autofill, pool-share preview, first-provider
  notices, and dual token approvals.
- **Create pairs** explicitly through the factory.
- **Remove liquidity** with a percentage slider and LP-token approval.

**Explore & manage**
- **Pool Explorer** — a registry-driven table of pairs with live reserves, derived
  prices, and an optional full factory walk.
- **Pair detail** — reserves, both-direction prices, LP supply, and your position.
- **Token Explorer / detail** — default tokens plus any token you import by contract
  address, with default/unrecognized badges.
- **Positions** — your LP balances and underlying amounts across the registry.
- **Activity** — a local transaction history reconciled via receipts, with block
  explorer links.
- **Global search** — look up a token or pair by address or name/symbol.

Only default-list tokens are shown out of the box. Additional tokens can be imported
by pasting a contract address; imports are sanitized, filtered against
stablecoin-style names/symbols, and gated behind a mandatory acknowledge-before-add
warning.

## Tech Stack

- **Build tool:** [Vite](https://vitejs.dev/) (dev server + bundler; build-time only)
- **Language:** TypeScript (strict)
- **UI:** Vanilla TypeScript — a type-safe DOM builder, hash router, and pub/sub store
- **Styling:** Hand-written CSS (`src/index.css`, ported 1:1 from the design
  previews in `preview/`) with self-hosted Inter / Space Grotesk fonts — no CSS
  framework
- **SDKs (runtime deps):** `quantumcoin`, `quantumswap`
- **Testing:** [Vitest](https://vitest.dev/) (jsdom)
- **Linting:** ESLint + `@typescript-eslint`

The heavy, WASM-backed `quantumcoin` SDK is code-split into its own chunk, and a
byte-accurate preloader (`QuantumSwap Web App is loading...`) streams each asset for
an honest progress bar on first load.

## Prerequisites

- **Node.js `>= 20`** and npm.
- The **QuantumSwap browser extension** installed and unlocked. The app detects the
  extension's provider (`window.quantumcoin`); without it you will see an install
  prompt. Get it from the
  [Chrome Web Store](https://chromewebstore.google.com/detail/quantumswap-browser-exten/blpcmbhbgnmhfgfbejmgokfofobodghk).

## Getting Started

Clone the repository and install dependencies:

```bash
git clone https://github.com/quantumswapdex/quantumswap-web-app.git
cd quantumswap-web-app
npm install
```

## Running Locally

Start the Vite dev server (hot module reload):

```bash
npm run dev
```

Then open the printed URL (default <http://localhost:5173>) in a browser that has the
QuantumSwap extension installed. Connect your wallet when prompted to enable on-chain
reads and transactions.

## Building for Production

Type-check and produce an optimized, self-contained bundle in `dist/`:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

The output in `dist/` is fully static and can be served from any static host — all
CSS, fonts, images, and the app icon are bundled; there are no external CDN, font,
or image requests at runtime, and all chain traffic goes through the extension.

## Testing & Quality Checks

```bash
npm test              # run the Vitest unit suite once
npm run test:watch    # run unit tests in watch mode
npm run lint          # ESLint (fails on any warning)
npm run check:naming  # CI guard: no banned references or unsafe HTML sinks
npm run test:e2e:install # one-time: download the Playwright browser
npm run test:e2e      # Playwright: build + preview + navigate every page
```

Unit tests (Vitest) cover the pure logic: stablecoin filtering, address/amount
sanitization, slippage/deadline/quote math, formatting, and pair-registry
merge/dedupe (the extension provider is mocked).

End-to-end tests (Playwright) run against the **production build** in a real
(Chromium) browser. They inject a stub provider that reports the extension as
installed but **not connected**, then navigate every page and assert the app shell
mounts, each view renders, and there are no uncaught exceptions or console errors —
guarding against bundling/chunk-initialization regressions.

## Project Structure

```text
quantumswap-web-app/
├─ index.html                # Entry HTML + inline byte-accurate preloader + CSP
├─ src/
│  ├─ main.ts                # Bootstrap: init SDK, wallet, stores, shell, routes
│  ├─ index.css              # Full app stylesheet (ported from preview/preview.css)
│  ├─ config/                # chain.ts (addresses/network/tokens), pairs seed, settings
│  ├─ lib/                   # extensionProvider, tx, contracts, sanitize, quoteMath, ...
│  ├─ wallet/                # wallet connection + account state
│  ├─ tokens/                # token list, selector, import warning
│  ├─ search/                # global address / name-symbol search
│  ├─ theme/                 # route theme metadata (data-theme attribute)
│  ├─ ui/                    # dom builder, router, store, components
│  └─ views/                 # swap (front page), pools, liquidity, explorers, activity, settings
├─ scripts/check-naming.mjs  # CI naming/HTML-sink guard
└─ .github/workflows/publish.yml  # lint / test / build + dist artifact
```

## Configuration

Network, contract addresses, default tokens, and the extension install URL live in
[`src/config/chain.ts`](src/config/chain.ts):

- **Network:** `MAINNET`, chain id `123123`.
- **Core contracts:** Factory, Router, and Wrapped Q (WQ) — also shown in-app under
  **Settings → Contracts**.
- **Default tokens:** the built-in list; other tokens require a manual,
  warned import.
- **Extension install URL:**
  <https://chromewebstore.google.com/detail/quantumswap-browser-exten/blpcmbhbgnmhfgfbejmgokfofobodghk>.

> **Note on addresses:** QuantumCoin addresses are **32 bytes** (`0x` + 64 hex
> characters). All validation and pair-existence checks use the 32-byte format via
> the `quantumcoin` SDK — 20-byte Ethereum-style addresses are rejected.

## Design

The UI follows a single dark "Quantum Violet" design across all pages: a
near-black canvas with contained violet/cyan ambient orbs, a translucent top
bar (brand / global search / address chip / network pill / burger menu), and
gradient panels with a violet glow. The stylesheet is a 1:1 port of the
approved static previews in `preview/`, and the fonts (Inter for body text,
Space Grotesk for headlines) are self-hosted so the strict CSP holds.

On small screens (≤ 720px) the search collapses into a toggle below the top
bar and the address chip + network badge move into the burger menu.

## Security

Defense-in-depth is built in:

- **Safe-by-construction DOM builder** — dynamic values are written via `textContent`
  only. `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/
  `new Function` are banned by ESLint and a CI grep.
- **Input sanitization** — addresses and amounts are validated with the `quantumcoin`
  SDK; control, zero-width, and bidirectional characters are stripped.
- **Response sanitization** — untrusted RPC responses are type-checked, bounded, and
  normalized; token names/symbols are truncated and always rendered as text.
- **Strict Content-Security-Policy** — same-origin assets only; `object-src 'none'`,
  `connect-src 'self'`.
- **Self-custodial by design** — the app holds no keys; every transaction is signed
  in the QuantumSwap extension.

## Continuous Integration

[`.github/workflows/ci.yml`](.github/workflows/publish.yml) runs on push, pull request,
and manual dispatch (Node 20). It installs dependencies with `npm ci`, runs the
naming/HTML-sink guard, lint, unit tests, and the build, then uploads the `dist/`
folder as a build artifact (`quantumswap-web-app-<sha>`).

## Links

- QuantumSwap: <https://quantumswap.com>
- QuantumSwap browser extension:
  <https://chromewebstore.google.com/detail/quantumswap-browser-exten/blpcmbhbgnmhfgfbejmgokfofobodghk>
- QuantumCoin: <https://quantumcoin.org>

## Disclaimer

QuantumSwap Web App is a beta/test release provided "as is", without warranty of any
kind. It is not affiliated with any centralized exchange. Decentralized trading and
liquidity provision carry financial risk, including impermanent loss and total loss
of funds. Always verify contract addresses and review each transaction in your wallet
before signing.

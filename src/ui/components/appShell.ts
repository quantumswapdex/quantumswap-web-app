/**
 * App shell, 1:1 with the approved preview markup (preview/frontpage-preview.html):
 * top bar (brand / centered search / address chip with tooltip + account dialog /
 * network pill / burger menu), the routed <main> outlet, and the constant footer.
 * Mobile (<=720px, handled in CSS): logo + search toggle + burger only; the
 * address and network move into the burger menu; the search drops below the bar.
 */

import { el } from "../dom";
import { orbs } from "./orbs";
import { copyIcon, menuIcon, openIcon, powerIcon, searchIcon } from "./icons";
import { copyToClipboard } from "./addressPill";
import { shortAddress } from "../../lib/format";
import { CHAIN_ID, NETWORK_NAME, explorerAddressUrl } from "../../config/chain";
import { currentRelease, isCustomActive, releaseStore } from "../../config/releases";
import {
  connectWallet,
  disconnectWallet,
  isWrongNetwork,
  walletStore,
  type WalletState,
} from "../../wallet/wallet";
import { sanitizeQuery } from "../../lib/sanitize";
import { openGlobalSearch, searchPreview, type SearchPreviewItem } from "../../search/search";
import { showToast } from "./toast";

const DOWNLOAD_WALLET_URL = "https://quantumswap.com/downloads.html";
const DOWNLOAD_BROWSER_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/quantumswap-browser-exten/blpcmbhbgnmhfgfbejmgokfofobodghk";

interface NavItem {
  label: string;
  href: string;
  match: (hash: string) => boolean;
}

// Home is the site root ("/"); the front page renders the swap view there.
const NAV: NavItem[] = [
  { label: "Home", href: "/", match: (h) => h === "#/" || h === "" || h === "#" },
  { label: "Swap", href: "#/swap", match: (h) => h.startsWith("#/swap") },
  { label: "Liquidity", href: "#/pools", match: (h) => h.startsWith("#/pools") },
  { label: "Pools", href: "#/explore/pools", match: (h) => h.startsWith("#/explore/pools") },
  { label: "Tokens", href: "#/explore/tokens", match: (h) => h.startsWith("#/explore/tokens") },
  { label: "Positions", href: "#/positions", match: (h) => h.startsWith("#/positions") },
  { label: "Activity", href: "#/activity", match: (h) => h.startsWith("#/activity") },
  { label: "Releases", href: "#/releases", match: (h) => h.startsWith("#/releases") },
];

export function createAppShell(): { root: HTMLElement; outlet: HTMLElement } {
  const outlet = el("div", { class: "outlet" });

  // ---------- Search ----------
  // Live search: debounce keystrokes, show a right-edge spinner while looking
  // up, and render preview results in a dropdown below the box. Clicking a
  // result (or pressing Enter) opens the full search results dialog.
  const SEARCH_DEBOUNCE_MS = 700;
  const searchSpinner = el("span", { class: "search-spin hidden", "aria-hidden": "true" });
  const searchDropdown = el("div", { class: "search-dd hidden", role: "listbox", "aria-label": "Search results" });
  let searchDebounce = 0;
  let searchSeq = 0;

  const searchInput = el("input", {
    type: "search",
    placeholder: "Search token or pair by address / name",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Global search",
    on: {
      keydown: (e: Event) => {
        if ((e as KeyboardEvent).key === "Enter") {
          const q = sanitizeQuery(searchInput.value);
          if (q) {
            closeSearchDropdown();
            setSearchOpen(false);
            openGlobalSearch(q);
          }
        }
      },
      input: () => {
        window.clearTimeout(searchDebounce);
        searchSeq++; // invalidate any in-flight lookup
        if (!sanitizeQuery(searchInput.value)) {
          closeSearchDropdown();
          return;
        }
        // Show the busy spinner right away so the user sees feedback during the
        // debounce window, not only after the lookup starts.
        searchSpinner.classList.remove("hidden");
        searchDebounce = window.setTimeout(() => void runLiveSearch(), SEARCH_DEBOUNCE_MS);
      },
    },
  }) as HTMLInputElement;
  const searchBox = el("div", { class: "search" }, searchIcon(16), searchInput, searchSpinner, searchDropdown);

  function closeSearchDropdown(): void {
    window.clearTimeout(searchDebounce);
    searchSeq++; // invalidate any in-flight lookup
    searchDropdown.classList.add("hidden");
    searchDropdown.replaceChildren();
    searchSpinner.classList.add("hidden");
  }

  async function runLiveSearch(): Promise<void> {
    const q = sanitizeQuery(searchInput.value);
    if (!q) {
      closeSearchDropdown();
      return;
    }
    const seq = ++searchSeq;
    searchSpinner.classList.remove("hidden");
    let items: SearchPreviewItem[] = [];
    try {
      items = await searchPreview(q);
    } catch {
      items = [];
    }
    if (seq !== searchSeq) return; // superseded by newer input
    searchSpinner.classList.add("hidden");
    searchDropdown.replaceChildren();
    if (items.length === 0) {
      searchDropdown.appendChild(
        el("div", { class: "search-dd-empty" }, "No known tokens or pairs match. Press Enter to search on-chain."),
      );
    } else {
      for (const item of items.slice(0, 8)) {
        searchDropdown.appendChild(
          el(
            "button",
            {
              class: "search-dd-row",
              role: "option",
              on: {
                click: () => {
                  closeSearchDropdown();
                  setSearchOpen(false);
                  openGlobalSearch(q);
                },
              },
            },
            el("span", { class: "sd-sym" }, item.label),
            el("span", { class: "sd-name" }, item.detail),
          ),
        );
      }
    }
    searchDropdown.classList.remove("hidden");
  }

  const searchToggle = el(
    "button",
    {
      class: "search-toggle",
      "aria-label": "Search",
      "aria-expanded": "false",
      on: {
        click: (e: Event) => {
          e.stopPropagation();
          const open = !searchBox.classList.contains("mobile-open");
          setSearchOpen(open);
          if (open) {
            setMenuOpen(false);
            setAddrOpen(false);
            searchInput.focus();
          }
        },
      },
    },
    searchIcon(19),
  );

  function setSearchOpen(open: boolean): void {
    searchBox.classList.toggle("mobile-open", open);
    searchToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---------- Address chip + tooltip + account dialog ----------
  const addrBtn = el(
    "button",
    {
      class: "addr",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      on: {
        click: (e: Event) => {
          e.stopPropagation();
          setAddrOpen(!addrWrap.classList.contains("pop-open"));
        },
      },
    },
    "",
    el("span", { class: "caret" }),
  );
  const addrTip = el("span", { class: "addr-tip", role: "tooltip" });
  const fullAddrEl = el("div", { class: "full-addr" });

  const copyBtn = el(
    "button",
    {
      class: "copy-btn",
      on: {
        click: () => {
          const account = walletStore.get().account;
          if (!account) return;
          copyToClipboard(account);
          const label = copyBtn.lastChild;
          if (label) label.textContent = " Copied!";
          window.setTimeout(() => {
            if (label) label.textContent = " Copy";
          }, 1200);
        },
      },
    },
    copyIcon(13),
    " Copy",
  );
  const explorerLink = el(
    "a",
    { class: "explorer-btn", href: "#", target: "_blank", rel: "noopener noreferrer" },
    openIcon(13),
    " View",
  ) as HTMLAnchorElement;
  const disconnectBtn = el(
    "button",
    {
      class: "disconnect-btn",
      on: {
        click: () => {
          setAddrOpen(false);
          void disconnectWallet();
        },
      },
    },
    powerIcon(13),
    " Disconnect",
  );

  const addrPop = el(
    "div",
    { class: "addr-pop", role: "dialog", "aria-label": "Connected address" },
    el(
      "div",
      { class: "pop-head" },
      el("span", { class: "pop-title" }, "Connected address"),
      el("button", { class: "pop-close", "aria-label": "Close", on: { click: () => setAddrOpen(false) } }, "\u2715"),
    ),
    fullAddrEl,
    el("div", { class: "pop-actions" }, copyBtn, explorerLink, disconnectBtn),
  );

  const addrWrap = el("div", { class: "addr-wrap" }, addrBtn, addrTip, addrPop);

  function setAddrOpen(open: boolean): void {
    addrWrap.classList.toggle("pop-open", open);
    addrBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // Connect button shown in place of the address chip when not connected.
  const connectBtn = el(
    "button",
    {
      class: "btn btn-primary",
      on: {
        click: () => {
          connectWallet().catch((err) =>
            showToast({ kind: "error", title: "Connect failed", message: errText(err), autoDismissMs: 6000 }),
          );
        },
      },
    },
    "Connect wallet",
  );

  // ---------- Network pill ----------
  const netPill = el("span", { class: "net" }, el("i", { class: "dot" }), `${NETWORK_NAME} ${CHAIN_ID}`);

  // ---------- Burger menu ----------
  const mAddrItem = el(
    "button",
    {
      class: "m-item m-addr",
      on: {
        click: (e: Event) => {
          e.stopPropagation();
          setMenuOpen(false);
          setAddrOpen(true);
        },
      },
    },
    "",
    el("span", { class: "caret-r" }),
  );
  const mConnectItem = el("div", { class: "m-item" }, connectBtnClone());
  function connectBtnClone(): HTMLElement {
    return el(
      "button",
      {
        class: "btn btn-primary w-full",
        on: {
          click: () => {
            setMenuOpen(false);
            connectWallet().catch((err) =>
              showToast({ kind: "error", title: "Connect failed", message: errText(err), autoDismissMs: 6000 }),
            );
          },
        },
      },
      "Connect wallet",
    );
  }
  const mNetItem = el("div", { class: "m-item m-net" }, el("i", { class: "dot" }), `${NETWORK_NAME} ${CHAIN_ID}`);

  const navLinks = NAV.map((item) => el("a", { href: item.href, dataset: { nav: item.href } }, item.label));
  const [homeLink, ...pageLinks] = navLinks;
  // "Releases" is the last NAV entry; pull it out so a separator can sit above
  // it in the burger menu. It remains in `navLinks` for active-link highlighting.
  const releasesLink = pageLinks.pop() ?? navLinks[navLinks.length - 1];
  const settingsLink = el("a", { href: "#/settings", dataset: { nav: "#/settings" } }, "Settings");

  const burgerMenu = el(
    "nav",
    { class: "burger-menu" },
    mAddrItem,
    mConnectItem,
    el("div", { class: "sep m-sep" }),
    mNetItem,
    el("div", { class: "sep m-sep" }),
    homeLink,
    el("div", { class: "sep" }),
    ...pageLinks,
    el("div", { class: "sep" }),
    releasesLink,
    el("div", { class: "sep" }),
    el("a", { href: DOWNLOAD_WALLET_URL, target: "_blank", rel: "noopener noreferrer" }, "Download Wallet"),
    el(
      "a",
      { href: DOWNLOAD_BROWSER_EXTENSION_URL, target: "_blank", rel: "noopener noreferrer" },
      "Browser Extension",
    ),
    settingsLink,
  );
  burgerMenu.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
  });

  const burger = el(
    "button",
    {
      class: "burger",
      "aria-label": "Menu",
      "aria-expanded": "false",
      on: {
        click: (e: Event) => {
          e.stopPropagation();
          const open = !burgerMenu.classList.contains("open");
          setMenuOpen(open);
          if (open) {
            setSearchOpen(false);
            setAddrOpen(false);
          }
        },
      },
    },
    menuIcon(24),
  );

  function setMenuOpen(open: boolean): void {
    burgerMenu.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function highlightNav(): void {
    const hash = location.hash || "#/";
    [...navLinks, settingsLink].forEach((link) => {
      const nav = link.dataset.nav ?? "";
      const item = NAV.find((n) => n.href === nav);
      const active = item ? item.match(hash) : hash.startsWith(nav);
      link.classList.toggle("active", active);
    });
  }
  window.addEventListener("hashchange", () => {
    highlightNav();
    setMenuOpen(false);
    setAddrOpen(false);
    setSearchOpen(false);
    closeSearchDropdown();
  });

  // Outside click / Escape close all floating layers.
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!burgerMenu.contains(t) && t !== burger) setMenuOpen(false);
    if (!addrWrap.contains(t)) setAddrOpen(false);
    if (!searchBox.contains(t) && !searchToggle.contains(t)) {
      setSearchOpen(false);
      closeSearchDropdown();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setMenuOpen(false);
      setAddrOpen(false);
      setSearchOpen(false);
      closeSearchDropdown();
    }
  });

  // ---------- Header / footer / root assembly ----------
  const header = el(
    "header",
    { class: "topbar" },
    el(
      "a",
      { class: "brand", href: "/", "aria-label": "QuantumSwap home" },
      el("span", { class: "logo" }, el("img", { src: "/logo-128.png", width: "30", height: "30", alt: "QuantumSwap logo" })),
      el("span", { class: "wordmark" }, "Quantum", el("span", { class: "accent" }, "Swap")),
      el("span", { class: "beta" }, "Beta"),
    ),
    searchBox,
    el("div", { class: "actions" }, searchToggle, addrWrap, connectBtn, netPill, el("div", { class: "menu-wrap" }, burger, burgerMenu)),
  );

  const wrongNetworkBar = el("div", { class: "hidden" });
  const customReleaseBar = el("div", { class: "hidden" });
  const main = el("main", {}, outlet, el("p", { class: "foot" }, "QuantumSwap Web App (Beta / Test Version)"));

  const root = el("div", { class: "app" }, orbs(), header, customReleaseBar, wrongNetworkBar, main);

  function renderAccount(state: WalletState): void {
    const connected = state.status === "connected" && Boolean(state.account);
    if (connected) {
      const account = state.account as string;
      // Chip label: short address + caret.
      addrBtn.replaceChildren(shortAddress(account), el("span", { class: "caret" }));
      addrTip.textContent = account;
      fullAddrEl.textContent = account;
      explorerLink.setAttribute("href", explorerAddressUrl(account));
      mAddrItem.replaceChildren(shortAddress(account), el("span", { class: "caret-r" }));
    } else {
      setAddrOpen(false);
    }
    addrWrap.classList.toggle("hidden", !connected);
    mAddrItem.classList.toggle("hidden", !connected);
    connectBtn.classList.toggle("hidden", connected);
    mConnectItem.classList.toggle("hidden", connected);

    // Wrong-network guard.
    if (isWrongNetwork(state)) {
      wrongNetworkBar.setAttribute("class", "wrongnet");
      wrongNetworkBar.replaceChildren(
        `Wrong network detected (chain ${state.chainId ?? "?"}). Switch the QuantumSwap extension to ${NETWORK_NAME} (${CHAIN_ID}).`,
      );
    } else {
      wrongNetworkBar.setAttribute("class", "hidden");
      wrongNetworkBar.replaceChildren();
    }
  }

  function renderReleaseBanner(): void {
    if (isCustomActive()) {
      customReleaseBar.setAttribute("class", "customrel");
      customReleaseBar.replaceChildren(`You are using custom contracts: ${currentRelease().name}`);
    } else {
      customReleaseBar.setAttribute("class", "hidden");
      customReleaseBar.replaceChildren();
    }
  }

  walletStore.subscribe(renderAccount, true);
  releaseStore.subscribe(renderReleaseBanner, true);
  highlightNav();

  return { root, outlet };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

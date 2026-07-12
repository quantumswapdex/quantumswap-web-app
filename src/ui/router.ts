/**
 * Tiny hash-based router. Works on any static host (no server rewrites needed).
 * Maps patterns like `#/explore/pools/:pairAddress` to view factories, parses
 * route params, sets the per-route document title + data-theme, and runs a
 * cleanup hook when navigating away so views can drop subscriptions.
 */

import { clear } from "./dom";
import { setRouteTheme } from "../theme/theme";

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

export interface ViewResult {
  node: Node;
  cleanup?: () => void;
  theme?: string;
  title?: string;
}

export type ViewFactory = (ctx: RouteContext) => ViewResult | Node;

interface Route {
  segments: string[];
  factory: ViewFactory;
  theme?: string;
  title?: string;
}

const TITLE_SUFFIX = "QuantumSwap Web App (Beta/Test Version)";

export class Router {
  private routes: Route[] = [];
  private notFound: ViewFactory | null = null;
  private outlet: HTMLElement | null = null;
  private currentCleanup: (() => void) | null = null;
  private started = false;

  add(pattern: string, factory: ViewFactory, opts?: { theme?: string; title?: string }): this {
    this.routes.push({
      segments: normalize(pattern),
      factory,
      theme: opts?.theme,
      title: opts?.title,
    });
    return this;
  }

  setNotFound(factory: ViewFactory): this {
    this.notFound = factory;
    return this;
  }

  start(outlet: HTMLElement): void {
    this.outlet = outlet;
    if (!this.started) {
      window.addEventListener("hashchange", () => this.render());
      this.started = true;
    }
    if (!location.hash) {
      location.replace("#/");
      return;
    }
    this.render();
  }

  navigate(path: string): void {
    const target = path.startsWith("#") ? path : "#" + (path.startsWith("/") ? path : "/" + path);
    if (location.hash === target) {
      this.render();
    } else {
      location.hash = target;
    }
  }

  private render(): void {
    if (!this.outlet) return;
    const raw = location.hash.replace(/^#/, "") || "/";
    const [pathPart, queryPart] = raw.split("?");
    const query = new URLSearchParams(queryPart || "");
    const pathSegments = normalize(pathPart);

    let matched: { route: Route; params: Record<string, string> } | null = null;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, pathSegments);
      if (params) {
        matched = { route, params };
        break;
      }
    }

    if (this.currentCleanup) {
      try {
        this.currentCleanup();
      } catch {
        /* ignore cleanup errors */
      }
      this.currentCleanup = null;
    }

    const ctx: RouteContext = { params: matched?.params ?? {}, query, path: pathPart };
    const factory = matched?.route.factory ?? this.notFound;
    if (!factory) return;

    let result: ViewResult | Node;
    try {
      result = factory(ctx);
    } catch (err) {
      result = errorNode(err);
    }

    const view: ViewResult = result instanceof Node ? { node: result } : result;
    this.currentCleanup = view.cleanup ?? null;

    const theme = view.theme ?? matched?.route.theme;
    if (theme) setRouteTheme(theme);

    const title = view.title ?? matched?.route.title;
    document.title = title ? `${title} - ${TITLE_SUFFIX}` : TITLE_SUFFIX;

    clear(this.outlet);
    this.outlet.appendChild(view.node);
    this.outlet.scrollTop = 0;
    window.scrollTo(0, 0);
  }
}

function normalize(pattern: string): string[] {
  return pattern
    .replace(/^#/, "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function matchSegments(routeSegs: string[], pathSegs: string[]): Record<string, string> | null {
  if (routeSegs.length !== pathSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegs.length; i++) {
    const rs = routeSegs[i];
    const ps = pathSegs[i];
    if (rs.startsWith(":")) {
      params[rs.slice(1)] = decodeURIComponent(ps);
    } else if (rs !== ps) {
      return null;
    }
  }
  return params;
}

function errorNode(err: unknown): Node {
  const div = document.createElement("div");
  div.className = "panel state error";
  div.textContent = "Something went wrong rendering this page: " + errorMessage(err);
  return div;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

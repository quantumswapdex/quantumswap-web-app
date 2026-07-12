/**
 * Inline SVG icons matching the preview mockups. Path data is fixed (no user
 * input) and every node is built with createElementNS + setAttribute - no HTML
 * sinks.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

interface SvgOpts {
  viewBox?: string;
  stroke?: string | null;
  strokeWidth?: string;
  linejoin?: boolean;
}

function svg(size: number, opts: SvgOpts, ...shapes: SVGElement[]): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", opts.viewBox ?? "0 0 24 24");
  node.setAttribute("width", String(size));
  node.setAttribute("height", String(size));
  node.setAttribute("fill", "none");
  if (opts.stroke !== null) {
    node.setAttribute("stroke", opts.stroke ?? "currentColor");
    node.setAttribute("stroke-width", opts.strokeWidth ?? "2");
    node.setAttribute("stroke-linecap", "round");
    if (opts.linejoin) node.setAttribute("stroke-linejoin", "round");
  }
  node.setAttribute("aria-hidden", "true");
  for (const s of shapes) node.appendChild(s);
  return node;
}

function shape(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function line(x1: number, y1: number, x2: number, y2: number): SVGElement {
  return shape("line", { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) });
}

function circle(cx: number, cy: number, r: number, attrs: Record<string, string> = {}): SVGElement {
  return shape("circle", { cx: String(cx), cy: String(cy), r: String(r), ...attrs });
}

function polyline(points: string): SVGElement {
  return shape("polyline", { points });
}

function path(d: string, attrs: Record<string, string> = {}): SVGElement {
  return shape("path", { d, ...attrs });
}

/** Magnifying glass (top-bar search). */
export function searchIcon(size = 16): SVGSVGElement {
  return svg(size, { stroke: "#fff" }, circle(11, 11, 7), line(21, 21, 16.65, 16.65));
}

/** Three-line burger menu. */
export function menuIcon(size = 24): SVGSVGElement {
  return svg(size, { stroke: "#fff", strokeWidth: "2.2" }, line(3, 6, 21, 6), line(3, 12, 21, 12), line(3, 18, 21, 18));
}

/** Down-facing chevron (token button). */
export function chevronDownIcon(size = 14, cls = ""): SVGSVGElement {
  const node = svg(size, { stroke: "#fff" }, polyline("6 9 12 15 18 9"));
  if (cls) node.setAttribute("class", cls);
  return node;
}

/** Bidirectional flip arrows (swap direction). */
export function flipIcon(size = 18): SVGSVGElement {
  return svg(
    size,
    { stroke: "#fff", linejoin: true },
    line(8, 20, 8, 5),
    polyline("4 9 8 5 12 9"),
    line(16, 4, 16, 19),
    polyline("12 15 16 19 20 15"),
  );
}

/** Settings gear (swap card header). */
export function gearIcon(size = 18): SVGSVGElement {
  return svg(
    size,
    { strokeWidth: "1.8" },
    circle(12, 12, 3),
    path(
      "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    ),
  );
}

/** Copy-to-clipboard. */
export function copyIcon(size = 13): SVGSVGElement {
  return svg(
    size,
    { linejoin: true },
    shape("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
    path("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"),
  );
}

/** Open-in-explorer (open.svg from quantumswap-wallet-desktop, currentColor). */
export function openIcon(size = 13): SVGSVGElement {
  return svg(
    size,
    { viewBox: "0 0 512 512", stroke: null },
    path(
      "M224,304a16,16,0,0,1-11.31-27.31L370.63,118.75A55.7,55.7,0,0,0,344,112H104a56.06,56.06,0,0,0-56,56V408a56.06,56.06,0,0,0,56,56H344a56.06,56.06,0,0,0,56-56V168a55.7,55.7,0,0,0-6.75-26.63L235.31,299.31A15.92,15.92,0,0,1,224,304Z",
      { stroke: "currentColor", "stroke-width": "18", "stroke-linejoin": "round", fill: "currentColor" },
    ),
    path("M448,48H336a16,16,0,0,0,0,32h73.37l-38.74,38.75a56.35,56.35,0,0,1,22.62,22.62L432,102.63V176a16,16,0,0,0,32,0V64A16,16,0,0,0,448,48Z", {
      fill: "currentColor",
    }),
  );
}

/** Power (disconnect). */
export function powerIcon(size = 13): SVGSVGElement {
  return svg(size, { linejoin: true }, path("M18.36 6.64a9 9 0 1 1-12.73 0"), line(12, 2, 12, 12));
}

/** Down arrow (confirm-swap dialog). */
export function arrowDownIcon(size = 16): SVGSVGElement {
  return svg(size, { linejoin: true }, line(12, 5, 12, 19), polyline("19 12 12 19 5 12"));
}

/** Generic two-tone coin mark used for token buttons (per-symbol colors). */
const COIN_COLORS: Record<string, [string, string]> = {
  Q: ["#8b6cff", "#6c3bff"],
  WQ: ["#4fd8ef", "#00e5ff"],
};

function coinColors(symbol: string): [string, string] {
  const known = COIN_COLORS[symbol.toUpperCase()];
  if (known) return known;
  // Deterministic hue from the symbol so each token keeps a stable color.
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return [`hsl(${h} 70% 70%)`, `hsl(${h} 85% 55%)`];
}

export function coinIcon(symbol: string, size = 24): SVGSVGElement {
  const [ring, core] = coinColors(symbol);
  return svg(
    size,
    { viewBox: "0 0 28 28", stroke: null },
    circle(14, 14, 11, { stroke: ring, "stroke-width": "2.2", opacity: "0.9" }),
    circle(14, 14, 4.4, { fill: core }),
  );
}

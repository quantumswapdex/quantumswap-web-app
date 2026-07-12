/**
 * Type-safe, XSS-safe DOM builder.
 *
 * Every dynamic value is written through `textContent` / `createTextNode` or a
 * strict attribute setter - this module never touches `innerHTML`, so untrusted
 * token names, addresses, and RPC responses cannot inject markup or scripts.
 * Event handlers are bound via `addEventListener`, never inline `on*` strings.
 */

export type Child = Node | string | number | null | undefined | false;

type StyleMap = Partial<Record<string, string>>;

export interface ElProps {
  /** CSS class(es). `class` and `className` are equivalent. */
  class?: string;
  className?: string;
  /** Sets element text safely via textContent. */
  text?: string | number;
  /** data-* attributes. */
  dataset?: Record<string, string | number | boolean | undefined>;
  /** Inline styles (object form). */
  style?: StyleMap;
  /** Event listeners, e.g. { click: (e) => ... }. */
  on?: Partial<Record<string, EventListenerOrEventListenerObject>>;
  /** Any other attribute (validated for href/src). */
  [key: string]: unknown;
}

const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

/** Validate a URL for href/src; blocks javascript:, data:text/html, etc. */
export function safeUrl(value: string): string {
  const v = value.trim();
  if (SAFE_URL.test(v)) return v;
  return "#";
}

function applyAttr(node: HTMLElement, key: string, value: unknown): void {
  if (value === null || value === undefined || value === false) return;

  if (key === "class" || key === "className") {
    node.setAttribute("class", String(value));
    return;
  }
  if (key === "text") {
    node.textContent = String(value);
    return;
  }
  if (key === "dataset") {
    const ds = value as Record<string, string | number | boolean | undefined>;
    for (const [dk, dv] of Object.entries(ds)) {
      if (dv === undefined || dv === false) continue;
      node.dataset[dk] = String(dv);
    }
    return;
  }
  if (key === "style") {
    const styles = value as StyleMap;
    for (const [sk, sv] of Object.entries(styles)) {
      if (sv === undefined) continue;
      node.style.setProperty(hyphenate(sk), sv);
    }
    return;
  }
  if (key === "on") {
    const handlers = value as Partial<Record<string, EventListenerOrEventListenerObject>>;
    for (const [ev, fn] of Object.entries(handlers)) {
      if (fn) node.addEventListener(ev, fn);
    }
    return;
  }
  // Reject any inline event-handler attribute outright.
  if (/^on/i.test(key)) return;

  if (key === "href" || key === "src") {
    node.setAttribute(key, safeUrl(String(value)));
    return;
  }
  if (key === "value") {
    // Form values are a property, not just an attribute.
    (node as HTMLInputElement).value = String(value);
    return;
  }
  if (value === true) {
    node.setAttribute(key, "");
    return;
  }
  node.setAttribute(key, String(value));
}

function hyphenate(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

export function appendChild(node: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (typeof child === "string" || typeof child === "number") {
    node.appendChild(document.createTextNode(String(child)));
    return;
  }
  node.appendChild(child);
}

/** Create an element with safe props + children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      applyAttr(node, key, value);
    }
  }
  for (const child of children) appendChild(node, child);
  return node;
}

/** Create a text node. */
export function text(value: string | number): Text {
  return document.createTextNode(String(value));
}

/** Create a document fragment from children. */
export function fragment(...children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) appendChild(frag, child);
  return frag;
}

/** Remove all children from a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's children with new content. */
export function mount(root: Node, ...children: Child[]): void {
  clear(root);
  for (const child of children) appendChild(root, child);
}

/** Conditionally render a node. */
export function when(cond: unknown, node: () => Child): Child {
  return cond ? node() : null;
}

/** Map a list to nodes. */
export function each<T>(items: readonly T[], render: (item: T, index: number) => Child): DocumentFragment {
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => appendChild(frag, render(item, i)));
  return frag;
}

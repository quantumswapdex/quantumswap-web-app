#!/usr/bin/env node
/**
 * CI guard: fail the build if application source uses a banned raw-HTML sink.
 * Scans src/ and index.html only (never node_modules or the vendored SDK ABIs,
 * which legitimately contain provider revert strings).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src"];
const SCAN_FILES = ["index.html"];
const EXTS = new Set([".ts", ".js", ".mjs", ".css", ".html", ".json"]);

const BANNED = [
  { re: /\.innerHTML\b/, label: "innerHTML sink" },
  { re: /\.outerHTML\b/, label: "outerHTML sink" },
  { re: /insertAdjacentHTML/, label: "insertAdjacentHTML sink" },
  { re: /document\.write\b/, label: "document.write sink" },
  { re: /\beval\s*\(/, label: "eval() call" },
  { re: /new\s+Function\s*\(/, label: "new Function() call" },
];

const problems = [];

function scanFile(path) {
  if (!EXTS.has(extname(path))) return;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { re, label } of BANNED) {
      if (re.test(line)) {
        problems.push(`${path}:${i + 1}  ${label}  ->  ${line.trim().slice(0, 120)}`);
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else scanFile(full);
  }
}

for (const dir of SCAN_DIRS) {
  try {
    walk(join(ROOT, dir));
  } catch {
    /* dir may not exist */
  }
}
for (const file of SCAN_FILES) {
  try {
    scanFile(join(ROOT, file));
  } catch {
    /* file may not exist */
  }
}

if (problems.length > 0) {
  console.error("check-naming failed:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("check-naming passed: no banned references or HTML sinks in app source.");

/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import path from "node:path";

// Injects the emitted JS/CSS chunk URLs and their byte sizes into index.html as
// `window.__QS_CHUNKS__`, so the preloader bootstrap can stream-download each
// file and report byte-accurate progress. In dev (no bundle) it injects nothing
// and the bootstrap falls back to resource-timing / indeterminate progress.
function qsPreloaderChunks(): Plugin {
  return {
    name: "qs-preloader-chunks",
    // `order: "post"` runs after the bundle is generated so `ctx.bundle` is
    // populated (required to compute per-chunk byte sizes for the preloader).
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const chunks: { url: string; bytes: number }[] = [];
        for (const file of Object.values(bundle)) {
          if (file.fileName.endsWith(".js") || file.fileName.endsWith(".css")) {
            const bytes =
              file.type === "chunk"
                ? Buffer.byteLength(file.code)
                : typeof (file as { source?: unknown }).source === "string"
                  ? Buffer.byteLength((file as { source: string }).source)
                  : ((file as { source?: { length?: number } }).source?.length ?? 0);
            chunks.push({ url: "/" + file.fileName, bytes });
          }
        }
        const tag = `<script>window.__QS_CHUNKS__=${JSON.stringify(chunks)};</script>`;
        return html.replace("</head>", `${tag}</head>`);
      },
    },
  };
}

// The QuantumCoin SDK family is the only chain dependency. All third-party deps
// go into a SINGLE "sdk" chunk: `quantumswap` does `const { Contract } =
// require("quantumcoin")` at module top-level, so splitting the two into separate
// chunks creates a cross-chunk init cycle where `Contract` is undefined when the
// quantumswap chunk evaluates. Keeping them together lets Rollup order module
// initialization correctly (quantumcoin before quantumswap). The preloader still
// reports byte-accurate progress across the app + sdk + css chunks.
export default defineConfig({
  plugins: [qsPreloaderChunks()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2022",
    // The quantumcoin SDK inlines its WASM (~2.7 MB) as base64; this large chunk
    // is expected and is exactly why the byte-accurate preloader exists.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) return "sdk";
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});

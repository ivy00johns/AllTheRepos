import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/** Where `scripts/export-catalog.mjs` writes, and it is gitignored. */
const EXPORTED_CATALOG = ".atr-catalog.json";

/**
 * Dev-only: serve the exported catalog at `/__atr/catalog.json`.
 *
 * The browser bridge renders the app in a plain browser tab, and without this
 * it can only render its demo library. With an export present it renders the
 * catalog this machine actually holds, which is the whole point of looking at a
 * tab during development — and the file stays out of the source tree, served by
 * reading one path rather than by copying anything in.
 *
 * A missing file is a 404 that names the command that writes it. The bridge
 * treats any non-200 as "no export" and serves the demo library, so a checkout
 * that has never run the export behaves exactly as it did before this existed.
 */
export function exportedCatalogPlugin(file: string = EXPORTED_CATALOG): Plugin {
  return {
    name: "atr-exported-catalog",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__atr/catalog.json", (_req, res) => {
        try {
          const body = readFileSync(resolve(file));
          res.setHeader("content-type", "application/json");
          // Content, not an asset: an edited export has to show up on reload.
          res.setHeader("cache-control", "no-store");
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.setHeader("content-type", "text/plain");
          res.end(
            `No catalog export at ${resolve(file)}.\n` +
              "Run: node scripts/export-catalog.mjs\n",
          );
        }
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        // Multi-entry: the main process AND the scanner worker.
        // Output keys map to file names relative to outDir, so the worker
        // lands at `out/main/workers/scanner.worker.js` — exactly where
        // `resolveWorkerPath()` in src/main/services/scan.ts looks for it.
        input: {
          index: "src/main/index.ts",
          "workers/scanner.worker": "src/main/workers/scanner.worker.ts",
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@main": resolve("src/main"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: "src/preload/index.ts",
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
    plugins: [react(), exportedCatalogPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer"),
      },
    },
  },
});

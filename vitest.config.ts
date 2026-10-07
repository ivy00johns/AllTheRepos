import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config.
 *
 * Electron units live under `tests/unit/**` as `*.spec.ts`, plus any
 * co-located specs under `src/<shared|main|preload>/**`. The legacy Next.js
 * `*.test.ts` suite was removed with the stack in ATR-013.
 *
 * One config, one process. Projects are intentionally avoided because the
 * setup is single-fork (better-sqlite3 and the `sqlite-vec` extension don't
 * like worker isolation — an extension loads into one connection, not one
 * process).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.spec.ts",
      "tests/unit/**/*.spec.tsx",
      "src/shared/**/*.spec.ts",
      "src/main/**/*.spec.ts",
      "src/preload/**/*.spec.ts",
    ],
    exclude: [
      "node_modules/**",
      "out/**",
      "release/**",
      "dist/**",
      // The Playwright Electron E2E lives under tests/e2e but is driven by
      // playwright.electron.config.ts, not vitest.
      "tests/e2e/**",
    ],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    server: {
      deps: {
        external: [
          /better-sqlite3/,
          /find-git-repositories/,
          // A loadable SQLite extension plus its per-platform package, read from
          // disk and `dlopen`ed — never transformed.
          /sqlite-vec/,
          // Electron itself is not importable from vitest (no Electron runtime);
          // any handler test that touches `electron` should mock it. Externalise
          // so vitest never tries to transform the binary module.
          /^electron$/,
        ],
      },
    },
    coverage: {
      reporter: ["text", "json-summary"],
      include: [
        "src/shared/**/*.ts",
        "src/main/**/*.ts",
        "src/renderer/**/*.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@main": path.resolve(__dirname, "src/main"),
      // Phase 2 — needed so unit tests can import renderer-only modules
      // (e.g. the action registry, which is plain TS with no DOM deps).
      "@renderer": path.resolve(__dirname, "src/renderer"),
    },
  },
});

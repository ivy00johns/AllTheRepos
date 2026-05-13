import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — multi-glob for the Phase 0 migration.
 *
 * The existing Next.js suite under `tests/<actions|contract|db|git|search|tag>`
 * keeps using `*.test.ts(x)` and the node-default environment. Phase 0 adds
 * Electron-side units under `tests/unit/**` (and, indirectly, `src/main/**`,
 * `src/preload/**`, `src/shared/**` if those ever ship co-located specs).
 *
 * One config, one process. Two projects are intentionally avoided because
 * the existing setup is single-fork (better-sqlite3 + LanceDB don't like
 * worker isolation) and the new tests run fine under the same constraint.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      // Existing Next.js MVP suite (do not move — single source of regression
      // signal for the legacy backend).
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      // Phase 0 Electron units. `.spec.ts` is used so the new files are
      // visually distinct from the legacy `.test.ts` ones and easy to grep.
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
          /@lancedb/,
          // Electron itself is not importable from vitest (no Electron runtime);
          // any handler test that touches `electron` should mock it. Externalise
          // so vitest never tries to transform the binary module.
          /^electron$/,
        ],
      },
    },
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts", "src/shared/**/*.ts", "src/main/**/*.ts"],
      exclude: ["lib/types.ts", "lib/db/migrate.ts"],
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

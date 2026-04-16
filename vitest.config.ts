import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
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
        ],
      },
    },
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/types.ts", "lib/db/migrate.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

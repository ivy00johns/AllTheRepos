import { defineConfig, mergeConfig } from "vitest/config";
import path from "node:path";

import base from "./vitest.config";

/**
 * The ordinary suite, pointed at a platform the host is not.
 *
 * Identical to `vitest.config.ts` except for one setup file, and that is
 * deliberate: this run is only worth anything if it is otherwise the same suite
 * as the one that gates a push. `scripts/check-unit-platform.mjs` runs it,
 * supplies the platform, and reads the failures.
 *
 * Not part of `pnpm test`. This run is *expected* to fail in the cases it
 * documents, so wiring it into the default suite would mean either a permanently
 * red `pnpm test` or an exemption quiet enough to be useless. It runs where its
 * answer is a verdict: as its own step, under `pnpm unit-platform:check`.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      setupFiles: [
        path.resolve(__dirname, "tests", "setup", "other-platform.ts"),
      ],
    },
  }),
);

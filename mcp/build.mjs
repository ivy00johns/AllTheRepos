/**
 * Bundle the server to a single ESM file.
 *
 * `better-sqlite3` stays external — it is a native module and cannot be
 * bundled. It resolves from this package's own node_modules at runtime,
 * which is the whole point of the separate dependency tree.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["better-sqlite3"],
  banner: { js: "#!/usr/bin/env node" },
  alias: {
    "@shared": "../src/shared",
    "@main": "../src/main",
  },
});
console.log("built dist/index.js");

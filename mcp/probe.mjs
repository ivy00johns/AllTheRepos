/**
 * End-to-end probe for the AllTheRepos MCP server.
 *
 * Drives the server over stdio and prints what each tool returns.
 *
 * ## Why this exists rather than a shell one-liner
 *
 * The obvious `printf '<req1>\n<req2>\n' | node dist/index.js` is WRONG for
 * anything that writes. The SDK dispatches piped requests concurrently, so
 * `unlink` can complete before the `link` it was meant to undo — leaving a
 * stray row behind. That happened during development against the real
 * catalog. This driver sends one request and waits for its response before
 * sending the next.
 *
 * ## Safety
 *
 * By default it runs against a THROWAWAY catalog in a temp directory, seeded
 * with two fake repos, so the write round-trip cannot touch your real data.
 *
 *   node probe.mjs           # safe: temp catalog, exercises reads AND writes
 *   node probe.mjs --live    # your real catalog, READ-ONLY (no link/unlink)
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const LIVE = process.argv.includes("--live");
const require = createRequire(import.meta.url);

function seedTempCatalog() {
  const dir = mkdtempSync(path.join(tmpdir(), "atr-probe-"));
  const Database = require("better-sqlite3");
  const db = new Database(path.join(dir, "alltherepos.db"));
  db.pragma("journal_mode = WAL");
  // Minimal shape the tools touch. The server's own openCatalog() adds
  // repo_links via the app's idempotent DDL on first open.
  db.exec(`CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, full_path TEXT NOT NULL,
    remote_url TEXT, default_branch TEXT, current_branch TEXT,
    last_commit_hash TEXT, last_commit_date TEXT, last_commit_msg TEXT,
    is_dirty INTEGER DEFAULT 0, primary_language TEXT, languages_json TEXT,
    tags_json TEXT, description TEXT, readme_content TEXT, readme_hash TEXT,
    size_bytes INTEGER, last_scanned_at TEXT, created_at TEXT, updated_at TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0, favorited_at TEXT)`);
  // The app seeds settings on open; without this table it logs a recoverable
  // error to stderr and carries on. Create it so the probe output stays clean.
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY, data_json TEXT NOT NULL, schema_version INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS scan_paths (
    path TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1)`);
  const ins = db.prepare(
    `INSERT INTO repos (slug,name,full_path,description,primary_language,last_commit_date)
     VALUES (?,?,?,?,?,?)`,
  );
  ins.run(
    "the-hive-aaaaaa",
    "the-hive",
    path.join(dir, "the-hive"),
    "Orchestration platform",
    "TypeScript",
    "2026-08-01T00:00:00.000Z",
  );
  ins.run(
    "hive-worker-bbbbbb",
    "hive-worker",
    path.join(dir, "hive-worker"),
    "A worker process",
    "TypeScript",
    "2026-08-02T00:00:00.000Z",
  );
  db.close();
  return dir;
}

/** Send one JSON-RPC request; resolve with its response. Strictly serial. */
function makeClient(dataDir) {
  const child = spawn("node", ["dist/index.js"], {
    cwd: import.meta.dirname,
    env: { ...process.env, ATR_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  const waiters = new Map();
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  let id = 0;
  return {
    send(method, params) {
      const rid = ++id;
      return new Promise((resolve) => {
        waiters.set(rid, resolve);
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n",
        );
      });
    },
    notify(method) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    },
    kill: () => child.kill(),
  };
}

const unwrap = (r) => {
  const text = r?.result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const dataDir = LIVE
  ? path.join(process.env.HOME, "Library", "Application Support", "alltherepos")
  : seedTempCatalog();

console.log(
  LIVE ? "MODE: LIVE catalog (read-only)" : "MODE: throwaway catalog",
);
console.log("catalog:", dataDir, "\n");

const c = makeClient(dataDir);
await c.send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "probe", version: "0" },
});
c.notify("notifications/initialized");

const tools = (await c.send("tools/list")).result.tools.map((t) => t.name);
console.log("1. tools/list  ->", tools.join(", "));

const found = unwrap(
  await c.send("tools/call", {
    name: "find_repos",
    arguments: { query: LIVE ? "hive" : "hive", limit: 3 },
  }),
);
console.log(`2. find_repos  -> ${found.length} match(es)`);
for (const r of found) console.log(`     ${r.name.padEnd(16)} ${r.full_path}`);

const map = unwrap(
  await c.send("tools/call", { name: "get_map", arguments: {} }),
);
console.log(
  `3. get_map     -> ${map.repoCount} repos, ${map.edgeCount} edges, ${map.clusters.length} clusters`,
);

if (LIVE) {
  console.log("\n(skipping link/unlink — --live is read-only by design)");
} else {
  const a = found.find((r) => r.name === "hive-worker").full_path;
  const b = found.find((r) => r.name === "the-hive").full_path;

  const made = unwrap(
    await c.send("tools/call", {
      name: "link",
      arguments: {
        from: a,
        to: b,
        kind: "part-of",
        why: "probe: worker of the hive",
      },
    }),
  );
  console.log(
    `4. link        -> ${made.created.fromSlug} --${made.created.kind}--> ${made.created.toSlug}`,
  );

  const listed = unwrap(
    await c.send("tools/call", { name: "list_links", arguments: {} }),
  );
  console.log(
    `5. list_links  -> ${listed.links.length} link(s): "${listed.links[0].why}"`,
  );

  const after = unwrap(
    await c.send("tools/call", { name: "get_map", arguments: {} }),
  );
  console.log(
    `6. get_map     -> ${after.edgeCount} edges (was ${map.edgeCount}) — the curated link is now on the map`,
  );

  const gone = unwrap(
    await c.send("tools/call", {
      name: "unlink",
      arguments: { from: a, to: b, kind: "part-of" },
    }),
  );
  const empty = unwrap(
    await c.send("tools/call", { name: "list_links", arguments: {} }),
  );
  console.log(
    `7. unlink      -> removed=${gone.removed}, links now ${empty.links.length}`,
  );

  const bad = unwrap(
    await c.send("tools/call", {
      name: "link",
      arguments: { from: "/no/such/repo", to: b, kind: "related", why: "x" },
    }),
  );
  console.log(`8. bad path    -> ${bad.error.split("\n")[0]}`);
}

c.kill();
console.log("\nOK");

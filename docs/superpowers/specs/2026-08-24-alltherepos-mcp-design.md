# AllTheRepos MCP — curated repository relationships

**Status:** design approved, not implemented
**Date:** 2026-08-24
**Author:** design session with Claude

---

## 1. The problem

The relationship map at `/graph` derives every edge from what it can
read on disk: shared dependencies, README links, git remote owner, and
name families. Derivation is honest but partial, and measuring it
against the real 263-repo catalog showed how partial:

| Claim                                     | Derived signal found    |
| ----------------------------------------- | ----------------------- |
| "Skill-Madness relates to ~40 repos"      | **1** README reference  |
| "The-Hive relates to a lot of repos"      | **4** README references |
| Repos depending on each other as packages | **0**                   |

The binding signal that _did_ show up was shared tooling — 206
libraries used by 3–25 repos each. That is real, but it describes
technical similarity, not intent. A repo is "part of The-Hive" because
of a decision someone made, and nothing in the filesystem records that
decision.

An LLM session reading a repository can recover that intent. It has
nowhere to put it. `graphService.build()` performs **zero SQL writes** —
the map is recomputed from scratch on every call, so there is no edge to
update. The five tables in the catalog are `repos`, `groups`,
`repo_groups`, `scan_paths`, and `settings`; none of them expresses a
pairwise relationship.

This spec adds a curated-link store and an MCP server so a Claude Code
session can record what it works out.

## 2. Scope

**In scope**

- A `repo_links` table for human/agent-asserted relationships.
- Merging curated links into the derived graph, visibly distinguished.
- A standalone MCP server exposing read tools over the catalog and
  write tools over `repo_links` only.

**Explicitly out of scope**

- Suppressing or contradicting a derived edge. Curated links only add.
  Deferred; see §10.
- Any MCP tool that moves repos, runs tasks, or touches git. Those stay
  in the app behind the preflight rails documented in
  `docs/COMMAND-DISCLOSURE.md`.
- Auto-update or scheduled re-curation.

## 3. Findings that shape the design

Each was verified against the source during design, and each changed a
decision. They are recorded because they are non-obvious and would be
expensive to rediscover.

### 3.1 The data layer is already Electron-free

- `db/schema.ts` — zero Electron references.
- `db/queries.ts` — mentions Electron only in comments.
- `db/client.ts` — does not import Electron. It resolves the data
  directory through `setDataDirOverride()`, falling back to the
  `ATR_DATA_DIR` environment variable (`client.ts:119-131`).
- `services/graph.ts` — imports only `node:fs`, `node:path`,
  `@shared/types`, and `@main/db/client`.

**Consequence:** the MCP server reuses the real query layer and the real
graph engine. No extraction work, and no parallel implementation that
drifts from the app's behaviour.

### 3.2 SQLite runs in WAL mode

`client.ts:200` sets `journal_mode = WAL`. WAL permits one writer plus
concurrent readers _across processes_, so a separate MCP process
sharing the catalog file is safe rather than a corruption risk.

**Consequence:** a standalone server that works while the app is closed
is viable. Without WAL this design would have had to live inside the
Electron main process.

### 3.3 A slug is not a durable handle across a move

**Corrected during implementation (Task 2).** The original text here
claimed a slug simply goes stale whenever a repo moves. That is wrong,
and the real behaviour is more interesting.

`slugFromNameAndPath` is `kebab(name)-sha1(fullPath)[0:6]`
(`metadata.ts:350-363`), so the scanner *computes* a new slug for a
moved repo. But the catalog's rebind path **discards that hint**: the
`UPDATE repos SET …` in `queries.ts` updates `name`, `full_path`,
`remote_url`, commit fields and more, and has **no `slug` column in its
SET list**. `upsert-moved-repo.spec.ts:143` pins this directly —
`expect(rows[0].slug).toBe("acme-aaaaaa"); // original slug kept
(routes/deep links stay valid)`.

So a move splits into two cases:

- **Rebound** (matched by remote URL, or by name + last-commit-hash when
  the old path is gone): same row, **slug preserved**. Tags and groups
  survive, and a slug-keyed link would have survived too.
- **Not rebound** (no remote *and* no matching commit hash, or the old
  path still exists — a second clone): a **new row with a new slug** is
  created and the old row becomes a ghost.

**Consequence, restated on the correct grounds:**

1. `repo_links` keys on `repo_id`, exactly as `repo_groups` does. The
   reason is the **un-rebound** case: a slug-keyed link would still
   resolve there, silently, to a ghost row for a repo that no longer
   lives at that path. Pointing confidently at the wrong repo is worse
   than failing to resolve. In the rebound case both designs work.
2. MCP tools accept a **filesystem path**, not a slug — because a path
   is what a person or an agent actually knows and can re-derive, not
   because slugs churn on every move. `find_repos` returns the path for
   exactly this reason.

The move-survival test in Task 2 therefore proves survival *through a
rebind*. That is worth pinning, but it is not evidence of slug
instability, and the plan's original assertion
(`toSlug === "hive-bbbbbb"`) could never have passed.

### 3.4 Schema changes have an established idempotent path

`drizzle/meta/` contains only `_journal.json` — there is no
`0000_snapshot.json`. `drizzle-kit generate` therefore has nothing to
diff against and emits a full `CREATE TABLE` for every table, which
fails against any existing database. This has already happened once
during development.

The codebase's answer is `ensureAdditiveColumns(sqlite)`
(`client.ts:219`), which applies additive schema changes in code,
idempotently, with a comment explaining exactly this reasoning.

**Consequence:** `repo_links` is created by an idempotent
`CREATE TABLE IF NOT EXISTS` next to `ensureAdditiveColumns`. Do **not**
run `pnpm db:generate` as part of this work.

## 4. Data model

```sql
CREATE TABLE IF NOT EXISTS repo_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  to_repo_id   INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL,
  why          TEXT,
  source       TEXT    NOT NULL DEFAULT 'mcp',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_repo_id, to_repo_id, kind)
);

CREATE INDEX IF NOT EXISTS repo_links_from_idx ON repo_links (from_repo_id);
CREATE INDEX IF NOT EXISTS repo_links_to_idx   ON repo_links (to_repo_id);
```

`kind` is one of `part-of`, `depends-on`, `supersedes`, `forked-from`,
`related`. Validated by a Zod enum in `@shared/schemas`, not by a SQL
constraint, so the check lives with every other contract in this
codebase.

`why` is free text and is required by the MCP tool even though the
column is nullable — an assertion without a reason is not reviewable,
and the column stays nullable so UI-created links can omit it later.

`source` distinguishes `mcp` from `ui` so the provenance of a link is
never guesswork.

The `ON DELETE CASCADE` and `repo_id` foreign keys mirror `repo_groups`
(`schema.ts:88-106`) exactly. Foreign keys are enforced —
`client.ts:201` sets `foreign_keys = ON`.

**Direction is stored and preserved.** `part-of` is meaningless without
it: "Sub is part-of Hive" is a claim about where Sub should live, and
the reverse is not.

## 5. Graph integration

### 5.1 A sixth signal

`GraphSignalSchema` (`schemas.ts:701-707`) gains `"curated"`.
`SIGNAL_WEIGHT` (`graph.ts:115-121`) gains `curated: 4` — above
`submodule: 3`, the current maximum. Derived signals are inferences;
a curated link is an assertion, and should outrank them.

### 5.2 Where it hooks in

`build()` already funnels every signal through one helper
(`graph.ts:351-370`):

```ts
const add = (a, b, signal: GraphSignal, weight: number, why: string) => …
```

Curated links become one more loop calling `add`, after the derived
passes. The accumulation machinery is untouched.

### 5.3 Two behaviours that need explicit handling

**Curated edges bypass the noise filter.** `graph.ts:483` drops
everything below `MIN_EDGE_WEIGHT`. A human assertion must never be
discarded as noise, so the filter becomes:

```ts
.filter((e) => e.signals.has("curated") || e.weight >= MIN_EDGE_WEIGHT)
```

**Direction rides as metadata.** `add` normalises pairs to undirected
(`a < b ? [a,b] : [b,a]`, `graph.ts:362`), and the force layout and
cluster detection both depend on that. Rather than disturb them,
`GraphEdgeSchema` gains an optional field:

```ts
curated: z.array(
  z.object({
    from: z.string(), // slug
    to: z.string(), // slug
    kind: RepoLinkKindSchema,
    why: z.string().nullable(),
  }),
).optional();
```

The simulation keeps treating the edge as undirected; the detail panel
and hover text render the direction. This is the smallest change that
keeps both the physics and the semantics correct.

### 5.4 Downstream effects

- `OVERVIEW_EDGE_CAP` (320, `routes/graph.tsx:47`) sorts by weight, so
  curated edges survive the cap without special-casing.
- The signal filter row in `routes/graph.tsx:141-161` picks up a
  "Curated" toggle from `SIGNAL_LABELS` automatically.
- Cluster detection and `summariseClusters` need no change — they
  consume edges, and curated edges are edges. Strays and scatter
  therefore improve as links accumulate, which is the point.

## 6. The MCP server

### 6.1 Shape

A `stdio` MCP server, added with `claude mcp add`. It opens the catalog
directly via `setDataDirOverride` and calls the same `queries.ts` and
`graphService` the app uses.

It lives at `mcp/` inside this repository — same git history, same
`src/shared` contracts, reviewed alongside the code it depends on — but
with its **own `package.json` and its own `node_modules`**, and is
published from there. The separate dependency tree is what avoids the
ABI collision in §8; sharing the repo is what keeps the graph engine
from forking.

### 6.2 Tools

Six. Deliberately small — the surface is "read the catalog, assert
relationships", nothing else.

| Tool         | Input                       | Returns                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------ |
| `find_repos` | `query`                     | Matching repos: path, name, description, folder, last commit |
| `get_repo`   | `path`                      | Detail plus current derived and curated edges                |
| `get_map`    | `cluster?`                  | Clusters, folder spread, strays — the reorg view             |
| `link`       | `from`, `to`, `kind`, `why` | The created link                                             |
| `unlink`     | `from`, `to`, `kind`        | Whether a row was removed                                    |
| `list_links` | `path?`                     | Curated links, all or for one repo                           |

### 6.3 Identity resolution

Every tool taking a repo takes a filesystem path (see §3.3). Resolution
order:

1. Exact `full_path` match after `path.resolve`.
2. Unique basename match.
3. Otherwise an error listing the candidates.

Never a silent best guess — picking the wrong repo writes a false
assertion that then outranks every derived signal.

### 6.4 Write discipline

`link` and `unlink` touch `repo_links` and nothing else. `link` is
idempotent on `(from, to, kind)` — re-asserting updates `why` rather
than erroring, so a re-run of the same session converges instead of
failing.

## 7. Safety

The MCP is strictly narrower than the app. It cannot move a repository,
create or rename a folder, run a project task, kill a process, fetch,
pull, or open anything. Its entire write surface is one table of
assertions about relationships.

This matters because `docs/COMMAND-DISCLOSURE.md` documents what the
application does to a machine, and that document must stay true. Adding
a process that can reach the catalog is exactly the kind of change that
quietly invalidates it.

**Therefore `docs/COMMAND-DISCLOSURE.md` gains a section covering the
MCP server as part of this work — not afterwards.** It states the tool
surface, the single table written, and the fact that no command,
filesystem mutation, or git operation is reachable through it.

## 8. Distribution and the ABI risk

`better-sqlite3` is a native module, and this repo has a documented
dual-ABI constraint: `node_modules` can be built for host Node _or_ for
Electron, never both (`README.md`, "The dual-rebuild dance";
`scripts/ensure-native-abi.mjs`).

- **Shipped:** the published package carries its own dependency tree,
  built for host Node. No collision.
- **Development:** running the server against the _root_ `node_modules`
  while it is on the Electron ABI will fail to load `better-sqlite3`.
  This is why `mcp/` has its own `node_modules` (§6.1) rather than
  sharing the root install — the two ABIs coexist as separate trees
  instead of fighting over one.

This is the main implementation risk and it is a packaging problem, not
a design problem. It must be settled in the first implementation step
rather than discovered late.

## 9. Testing

Following the codebase's existing style — real SQLite against a
temporary data directory via `isolateDataDir()`, as
`tests/unit/main/services/graph.spec.ts` does.

| Area          | Cases                                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema        | Table created idempotently; re-running is a no-op; cascade delete removes links when a repo is deleted                                                                                               |
| Move survival | A curated link survives a repo move via the existing rebind path — the §3.3 guarantee, pinned                                                                                                        |
| Graph merge   | A curated link produces an edge; it outranks a derived edge between the same pair; it survives the `MIN_EDGE_WEIGHT` filter at weight zero from other signals; direction is preserved in `curated[]` |
| Resolution    | Exact path wins; unique basename resolves; ambiguous basename errors and lists candidates                                                                                                            |
| Idempotence   | `link` twice updates `why` rather than erroring                                                                                                                                                      |
| Tool surface  | No tool can reach a command, a file mutation, or git                                                                                                                                                 |

The move-survival test is the one that would be tempting to skip and
must not be — it pins the reason `repo_id` was chosen over `slug`, and
that reasoning is invisible from the schema alone.

## 10. Deferred

**Suppressing a derived edge.** A session cannot currently say a derived
relationship is wrong. This would let the map learn from corrections
rather than only accumulate. Cut from v1: it needs a second concept and
a second table, and curated links should prove useful first.

**Reorganisation tools.** Exposing move and folder operations through
the MCP was considered and rejected for v1. Those operations carry the
preflight rails, the relocation journal, and the undo path; putting them
behind an agent boundary deserves its own design rather than a footnote
in this one.

**Scheduled re-curation.** A recurring session that refreshes
assertions as repos change. Depends on this shipping first.

## 11. Open question for implementation

`moveService.check()` has no dedicated test file
(`docs/COMMAND-DISCLOSURE.md` §10). It is not on this critical path, but
the move-survival test in §9 exercises the same rebind machinery, so the
two are worth sequencing together if convenient.

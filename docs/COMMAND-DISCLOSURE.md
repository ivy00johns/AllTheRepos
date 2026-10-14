# Command Disclosure

**AllTheRepos v0.1.0 — alpha**

This document is a complete, source-traced inventory of every external
command, filesystem write, and network request the application can make.
It exists because an alpha tool that touches a developer's entire
codebase collection has to be auditable before it is trusted.

Each entry cites the file and line where the call is made, so nothing
here has to be taken on faith. If you find behaviour not listed below,
that is a bug — please report it.

---

## 1. Design guarantees

These are enforced in code, not by convention.

| Guarantee | Where it is enforced |
| --- | --- |
| **No destructive git command exists in the codebase.** The entire git surface is nine `simple-git` methods; only two of them write anything. | §2 |
| **The app never deletes a file or directory you own.** There is no `rm`, no `rm -rf`, no `shell.trashItem`, no recursive delete anywhere in the main process. | §4 |
| **The app never edits the contents of a file inside your repositories.** Every file write targets the app's own data directory. | §4 |
| **The app writes nothing inside your repositories at all.** No file or folder is created, renamed, moved, copied, or deleted there, and no file content is ever edited. | §4 |
| **That read-only promise is enforced by a gate, not by care.** `scripts/check-read-only.mjs` fails CI if the main process gains a delete, a move, a copy, or any other write outside a short list of named waivers. | §5 |
| **The renderer cannot execute an arbitrary command.** The UI sends a *task id*; the main process resolves it against the commands that project itself declares. | §3.3 |
| **Every external URL passes a scheme allowlist** before reaching the OS. | §7 |

---

## 2. Git commands

All git access goes through `simple-git`. The complete set of methods
invoked anywhere in the application is:

| Method | Underlying command | Writes? | Used by |
| --- | --- | --- | --- |
| `git.status()` | `git status` | No | `services/git.ts:55`, `git-sync.ts:199`, `metadata.ts:255` |
| `git.branch()` / `git.branchLocal()` | `git branch` | No | `metadata.ts:261`, `git.ts:97` |
| `git.log({maxCount:1})` | `git log -1` | No | `metadata.ts:273` |
| `git.raw(["log","-1","--pretty=…",<branch>])` | `git log -1` | No | `git.ts:112` |
| `git.getRemotes()` | `git remote -v` | No | `metadata.ts:242`, `git-sync.ts:212` |
| `git.remote(["get-url","origin"])` | `git remote get-url origin` | No | `launcher.ts:684` |
| `git.fetch(["--prune"])` | `git fetch --prune` | Refs only | `git-sync.ts:221` |
| `git.pull(["--ff-only"])` | `git pull --ff-only` | **Yes** | `git-sync.ts:256` |

### Commands that are *not* present anywhere in the codebase

`push` · `commit` · `add` · `rm` · `reset` · `checkout` · `switch` ·
`restore` · `clean` · `merge` · `rebase` · `cherry-pick` · `stash` ·
`clone` · `branch -D` · `tag` · `remote set-url` · `gc` · `prune` ·
`filter-branch` · `reflog expire` · `worktree`

You can verify this yourself:

```sh
grep -arn "git\.[a-zA-Z]*(" src/main --include="*.ts"
```

### The two writing commands, in detail

**`git fetch --prune`** updates remote-tracking refs and removes
remote-tracking branches whose upstream is gone. It does not touch your
working tree, your local branches, or your commits.

**`git pull --ff-only`** is the only command that can change files in
your working tree, and it is heavily gated. Before it runs,
`git-sync.ts:217-253` refuses in every one of these cases:

- the working tree is dirty → outcome `dirty`, skipped
- the branch is ahead *and* behind (diverged history) → outcome `diverged`, skipped
- the branch has no upstream → outcome `no-upstream`, skipped
- the repo has no remotes → outcome `no-remote`, skipped
- the branch is not behind → outcome `already-current`, skipped

`--ff-only` means git itself refuses anything that is not a
fast-forward — no merge commit is ever created, and no conflict
resolution is ever attempted. A fast-forward can only add commits that
already exist on the remote; it cannot discard local work, because the
presence of local work is what `dirty` and `diverged` block on.

**Limitation to be aware of:** a fast-forward pull is not covered by the
app's own undo. The sync result reports how many commits were received,
but not the SHA you were on beforehand. Reversing a pull means
`git reflog` to find the old SHA, then `git reset --hard <sha>` in a
terminal.

**Pull is never automatic.** `gitSyncService.pull` has exactly one caller
in the whole codebase — the `git:pull` IPC handler at `ipc/git.ts:93`,
reached only by pressing Pull. Nothing on a timer, at startup, or in the
background can invoke it.

---

## 3. System commands

### 3.1 Process discovery — automatic, read-only

Run on a timer — and on demand, when the process panel mounts or its
Refresh action is pressed (`process:refresh`) — to show which projects have
something running.
`services/process.ts:824` notes that every one of these uses `execFile`
with a literal argument array — never a shell string — so no argument
can be interpreted as a shell command.

| Command | Purpose | Source |
| --- | --- | --- |
| `lsof -nP -iTCP -sTCP:LISTEN -F pcnTL` | Find listening ports | `process.ts:829` |
| `ps -axo pid=,ppid=` | Read the whole parent map in one call | `process.ts:868` |
| `lsof -a -p <pids> -F pn -d cwd` | Map processes to repos | `process.ts:910` |
| `ps -p <pid> -o pid=` | Liveness check | `process.ts:925` |

Poll interval: 3s focused, 15s unfocused, paused after 60s idle
(`process.ts:53-54`) — the on-demand path above runs the same sweep, so the
timer is the floor rather than the only way a scan happens. A tick is three
rounds: the listening sweep and the
parent map run together, then the cwd lookups are batched 32 PIDs per
call, up to 4 calls at once (`process.ts` `CWD_BATCH_SIZE` /
`CWD_BATCH_CONCURRENCY`). Single-PID probes have a 1s timeout, a batched
cwd call 5s. The `-a` in that last command is load-bearing: lsof ORs its
selection options without it, so `-d cwd` would widen the query to every
process on the machine instead of the requested PIDs.

PIDs handed to the kill path are Zod-validated as positive integers
(`schemas.ts:1034`). The PIDs in the cwd batch are never renderer input —
they come from lsof's own listening-socket listing.

### 3.2 Editor and terminal detection — automatic, read-only

| Command | Purpose | Source |
| --- | --- | --- |
| `/bin/zsh -ilc "command -v <cli>"` | Locate an editor CLI on your interactive PATH | `launcher.ts:278` |

`<cli>` is drawn from a hardcoded table of thirteen editors
(`launcher.ts:96-188`); it is never user input. The probe is spawned
with an argv array and killed after 1.5s.

The editor probe is the only external command this section runs. The update
check used to reach for `gh auth token` too; as of 2026-10-06 it does not —
releases are published to a public repo, so the feed is read anonymously and
the app holds no credential (§8).

### 3.3 Project tasks — **you initiate, the project defines**

This is the one place where the app runs a command it did not author,
and it deserves the most attention.

Pressing Run in the task panel executes:

```
$SHELL -l -i -c "<command>"
```

— spawned detached, in its own process group, with `cwd` set to the
repository (`tasks.ts:366`).

**Where the command comes from.** It is discovered by reading the
project's own files (`tasks.ts:detectTasks`), never typed by you and
never sent from the UI:

| Source file | Commands offered |
| --- | --- |
| `package.json` | `<pnpm\|yarn\|bun\|npm> run <script>` for each script, minus npm lifecycle hooks |
| `Makefile` | `make <target>` |
| `justfile` | `just <recipe>` |
| `Cargo.toml` | `cargo run`, `cargo build`, `cargo test` |
| `go.mod` | `go run ./...`, `go build ./...`, `go test ./...` |
| `manage.py` | `python manage.py runserver` |
| `pyproject.toml` | `poetry install`, `pytest` |
| `requirements.txt` | `pip install -r requirements.txt` |
| `docker-compose.yml` | `docker compose up`, `docker compose down` |
| `Procfile` | the command written on each line |

**Why the renderer cannot inject a command.** `ipc/tasks.ts:70` resolves
the task id against `taskService.list(repoPath)` — the live re-read of
that project's declared tasks — and rejects anything not on the list.
The IPC schema carries a task id, not a command string.

**Limitation.** The app does not sandbox, inspect, or judge what
a project's own scripts do. If `package.json` declares
`"reset": "rm -rf ./data"`, that is what runs when you press Run on
`reset`. **The app's safety guarantees cover the app's own actions, not
the contents of your projects.** The command is displayed in full in the
task panel before you press Run — read it.

The `-l -i` flags load your login and interactive shell profiles
(`.zshrc` and friends) so that `nvm`, `pyenv`, and Homebrew tooling are
on PATH. Those profiles execute as they normally would.

**Stopping a task** sends `SIGTERM` to the process group, then `SIGKILL`
after a grace period (`tasks.ts:442-465`). Unsaved state inside that
process is lost — this is the same as pressing Ctrl-C then `kill -9`.

**Killing a process** from the process panel escalates
`SIGINT → SIGTERM → SIGKILL` with a wait between each
(`process.ts:554-612`). Same caveat.

### 3.4 Opening editors and terminals — you initiate

| Command | When | Source |
| --- | --- | --- |
| `open -a Xcode <repo>` | Xcode has no URL scheme | `launcher.ts:524` |
| `<editor-cli> <repo>` | URL-scheme dispatch failed | `launcher.ts:534` |
| `open -a Terminal <repo>` | Open in Terminal.app, no command | `launcher.ts:844` |
| `open -a Ghostty <repo>` / `open -a Hyper <repo>` | Terminal launch | `launcher.ts:597, 615` |
| `alacritty --working-directory <repo>` | Terminal launch | `launcher.ts:604` |
| `kitty --directory <repo>` | Terminal launch | `launcher.ts:610` |
| `osascript -e '<AppleScript>'` | Terminal.app / iTerm2 with a command | `launcher.ts:837, 868` |

The AppleScript path is the only place a command string is embedded in
generated text. Both the repository path and the command are escaped for
AppleScript string literals (`launcher.ts:827`). The only command the app
itself ever sends this way is `claude`, built by
`claude.ts:604-613` as:

```
claude [--resume <uuid>] [--prompt '<single-quoted prompt>']
```

The session id is Zod-validated as a UUID before interpolation; the
prompt is POSIX single-quote escaped (`claude.ts:615-618`).

Opening Finder uses Electron's `shell.showItemInFolder`
(`launcher.ts:664`), not a shell command.

---

## 4. Filesystem writes

Every write the application performs, exhaustively.

### Inside the app's own data directory (`~/Library/Application Support/alltherepos`)

| Path | Written by |
| --- | --- |
| `settings.json` | `services/settings.ts:89` (atomic temp + rename) |
| `notes/<repo-id>.md` (per-repo markdown notes) | `services/notes.ts` (atomic temp + rename) |
| `alltherepos.db` (SQLite catalog) | `db/client.ts:229` |
| `lance/` (vector index) | vector service |
| one-time migration copies from `~/.alltherepos/` | `db/migration.ts:84-90` |

### Inside your repositories

**Nothing. Not one call.** There is no table to write here, because this
build performs no write of any kind inside your repositories — no file
or directory is created, renamed, moved, copied, or deleted, and no file
content is ever modified. Scanning, README parsing, cover extraction,
dependency reading, and the relationship map are all read-only; they copy
text into the local database and leave your files untouched.

This was not always true. A folder-management surface — rename-based
moves, folder creation, a relocation journal — was built into this app
despite a read-only requirement, and it reached further than it looked:
`services/move.ts`, `services/folder.ts`,
`services/relocation-journal.ts`, their IPC handlers, their preload
bindings, their dialogs and hooks, and the browser-tab mirror of all of
it. It is not deleted. It is parked, whole and with its tests, on the
`feat/file-management` branch. What is gone from this branch is every
path to it, and §5 is what keeps it gone.

This is why per-repo **notes** are stored in the app's own data
directory — one file per repository at `notes/<repo-id>.md`
(`services/notes.ts`), keyed on the catalog row id rather than the slug
so a note follows a repository you move. The plan for notes also floated
an optional copy at `<repo>/.alltherepos/notes.md`; that was **not**
implemented, because writing inside a repository is exactly what this
section promises never happens. Clearing a note empties its file rather
than deleting it; a repository with no note and a repository whose note
is empty answer identically, because there is no delete to call.

There is no deletion in the main process at all: the gate refuses one in
any file, with no waiver available (§5), so nothing the app does to your
code is irreversible.

**Removing a scan folder never deletes anything from disk**
(`scan-roots.ts:16`, `:121`). With "forget repos" checked it drops rows
from the catalog database; the code on disk is untouched and reappears
if you re-add the folder.

---

## 5. The read-only gate

The guarantee in §1 and §4 is not maintained by care. It is maintained by
`scripts/check-read-only.mjs`, which reads every file in `src/main` and
`src/preload` and fails on:

| Rule | What fails |
| --- | --- |
| **destructive** | `fs.rm`, `rmdir`, `unlink`, `truncate`, `shell.trashItem` — anywhere, in any file, with no waiver available. |
| **shell** | the same verbs handed to a shell: `rm`, `rmdir`, `mv`, `cp`, `rsync`, `shred` through `exec`/`execFile`/`spawn`. |
| **write** | `writeFile`, `mkdir`, `rename`, `copyFile`, `cp`, `chmod`, `symlink`, `createWriteStream` in a file with no waiver. |
| **unwaived** | a file that has a waiver, using a call its waiver does not name. |

The five waivers are the app's own files: the data directory before
SQLite opens it (`db/client.ts`), the one-time migration out of
`~/.alltherepos/` (`db/migration.ts`), per-repo notes
(`services/notes.ts`), `settings.json` (`services/settings.ts`), and
window placement (`window/window-memory.ts`). A new writer is a failing
build until somebody names it and the reason, deliberately.

Copy is a write rather than a delete, because copying is how a file is
quietly replaced — and a copy-then-delete is not merely discouraged here:
deletes are refused outright, so the pattern cannot be written at all.

Run it with `pnpm gate:read-only`; CI runs it beside the gate that fails
on retired copy strings. `tests/unit/scripts/check-read-only.spec.ts`
pins its boundaries, including the false positive that shaped it —
`services/embedding.ts` calls a local `truncate(text)` that clips a
string, which a verb-only gate reports as `fs.truncate`.

---

## 6. What can and cannot be undone

| Action | Undo |
| --- | --- |
| Add / remove a scan folder | ✅ Re-add it; nothing on disk changed |
| Forget repositories from the catalog | ✅ Re-scan restores them |
| `git pull --ff-only` | ⚠️ Not by the app — use `git reflog` + `git reset --hard` |
| A project task you ran | ❌ Whatever that command did, it did |
| SIGKILL of a process | ❌ Unsaved in-memory state is lost |

Nothing in this table involves a file you own, because nothing in this
app writes to one. The only irreversible actions it can take are the
three at the bottom.

---

## 7. Network

| Destination | When | Sends |
| --- | --- | --- |
| `api.github.com` (releases) | Update check, 8s after launch and on demand | Version string, auth token if one exists locally |
| Your git remotes | Only when you press Fetch or Pull | Standard git protocol, your existing credentials |
| `http://localhost:11434` (Ollama) | Semantic indexing, if Ollama is running | README and metadata text, to your own machine |
| `api.openai.com` | **Only if** you set an OpenAI embedding model | README and metadata text |

OpenAI is **off by default** — `openaiEmbedModel` defaults to `null`
(`settings.ts:36`). Nothing leaves your machine over that path unless
you configure it deliberately.

The app has no telemetry, no analytics, and no crash reporting.

External URLs pass a scheme allowlist before reaching the OS
(`security/allowlist.ts:27-44`): `https:` plus the editor and terminal
schemes (`vscode:`, `cursor:`, `zed:`, the JetBrains family, `warp:`,
and so on). Anything else is rejected. `http:` is not allowed.

---

## 8. Updates

The updater **checks and notifies; it does not download or install**
(`services/updater.ts:1-30`). macOS applies updates through Squirrel.Mac,
which refuses anything that is not validly code-signed, and this alpha
ships without an Apple Developer certificate. Rather than fail silently
after a large download, the app tells you a release exists and links to
it. Downloading and installing are manual and remain your decision.

The release feed is a **public** repository
(`ivy00johns/alltherepos-releases`), so a check is one anonymous request to the
GitHub API: the app stores no credential, reads none from your environment, and
asks you for nothing (`services/updater.ts`). Nothing published yet, no network,
and being rate-limited each report as their own state rather than as one generic
failure.

---

## 9. Alpha status

This is version 0.1.0 and it is alpha software. The guarantees above
describe what the code does today, verified against the source. Most are
backed by tests; §10 lists exactly which are not. Alpha means unproven in
the field regardless.

Recommended precautions:

1. **Keep your work committed and pushed anyway.** The app writes nothing
   inside your repositories, but it does run the task commands your
   projects declare (§3.3), and a clean remote is the backstop that does
   not depend on this app being correct.
2. **Read the task command** shown in the panel before pressing Run. The
   app does not vet what your projects declare.
3. **Start with one scan folder** to see how discovery behaves before
   pointing it at everything.

## 10. Verifying this document

Nothing here needs to be taken on trust. From a checkout:

```sh
# Every git method the app can call
grep -arn "git\.[a-zA-Z]*(" src/main --include="*.ts"

# Every process spawn
grep -arn "execFile\|spawn(" src/main --include="*.ts"

# Every filesystem write or delete
grep -arn "rename\|mkdir\|writeFile\|rmSync\|rmdir\|unlink" src/main --include="*.ts"

# Every outbound request made by application code
grep -arn "fetch(" src/main --include="*.ts"
```

**Run these with `grep -a`.** `src/main/services/graph.ts` contains two
literal NUL bytes — a deliberate separator inside `pairKey()`, written as
a raw byte rather than the `\u0000` escape. Without `-a`, grep classifies
that file as binary and skips it **silently**, exiting 1 and printing
nothing, so the checks above would quietly never examine it. This is a
known defect; the one-line fix is to write the separator as an escape.

Two results in those greps look alarming and are not. `unlink` in
`src/main/claude/watcher.ts` is a *chokidar event name* — the watcher
observing that a file was removed by something else — not a delete. And
the GitHub release check does not appear in the `fetch(` grep because it
is issued inside the `electron-updater` dependency, not by application
code; see §8.

### Test coverage of the safety rails

| Rail | Covered by |
| --- | --- |
| The read-only gate itself — destructive calls, shell writers, writes, waivers | `tests/unit/scripts/check-read-only.spec.ts` |
| Task detection and process-group teardown | `tests/unit/main/services/tasks.spec.ts` |
| Scan-root removal leaves the directory on disk | `scan-roots.spec.ts:149-165` |
| Kill escalation state machine | `process.spec.ts:298-440` |

**Known gaps:**

1. **The URL scheme allowlist (§7) has no test.** It is a small pure
   function, but nothing pins it.

These are listed because a disclosure document that claims safety rails
while quietly omitting which ones are unproven is worth less than no
document at all.

---

## 11. The MCP server

`mcp/` ships a Model Context Protocol server so a Claude Code session can
read the catalog and record how repositories relate to one another. It is
a separate process with its own dependency tree (`mcp/package.json`,
`@modelcontextprotocol/sdk` 1.30.0 installed), speaking JSON-RPC over
stdio (`mcp/src/index.ts:25`). **The app never starts it.** Nothing in
`src/` or the root `package.json` references `@alltherepos/mcp` or
`mcp/dist`; your MCP client launches it, and it does nothing at all until
you install it deliberately.

### The six tools, exhaustively

| Tool | Reads or writes | Source |
| --- | --- | --- |
| `find_repos` | Read — `SELECT` over `repos` | `mcp/src/tools/read.ts:40` |
| `get_repo` | Read — one repository and its edges | `read.ts:65` |
| `get_map` | Read — the relationship graph | `read.ts:93` |
| `link` | **Write** — one `repo_links` row | `mcp/src/tools/write.ts:62` |
| `unlink` | **Write** — removes one `repo_links` row | `write.ts:88` |
| `list_links` | Read — curated links back out | `write.ts:107` |

`list_links` sits in `write.ts` for cohesion but only reads. **Two of the
six tools write anything, and both write the same single table.**

### What it reads

The catalog database — `SELECT` only (`read.ts:54`, `:77`) — and, through
`graphService.build()`, each repository's `package.json` and `.gitmodules`
(`services/graph.ts:185`, `:199`). Those are the same two files the Map
view already reads. The MCP adds no new read surface to your projects.

### What it writes

Two statements, both in `src/main/db/links.ts`:

| Statement | Source |
| --- | --- |
| `INSERT INTO repo_links … ON CONFLICT DO UPDATE` | `links.ts:125-128` |
| `DELETE FROM repo_links …` | `links.ts:154` |

The insert is an upsert keyed on `(from, to, kind)`, so re-asserting a
link updates its reason rather than failing. **No other table is
written**, and nothing outside the app's own data directory is touched.

One addition the plan for this section did not anticipate, stated because
omitting it would make the paragraph above slightly false: opening the
catalog calls `getDb()` (`mcp/src/catalog.ts:35`), which runs the same
migrations and idempotent `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN`
schema statements the app itself runs at every launch
(`db/client.ts:238-250`). That is schema setup on the app's own database,
not repository data — but it is a write, and it exists so the server
works against a catalog created by an older app build.

The data directory is `~/Library/Application Support/alltherepos`
(`catalog.ts:19-26`), overridable with `ATR_DATA_DIR` (`catalog.ts:31`).

### The app writes the same table

Curating a relationship is not MCP-only. The repo detail panel and the
`/graph` map's inspector assert and remove links directly, over `graph:link` / `graph:unlink`
(`src/main/ipc/graph.ts`), calling the same `createLink` / `removeLink`
listed in the table above. Rows written there are stamped `source: "ui"`
(`src/main/ipc/graph.ts`), so the map can still tell a person's assertion
from an agent session's.

Both paths enforce the same two rules in `src/main/ipc/graph.ts`: a
repository cannot link to itself, and both ends must resolve to a catalog
row before anything is written. `graph:unlink` additionally answers
`removed: false` rather than erroring when an endpoint no longer exists —
its links cascaded away with it (`src/main/db/schema.ts:120-125`).

This adds no external command, no filesystem write outside the app's own
data directory, and no network request. **§1–§8 still hold.**

### What it cannot do

There is no tool for moving a repository, creating or renaming a folder,
running a project task, killing a process, fetching, pulling, or opening
a URL — and on this branch there is no longer a move or folder surface
for a tool to reach even in principle (§4). The server imports the
database layer and the graph engine and nothing else: `services/graph`
is its one import from the app, and `services/tasks.ts`,
`services/git-sync.ts`, `services/launcher.ts` and
`services/process.ts` are not reachable from it. **Every guarantee in
§1–§8 still holds with the MCP installed.**

Verify both halves of that:

```sh
# Every module the server imports from the app
grep -rn "services/" mcp/src

# Every process spawn, outbound request, or filesystem write
grep -rn "execFile\|spawn(\|fetch(\|writeFile\|rename\|mkdir\|rmdir\|unlink" mcp/src
```

The first prints exactly one line: `@main/services/graph`, at
`read.ts:15`. The second also prints exactly one, and — like the chokidar
case in §10 — it looks worse than it is. `write.ts:89` is the string
`"unlink"`, the *name of the tool*, not `fs.unlink`.

### Concurrency and freshness

The catalog runs in WAL mode (`db/client.ts:232`), which permits one
writer plus concurrent readers across processes. Running the server while
the app is open is safe.

**Curated links do not appear on the map until the graph is rebuilt.**
`graphService.build()` (`services/graph.ts:307`) recomputes from scratch
on demand and does not watch the database, and the Map view caches its
result for five minutes (`hooks/use-graph.ts`). Asserting a link *from the app*
(the catalog panel or the map) is the one path that refreshes itself: the mutation
invalidates the map and both repos' relation lists
(`hooks/use-graph.ts`, `invalidateLinks`). After an **MCP** session
asserts links — an external process the app cannot hear — press refresh on
the Map view (`routes/graph.tsx:182`) to see them.

---

*Last verified against the source on 2026-10-06, v0.1.0.*

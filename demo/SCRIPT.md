# SCRIPT — alltherepos-demo

**Voice:** Local Kokoro-82M (`am_michael`), machine-generated on CPU, no cloud account.
**Voice settings:** speed 1.1 · lang en-us (tightened to fit a ~90s film)
**Voice direction:** A developer talking to a developer. Dry, unhurried, a little wry. Never
hyped. Let the screens carry the energy and the voice carry the meaning.

**Accuracy rule:** every spoken claim must be traceable to the source or to
`docs/COMMAND-DISCLOSURE.md`. Lines that claim more than that are cut.

---

## Line 1 — Cold open (Frame 1)

    Somewhere in your home folder is a project you can't remember the name of, or where you put it.

## Line 2 — What this is (Frame 2)

    AllTheRepos is one window for every git repository on your machine. Point it at your code
    folders, and it reads each one without moving anything.

## Line 3 — The scan (Frame 3)

    Add a scan root and press Scan. It reads each repository's remotes, languages and last commit,
    and writes the result to one SQLite file on your disk.

## Line 4 — Search (Frame 4)

    Then search all of them at once. It's full text, and when Ollama is running, vector ranking
    joins in, so a half-remembered phrase still finds the repo.

## Line 5 — Triage at a glance (Frame 5)

    The grid answers what you'd otherwise ask git. When you last touched it, what it's written in,
    whether it has uncommitted work or has gone missing, and whether it's yours, a clone, or local only.

## Line 6 — Your vocabulary (Frame 6)

    Then make it yours. Tags, favorites, groups, and each project's tasks, read from package.json,
    Makefile or justfile.

## Line 7 — Curated links and the graph (Frame 7)

    Link repos that belong together, and the whole collection shows up as a graph. The repo includes
    an MCP server you add to a coding agent by hand, so the agent can search the catalog, read the
    map, and record links too.

## Line 8 — It keeps up (Frame 8)

    It keeps up on its own. Scan roots are watched in the background, so repos that appear, move or
    disappear show up without a rescan.

## Line 9 — Local-first (Frame 9)

    It's local. No account, no telemetry, and the catalog is one SQLite file that's yours. The only
    automatic call is an update check against GitHub. Cloud embeddings stay off unless you turn them
    on. Every command, file write and network call is listed in the disclosure document, with source lines.

## Line 10 — Close (Frame 10)

    It's keyboard-first, it's alpha, and it runs on Apple silicon Macs. Go download it, and finally
    find that repo.

---

## Cut, and why

- **"Free" and "open source"** — cut because the repo was private with no LICENSE file. It is
  public under MIT since 2026-10-11, after this read was recorded, so the line is now true; the
  film is not re-cut for it.
- **"Every network request is logged"** — nothing logs at runtime. The accurate claim is that the
  disclosure document lists them, with source lines.
- **"A built-in MCP server"** — `mcp/` is a separate package the user adds to a coding agent by hand.
  Line 7 now says so.
- **"Full text by default, no cloud"** — the search default is hybrid, but the vector half runs only
  when a provider is reachable, and the OpenAI path exists (off by default).
- **"Stop guessing / caught up when you switch back"** — rephrased to what the watcher does.

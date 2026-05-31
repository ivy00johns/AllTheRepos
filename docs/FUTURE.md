# Future / Out of Scope

Things deliberately **not** on the path to the daily-driver MVP. Kept here so they aren't
lost, and so the tactical ledger ([`REMAINING-WORK.md`](./REMAINING-WORK.md)) stays focused
on "what makes the app usable now." Promote an item into the ledger when it becomes active.

## Phase 4 — Intelligence layer

The "make the app opinionated" phase. None of this exists yet (correctly — it's post-MVP).

- **Dependency intelligence** — parse all major lockfiles into a `repo_dependencies` table.
- **Vulnerability scanning** — OSV-Scanner shell-out with a `dep_versions_cache`.
- **Health score** — composite score + ring UI on cards/home.
- **Smart suggestions** — cards on the home view (stale repos, dirty-and-unpushed, etc.).
- **LLM auto-tagging** — Ollama-first / OpenAI-fallback background job writing `tags(source='smart')`. (The `catalog:smartFilter` IPC channel is already reserved and returns `[]`.)
- **Activity timeline + heatmap.**
- **Semantic search activation** — the LanceDB plumbing exists but embeddings are never written (ATR-018). Turning conceptual search on is really a Phase 4 deliverable; until then the affordance should be hidden or relabeled.

## Phase 5 — Polish & distribution

The "a .dmg you'd put on a release page" phase. None of this is built.

- Multi-theme support (OLED, Slate, Light, High-contrast) + density modes + custom keymaps.
- Snapshots / export-import.
- **Code signing + notarization** — `scripts/notarize.mjs` is currently a no-op; `electron-builder.yml` is unsigned (`identity: null`, `hardenedRuntime: false`).
- **GitHub Actions** signing/notarization on tag push — no `.github/` directory exists yet.
- **Auto-update** — `electron-updater` is a dependency but imported nowhere; needs a GitHub Releases feed.
- First-run onboarding window (scan-path selection, default editor/terminal, hotkey).
- Branded DMG background + custom installer layout.

## Phase 6 — Cross-platform & advanced (someday / maybe)

- Linux + Windows builds; port `lsof` process detection to `ss` / `Get-NetTCPConnection`.
- Git worktree + submodule UI.
- Plugin / extension API (mini-Raycast style).
- Multi-machine sync (Turso-backed) — explicitly out of scope per the original brief, but the pure-service architecture leaves the door open.

## Decisions parked here

- **Tauri migration** — NEW-PLAN §2 acknowledges Tauri would cut bundle size ~10×, but the JS-native stack (Drizzle/LanceDB/simple-git) makes Electron the pragmatic choice for a single-user tool. Revisit only if distribution scale ever demands it; the renderer + shared schemas would port unchanged.
- **GitHub API integration** — a WIP `lib/github/` client exists on the `feature/github-api-integration` branch and as dead code in the tree. Not wired to either app. If it's wanted, it belongs in a Phase 4 "GitHub metadata" work item; otherwise delete it (tracked as part of ATR-013).

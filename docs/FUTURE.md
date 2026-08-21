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
- **Semantic search activation** — ~~embeddings are never written~~ the write path shipped in Wave 3 (ATR-018); vectors are produced whenever Ollama is reachable. What remains here is making conceptual search a first-class, always-on feature rather than an Ollama-gated best effort.

## Phase 5 — Polish & distribution

> **Promoted out of this file on 2026-08-21.** Phase 5 is now in scope and tracked as
> **ATR-046…052** in [`REMAINING-WORK.md`](./REMAINING-WORK.md); the list below is kept as
> the original scoping note. Nothing here is built yet — ATR-046 (signing) is blocked on an
> Apple Developer Program membership.

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
- **GitHub API integration** — the WIP `lib/github/` client was **deleted with the legacy stack** on 2026-08-21 (ATR-013), along with the `@octokit/*` deps that only it used. It survives on the `feature/github-api-integration` branch. If GitHub metadata is ever wanted, it returns as a fresh Phase 4 work item built against `src/main`.

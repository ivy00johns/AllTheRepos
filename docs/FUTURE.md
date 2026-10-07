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
- **Semantic search activation** — ~~embeddings are never written~~  the write path shipped in Wave 3 (ATR-018); vectors are produced whenever Ollama is reachable, and since 2026-10-07 they are stored as a `vec0` table inside the app's own SQLite file (`services/vector-store.ts`, the `sqlite-vec` extension) rather than in a LanceDB directory beside it. What remains here is making conceptual search a first-class, always-on feature rather than an Ollama-gated best effort. The round trip — a scan storing a vector, a search coming back ranked with it — is pinned by [`../tests/e2e/semantic-search.spec.ts`](../tests/e2e/semantic-search.spec.ts), which is the only place the two halves meet; that a search which *cannot* reach the vector store says so rather than quietly answering with keywords is pinned alongside it.

## Phase 5 — Polish & distribution

> **Promoted out of this file on 2026-08-21.** Phase 5 is now in scope and tracked as
> **ATR-046…052** in [`REMAINING-WORK.md`](./REMAINING-WORK.md); the list below is kept as
> the original scoping note. Nothing here is built yet — ATR-046 (signing) is blocked on an
> Apple Developer Program membership.

- Multi-theme support (OLED, Slate, Light, High-contrast) + density modes + custom keymaps.
- Snapshots / export-import.
- **Code signing + notarization** — wired end to end and blocked on one thing that is not code: an Apple Developer Program membership, which is the only way to be issued a Developer ID Application certificate. `electron-builder.yml` runs `hardenedRuntime: true` with the real `afterSign: scripts/notarize.mjs`, CI imports the certificate, resolves the identity, demands notarisation and verifies the stapled ticket — and with no certificate the build is ad-hoc signed **by design** (`identity: "-"`), with the release saying so. See [`RELEASING.md`](./RELEASING.md).
- **Signing/notarization in CI** — `.github/workflows/` now checks every push/PR and
  builds + publishes on a `v*` tag; what is missing is a Developer ID certificate, so the
  published artifact is still ad-hoc signed (see [`RELEASING.md`](./RELEASING.md)).
- **Installing an update in-app** — the install half is built and *gated at runtime* rather
  than left out: `@main/services/signing` reads the running bundle's signature and Gatekeeper's
  verdict, `autoDownload` is turned on only when both pass, and the UI offers **Restart to
  install** there and the release page — with the reason — everywhere else. What is missing is
  a certificate for the build to be signed with, not the code.
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
- **An Intel (x86_64) build — the reason it was parked is gone (2026-10-07).** This entry used to explain why a second architecture would cost semantic search: `@lancedb/lancedb` ships prebuilt bindings per platform and **dropped darwin-x64 for good** (last stable `0.22.3`, 2025-11-07, against this repository's `0.27.2`), so an Intel build meant either no vectors or an engine eleven months behind. The three ways out were priced — ship Intel with vectors off, pin the engine to `0.22.3` for everyone, or replace the vector store — and the answer was **stay arm64-only**, reopen when a person asks, and take the replacement if it does.

  **The replacement landed on 2026-10-07.** `services/vector-store.ts` now stores embeddings in a `vec0` table inside the app's own `alltherepos.db`, through `sqlite-vec`, and `@lancedb/lancedb` is out of `package.json`. That table is where FTS5 already lived, the extension publishes a binary for **`darwin-x64` as well as `darwin-arm64`** (plus Linux and Windows), and `pnpm platforms:check` therefore reports `darwin-x64` as buildable instead of naming a missing binary. **No architecture is attached to a feature any more**, and the bundle is one native dependency lighter.

  So there is no longer a *vector-engine* reason for the app to be arm64-only, and this entry is no longer a decision about a database. What is left is ordinary packaging work, unchanged by the switch: `electron-builder.yml` ships `arm64` and nothing else; the DMG name, the `.app` path and the update-feed bundle are hardcoded arm64 in `release.yml` and `scripts/verify-dmg.mjs`; and a second architecture means signing, notarising and testing a second artifact — against Apple having discontinued x86_64, GitHub retiring its Intel runners in Fall 2027, and a user base that builds software on a Mac and is correspondingly unlikely to be on Intel. **The app is still built for arm64 only, deliberately, on those grounds.** What changed is that the reason is now a product choice rather than a missing binary, so making the opposite one is a packaging task and not a rewrite.

  The Intel leg of the Electron E2E job still answers the other half of the question — *does the app run on x86_64?* — and now answers it about the real thing: a second leg (`macos-15-intel`) builds and launches the tree there, and the vector store and semantic-search specs on that leg assert stored vectors and ranking rather than the absence of a binding. The feed itself is fine for two architectures: `electron-updater`'s `MacUpdater` filters `latest-mac.yml`'s files by whether the *filename* contains `arm64`, which is why electron-builder's `…-arm64-mac.zip` / `…-mac.zip` pair is the right naming if Intel is ever built.

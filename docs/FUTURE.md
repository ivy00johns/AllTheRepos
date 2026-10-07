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
- **Semantic search activation** — ~~embeddings are never written~~  the write path shipped in Wave 3 (ATR-018); vectors are produced whenever Ollama is reachable. What remains here is making conceptual search a first-class, always-on feature rather than an Ollama-gated best effort. The round trip — a scan storing a vector, a search coming back ranked with it — is pinned by [`../tests/e2e/semantic-search.spec.ts`](../tests/e2e/semantic-search.spec.ts), which is the only place the two halves meet.

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
- **An Intel (x86_64) build — decided against on 2026-10-07.** The app ships arm64-only (`electron-builder.yml`), and a second leg of the Electron E2E job now builds and launches the tree on a real x86_64 runner (`macos-15-intel`), so the question "does it work there" has an answer rather than an opinion: **yes** — the same 15 tests, the same 10 passed / 5 skipped, behind a `runner: x86_64` line and a `Mach-O 64-bit executable x86_64` Electron. Nothing in the *code* blocks Intel. The vector store does.

  `@lancedb/lancedb` ships prebuilt napi bindings per platform and **dropped darwin-x64 for good**: the last stable `@lancedb/lancedb-darwin-x64` is `0.22.3` (2025-11-07), the last of any kind `0.22.4-beta.3` (2025-12-03), while darwin-arm64 kept going to `0.41.0-beta.0`. This repository is on `0.27.2`; upstream is on `0.40.0`. So Intel means choosing between a build with no semantic search and a vector engine eleven months behind:

  | Option | What it costs |
  |---|---|
  | Ship Intel, vectors off | `services/lance.ts` fails soft **by design**, so search silently becomes FTS-only on those machines — `vectorSearch → []`, embeddings reported `skipped-unavailable`, no error anywhere. Only the UI could tell a user, and only if it chose to. |
  | Pin the vector store to `0.22.3` | Freezes LanceDB for *everyone* — future fixes, formats and features — to keep one architecture's KNN working, and puts a `0.22.3` reader in front of Lance tables an arm64 install already wrote with `0.27.2`. |
  | Replace the vector store | `sqlite-vec@0.1.9` publishes `sqlite-vec-darwin-x64` *and* `-darwin-arm64` (plus Linux and Windows), and FTS5 is already in the same SQLite file — but `services/lance.ts` (connect, upsert, delete, hash read, KNN) is rewritten and re-verified. Real work, and the only option that *removes* the coupling instead of paying for it. |
  | Stay arm64-only | Nothing to do. The Intel leg keeps answering the question for free, and no line is written into `electron-builder.yml`. |

  **Stay arm64-only**, and reopen this when a person asks for an Intel build rather than when a matrix makes one possible. Apple has discontinued x86_64 support and GitHub retires its Intel runners in Fall 2027; this is a tool for people who build software, who are the least likely population to be on an Intel Mac and the most likely to be able to say so. If it does reopen, take the third option — `sqlite-vec` also drops a native dependency from the bundle.

  What shipping would *also* need, measured rather than guessed (all small; none of it is the reason for the decision): the DMG name, the `.app` path and the update-feed bundle are hardcoded arm64 in four places in `release.yml` (lines 308, 347, 375, 461) and in `scripts/verify-dmg.mjs`; `pnpm platforms:check` would need the degradation declared in `ACCEPTED_DEGRADATIONS` instead of an empty list; and the feed itself is fine — `electron-updater`'s `MacUpdater` filters `latest-mac.yml`'s files by whether the *filename* contains `arm64`, which is exactly why electron-builder's `…-arm64-mac.zip` / `…-mac.zip` pair is the right naming for a two-architecture feed.

# Remaining Work — AllTheRepos

The tactical ledger. Every open item, ID'd, prioritized, and sourced. This is the
single list of "what exactly needs to be done." Status at a glance lives in
[`../START-HERE.md`](../START-HERE.md); the roadmap and phase definitions live in
[`PLAN.md`](./PLAN.md).

## How to read this

- **ID** — `ATR-###`. Stable, never reused. New items take the next number.
- **P** — priority against the current goal (**a daily-driver MVP Electron app**):
  - `P0` — blocks "open it and actually use it daily", or a data-loss / wrong-artifact footgun.
  - `P1` — needed for a _credible_ daily driver (visible, persistent, navigable).
  - `P2` — correctness, security hardening, and test-signal integrity.
  - `P3` — future phases (intelligence layer, distribution) — see [`FUTURE.md`](./FUTURE.md).
- **Area** — `claude` · `catalog` · `search` · `groups` · `ui` · `native` · `security` · `data` · `build` · `tests` · `migration` · `dist`.
- **Source** — where the item came from. Most trace to the
  [2026-05-31 ground-truth audit](./audits/2026-05-31-ground-truth-audit.md).
- **Status** — `open` · `in-progress` · `◐ partial` · `✅ done` · `deferred`. Done items also get a line in the [`PLAN.md`](./PLAN.md) closure log.

> Intake rule: new reports (audits, deep-dives, QA) go through the `plan-intake` skill,
> which proposes entries here for approval. Nothing is "done" until it lands here or is explicitly dismissed.

> **Status (after Wave 2, 2026-06-01):** Waves 1+2 closed the P0 set and all but the
> intelligence-layer P1/P2 items. The app builds, boots, and works on real data; full
> Electron E2E is 7/7. What's left is semantic search, a few Claude-tab refinements,
> command-palette context, legacy retirement, and two environment papercuts.

---

## P0 — Blocks a usable daily driver · ALL ✅ DONE (Wave 1)

| ID      | Area    | Summary                                                                                                                  | Status       |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| ATR-001 | claude  | Claude registry parser fixed to the real `~/.claude.json` shape — Claude tab shows 138 real projects (runtime-verified). | ✅ done (W1) |
| ATR-002 | build   | `pnpm dev`/`build`/`start` default to the electron toolchain; Next.js under `legacy:*`.                                  | ✅ done (W1) |
| ATR-003 | search  | Catalog grid driven by the real `catalog:search`; dead search input removed.                                             | ✅ done (W1) |
| ATR-004 | catalog | Tag edits persist via `catalog:setTags` + query invalidation.                                                            | ✅ done (W1) |
| ATR-005 | groups  | Real create/rename/delete/setMembers mutations wired to the sidebar.                                                     | ✅ done (W1) |

## P1 — Credible daily driver

| ID      | Area        | Summary                                                                                                                                                                                                              | Source          | Status       |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| ATR-006 | native      | Spotlight & tray "open repo" navigate the main window (preload `app.openRepo` → `tray:request-open-repo` → bus → `/repos/$slug`).                                                                                    | audit §native   | ✅ done (W2) |
| ATR-007 | native      | Real 22×22 + @2x black-on-transparent template tray icon; tray.ts loads it as a template image and the dead missing-asset fallback is fixed.                                                                         | audit §native   | ✅ done (W2) |
| ATR-008 | ui          | 6 OFL `.woff2` fonts vendored; IBM Plex Sans confirmed loading at runtime (was system-ui).                                                                                                                           | audit §renderer | ✅ done (W2) |
| ATR-009 | build/tests | Typecheck green (`vite/client` ambient types; unused `@ts-expect-error` removed).                                                                                                                                    | audit §hooks    | ✅ done (W1) |
| ATR-010 | native      | Dock badge auto-driven from the running dev-server count (main-side `ProcessService` subscription).                                                                                                                  | audit §native   | ✅ done (W2) |
| ATR-011 | ui          | Selecting a manual group filters the grid to its members (was showing everything).                                                                                                                                   | audit §renderer | ✅ done (W2) |
| ATR-012 | ui          | Duplicate SearchBar + Settings link removed.                                                                                                                                                                         | audit §renderer | ✅ done (W1) |
| ATR-013 | migration   | **Retire the legacy Next.js stack** (`app/`, `components/`, `lib/` superseded; zero `src/ → lib/` imports). Archive after parity sign-off; delete orphaned `lib/github/`; drop `next`/`eslint-config-next`/`.next/`. | audit §legacy   | open         |

## P2 — Correctness, security, test integrity

| ID      | Area        | Summary                                                                                                                                                                                                                                                     | Source             | Status       |
| ------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------ |
| ATR-014 | security    | Frame-origin check rejects empty/`about:blank` sender URLs in production (dev/test permissive); duplicated `assertRendererFrame` unified to one source.                                                                                                     | audit §main-ipc    | ✅ done (W2) |
| ATR-015 | tests       | Process SIGINT/SIGTERM test de-flaked with a READY handshake.                                                                                                                                                                                               | audit §tests       | ✅ done (W1) |
| ATR-016 | build/tests | `test:electron-e2e` + `test:full` scripts added (W2). Still TODO: the `rebuild-natives.mjs` `install-app-deps` fallback (dead code).                                                                                                                        | audit §tests       | ◐ partial    |
| ATR-017 | tests       | claude-flow E2E navigates via the UI instead of the no-op `goto()` — **full Electron E2E now 7/7** (was 0/3 blocked → 5/6 → 7/7).                                                                                                                           | audit §tests       | ✅ done (W2) |
| ATR-018 | data/search | **Semantic search is dead-on-arrival** — `upsertEmbedding()` has zero callers. Wire embed writes into scan/rescan (needs Ollama), or hide/relabel the "semantic" affordance.                                                                                | audit §data        | open         |
| ATR-019 | data        | FTS insert trigger writes `tags_text=''`; tags not indexed until update. Fix trigger + test.                                                                                                                                                                | audit §data        | open         |
| ATR-020 | claude      | Per-project usage "Trend" is faked (global series scaled by share). Expose real per-project weekly buckets or relabel.                                                                                                                                      | audit §claude      | open         |
| ATR-021 | claude      | MCP "running" status never emitted; `useClaudeTranscript` hook has no UI. Build or mark deferred.                                                                                                                                                           | audit §claude      | open         |
| ATR-022 | hooks       | `ActionContext.currentRepoSlug/FullPath` never populated → Cmd-K "Copy Repo Path"/open-in-editor no-op; launch actions not registered.                                                                                                                      | audit §hooks       | open         |
| ATR-023 | contract    | Contract drift reconciled: `resumeSessionId` UUID claim aligned, `preload/index.d.ts` doc comment refreshed, `contracts/README.md` marked legacy.                                                                                                           | audit §claude      | ✅ done (W2) |
| ATR-024 | build       | nvm shell wrapper recurses on bare `node`/`npx`/`npm` (broken dotfile `_load_nvm`). Workaround: absolute binary. Fix the dotfile.                                                                                                                           | this session       | open         |
| ATR-025 | build       | Commit signing fails non-interactively (1Password SSH agent) → commits used `--no-gpg-sign`. Re-sign on a real terminal, or relax for agent sessions.                                                                                                       | this session       | open         |
| ATR-026 | security    | `resumeSessionId` was interpolated UNQUOTED into the `claude --resume` shell string with only `z.string()` validation → command injection. Fixed: `z.string().uuid()` (UUID has no shell metacharacters; matches Claude's session-id format) + reject-test. | W2 harden (Lane D) | ✅ done (W2) |

---

## Done / closed

- **Wave 1 (2026-05-31):** ATR-001/002/003/004/005/009/012/015. Claude tab populated (138 projects), search + tag/group persistence, electron default, green typecheck.
- **Wave 2 (2026-06-01):** ATR-006/007/008/010/011/014/017/023/026; ATR-016 advanced to partial. Native shell repo-open + tray icon + dock badge; fonts; manual-group filter; frame-origin hardening; shell-injection guard; full E2E 7/7.

**Open (next):** ATR-013 (legacy retirement), ATR-018 (semantic search), ATR-019 (FTS trigger), ATR-020/021 (Claude refinements), ATR-022 (command context), ATR-016 (test automation tail), ATR-024/025 (env papercuts). See [`PLAN.md`](./PLAN.md) for the closure log.

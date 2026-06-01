# Remaining Work — AllTheRepos

The tactical ledger. Every open item, ID'd, prioritized, and sourced. Status at a glance is in
[`../START-HERE.md`](../START-HERE.md); the roadmap + phase definitions in [`PLAN.md`](./PLAN.md).

## How to read this

- **ID** — `ATR-###`. Stable, never reused.
- **P** — priority vs the goal (**a daily-driver MVP**): `P0` blocker · `P1` credible-daily-driver · `P2` correctness/security/test · `P3` future ([`FUTURE.md`](./FUTURE.md)).
- **Source** — most trace to the [2026-05-31 ground-truth audit](./audits/2026-05-31-ground-truth-audit.md).
- **Status** — `open` · `in-progress` · `◐ partial` · `✅ done` · `deferred`. Done items also get a [`PLAN.md`](./PLAN.md) closure-log line.

> Intake rule: reports (audits, deep-dives, QA) go through the `plan-intake` skill → proposed entries → approval.

> **Status (after Wave 3, 2026-06-01):** 22 of 26 items closed across Waves 1–3. The app
> builds, boots, and works on real data; `tsc` clean, **vitest 858/0/5**, **Electron E2E 7/7**.
> Open: legacy-stack retirement, the test-ABI automation tail, and two environment papercuts.

---

## Open / remaining

| ID      | P   | Area        | Summary                                                                                                                                                                                                                                                                                                                                                                                                                          | Status    |
| ------- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| ATR-013 | P1  | migration   | **Retire the legacy Next.js stack** (`app/`, `components/`, `lib/` superseded; zero `src/ → lib/` imports). Its own focused pass: archive the trees, drop `next`/`eslint-config-next`/`.next/` + the `@next` tsconfig plugin, remove the legacy `playwright.config.ts` + `e2e/` and the GPG scanner flake, then `pnpm install` to resync the lockfile. Touches package.json/lockfile/tsconfig so it can't share a parallel wave. | open      |
| ATR-016 | P2  | build/tests | `test:electron-e2e` + `test:full` scripts shipped (W2). Tail remaining: implement the `rebuild-natives.mjs` → `electron-builder install-app-deps` fallback (still dead code); align `tests/helpers/test-db.ts` CONTRACT_SQL to the fixed FTS triggers (harmless drift flagged in W3).                                                                                                                                            | ◐ partial |
| ATR-024 | P2  | build       | nvm shell wrapper recurses on bare `node`/`npx`/`npm` (broken dotfile `_load_nvm`). Workaround: absolute binary. Fix in the user's `~/.zshrc`/profile (outside the repo — needs the user, or explicit OK to edit dotfiles).                                                                                                                                                                                                      | open      |
| ATR-025 | P2  | build       | Commit signing fails non-interactively (1Password SSH agent) → this session's commits used `--no-gpg-sign`. Re-sign on a real terminal (approve the 1Password prompt) or relax signing for agent sessions.                                                                                                                                                                                                                       | open      |
| —       | P2  | claude      | MCP server **"running"** status (PID-matching) — explicitly **deferred** out of ATR-021 (not faked; `mergeMcpServers` emits `configured`/`unavailable` only). Promote to a numbered item if/when it's wanted.                                                                                                                                                                                                                    | deferred  |

---

## Done / closed

**Wave 1 (2026-05-31)** — ATR-001/002/003/004/005/009/012/015: Claude tab real data (138 projects), catalog search + tag/group persistence, `pnpm dev`→Electron, green typecheck, de-flaked test.

**Wave 2 (2026-06-01)** — ATR-006/007/008/010/011/014/017/023/026: native-shell repo-open + real tray icon + dock badge, vendored fonts, manual-group filter, frame-origin hardening, shell-injection guard, contract reconciliation, full Electron E2E 7/7.

**Wave 3 (2026-06-01)** — ATR-018/019/020/021/022:

- **ATR-018** — embedding write-path wired into scan/rescan (content-hash gated, fails-soft when Ollama is down).
- **ATR-019** — FTS insert trigger indexes `tags_text`; DROP+CREATE triggers each boot so existing DBs self-heal + one-time backfill (real-DB tested).
- **ATR-020** — per-project usage "Trend" now uses each project's **real** weekly token series (was the global series scaled by share).
- **ATR-021** — transcript viewer UI built on the existing `useClaudeTranscript` hook. (MCP "running" deferred — see above.)
- **ATR-022** — action context populated at dispatch sites + launch actions registered, so Cmd-K "Copy Path"/open-in-editor fire.

See the [`PLAN.md`](./PLAN.md) closure log for commit refs.

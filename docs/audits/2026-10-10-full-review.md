# Full review — 2026-10-10

Scope: a top-to-bottom pass for data-damage risk, security, UI/UX, launcher dispatch,
ports, demo data and tags, after the reported "every button was tested" claim.

## Verified in this pass

| Check | Result |
| --- | --- |
| `pnpm typecheck` (all three tsconfigs) | Clean (exit 0) |
| `pnpm exec vitest run` | 109 files, 2108 tests passed |
| Electron e2e, full suite (`playwright.electron.config.ts`) | 45 passed, 2 failed, 5 skipped |
| Electron e2e, targeted recheck (launcher, nav a11y, process, workstream C, window restore) | 13/13 passed |

Verified behaviour in the real Electron app:

- **Launcher dispatch.** Finder and GitHub actions dispatch real repo paths and normalised
  remotes; the OS shell is intercepted. Clipboard round trip is real. Launcher failures stay
  visible on inline catalog cards.
- **Real port detection.** A test-spawned listener was attributed to its repo, appeared in
  `/processes` after about 95 ms, and cleared about 816 ms after a confirmed kill.
- **Nav.** Five destinations are named at the 800 px minimum (Repos added; Debug excluded
  from packaged builds).
- **No-provider search.** With no embedding provider, search answers with keywords and
  states why.

## Still failing or open

1. **Catalog visual baselines (`catalog-visual.spec.ts`), all three view modes.** The diff
   is 851 px per view, in two bands:
   - y 1–47 (top bar, about 6,300 px): the intended new Repos nav button.
   - y 145–267 (content, about 460 px): not yet attributed. Review the actual vs expected
     PNGs in `test-results/catalog-visual-…/` before regenerating baselines. Do not regenerate
     blindly, or the content change is hidden.
2. **Window restore (`window-route-restore.spec.ts`, quit and restore to the map).** Timed out
   at 60 s in both full runs, and passed in the targeted run. Under full-suite load a different
   60 s timeout (viewport-fit) also fired, followed by a worker teardown timeout. Treat as
   load-sensitive until the timeouts are profiled. It is not confirmed as a product bug.
3. **Ollama live round trip.** Not confirmed in this pass. Only the no-provider path was
   verified. A live Ollama embed/search on this machine is still required before the
   "fetch failed" report can be called fixed.

## Limits

- Browser-tab ports and repo data come from the demo fixtures, not from live detection. Only
  the Electron run exercised real listeners.
- Diff size is 61 files, +672/−4,024. The large removals (notably `demo-store.spec.ts`,
  `demo-library.spec.ts`) need a line-by-line review before merge.

## Plan

Useful tags (ATR-076): deterministic purpose and framework tags from manifests first, languages
kept as metadata, a reviewable cleanup preview, then optional local Ollama cleanup with strict
JSON output. See [the tagging plan](../plans/2026-10-10-useful-repo-tags.md), tracked in
[REMAINING-WORK](../REMAINING-WORK.md#user-requested-addition-2026-10-10).

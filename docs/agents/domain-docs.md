# Agent config — domain docs / context layout

**Layout:** single-context.

This is one application (a macOS Electron desktop app), not a multi-service monorepo, so a
single shared context is correct.

- **Project context / front door:** [`../../START-HERE.md`](../../START-HERE.md) → [`../PLAN.md`](../PLAN.md) → [`../REMAINING-WORK.md`](../REMAINING-WORK.md).
- **Architecture of record:** [`../../NEW-PLAN.md`](../../NEW-PLAN.md) (frozen) + the per-subsystem map in [`../../README.md`](../../README.md).
- **Architecture decision records (ADRs):** none yet. If a decision needs recording, create `docs/adr/NNNN-title.md`; until then, architecture rationale lives in `NEW-PLAN.md` and design decisions in the contract docs.
- **No per-package `CONTEXT.md` files** — the codebase is small enough that `src/main`, `src/renderer`, `src/preload`, `src/shared` are self-evident from the README structure section.

Agents should read the wiki/front-door docs before crawling source. There is no Obsidian
wiki (`index.md` + `wiki/`) for this project; the living-plan docs are the equivalent.

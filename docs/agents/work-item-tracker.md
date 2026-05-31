# Agent config — work-item tracker

**Tracker:** local markdown (the living-plan ledger + a `briefs/` folder). No external tracker.

There is **no git remote** on this repo and no Beads (`bd`) install, so work items live in
version control as markdown.

- **Ledger:** [`../REMAINING-WORK.md`](../REMAINING-WORK.md) — the canonical list. Items are
  `ATR-###`, prioritized, sourced, with a status. This is where new work is logged.
- **Closure log:** [`../PLAN.md`](../PLAN.md) — when an item closes, drop a line here.
- **Briefs:** when a ledger item needs a full implementation spec, the `work-item-brief`
  skill expands it into `briefs/ATR-###-<slug>.md`. (Create the `briefs/` directory on first use.)
- **Intake:** new reports → `plan-intake` skill → proposed ledger entries → human approval.

**For orchestrated builds:** wire the work-item handoff at the end of a build to append/close
entries in `REMAINING-WORK.md` (not GitHub issues, not `bd`). If a GitHub remote is added
later, revisit this choice.

/**
 * Tag cleanup — review what a re-tag would change, then accept or reject each repo.
 *
 * Opening the dialog re-runs the tagger read-only. Nothing is written until the
 * user confirms. A rejected change is remembered, so later rescans keep the
 * user's answer. User tags are never part of a proposal.
 */

import * as React from "react";
import { Tags } from "lucide-react";

import type { TagCleanupProposal } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  useApplyTagCleanup,
  useTagCleanupPreview,
} from "@renderer/hooks/use-repos";
import { cn } from "@renderer/lib/cn";

type Decision = "accept" | "reject";

/** The toolbar entry point. Owns the dialog it opens. */
export function TagCleanupButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="atr-segment"
        aria-label="Tag cleanup"
        title="Review the heuristic tags the tagger would change"
      >
        <Tags className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden xl:inline">Tag cleanup</span>
      </button>
      <TagCleanupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function TagCleanupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const preview = useTagCleanupPreview(open);
  const apply = useApplyTagCleanup();
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>(
    {},
  );

  // Start clean each time the dialog opens, so an old answer never attaches to a
  // fresh proposal list.
  React.useEffect(() => {
    if (open) setDecisions({});
  }, [open]);

  const decidedCount = Object.keys(decisions).length;
  const proposals = preview.data?.proposals ?? [];

  const setDecision = (slug: string, decision: Decision) => {
    setDecisions((prev) => ({ ...prev, [slug]: decision }));
  };

  const submit = () => {
    apply.mutate(
      {
        decisions: Object.entries(decisions).map(([slug, decision]) => ({
          slug,
          decision,
        })),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review tag changes</DialogTitle>
          <DialogDescription>
            Heuristic tags are recomputed from each repo&apos;s manifests. Your
            own tags are never changed. Accept writes the proposed set. Keep
            current leaves the repo as it is and stops these changes from being
            suggested again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-4">
          {preview.isPending ? (
            <p className="py-2 text-body text-muted-foreground">Reading tags…</p>
          ) : preview.isError ? (
            <p role="alert" className="py-2 text-body text-destructive">
              Could not read tag changes: {preview.error.message}
            </p>
          ) : proposals.length === 0 ? (
            <p className="py-2 text-body text-muted-foreground">
              Every repo&apos;s heuristic tags already match the rules.
              {preview.data && preview.data.unreadable > 0
                ? ` ${preview.data.unreadable} repo(s) are missing from disk and were left alone.`
                : null}
            </p>
          ) : (
            <>
              <p className="text-body text-muted-foreground">
                {proposals.length} repo(s) would change
                {preview.data && preview.data.unreadable > 0
                  ? `; ${preview.data.unreadable} missing from disk were left alone`
                  : ""}
                .
              </p>
              <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto border-t border-border">
                {proposals.map((p) => (
                  <ProposalRow
                    key={p.slug}
                    proposal={p}
                    decision={decisions[p.slug]}
                    onDecide={(d) => setDecision(p.slug, d)}
                  />
                ))}
              </ul>
            </>
          )}

          {apply.isError ? (
            <p role="alert" className="text-label text-destructive">
              Could not apply: {apply.error.message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="bordered"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={decidedCount === 0 || apply.isPending}
          >
            {apply.isPending
              ? "Applying…"
              : `Apply ${decidedCount} decision${decidedCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProposalRow({
  proposal,
  decision,
  onDecide,
}: {
  proposal: TagCleanupProposal;
  decision: Decision | undefined;
  onDecide: (decision: Decision) => void;
}): React.JSX.Element {
  const chip = "rounded px-1.5 py-0.5 font-mono text-meta";
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-body font-medium">{proposal.name}</span>
        <div
          role="group"
          aria-label={`Decision for ${proposal.name}`}
          className="flex shrink-0 gap-1"
        >
          <button
            type="button"
            aria-pressed={decision === "accept"}
            data-active={decision === "accept" ? "true" : "false"}
            onClick={() => onDecide("accept")}
            className={cn(
              "atr-segment",
              decision === "accept" && "font-semibold",
            )}
          >
            Accept
          </button>
          <button
            type="button"
            aria-pressed={decision === "reject"}
            data-active={decision === "reject" ? "true" : "false"}
            onClick={() => onDecide("reject")}
            className={cn(
              "atr-segment",
              decision === "reject" && "font-semibold",
            )}
          >
            Keep current
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {proposal.added.map((v) => (
          <span key={`+${v}`} className={cn(chip, "bg-muted text-foreground")}>
            + {v}
          </span>
        ))}
        {proposal.removed.map((v) => (
          <span
            key={`-${v}`}
            className={cn(chip, "bg-muted text-muted-foreground line-through")}
          >
            − {v}
          </span>
        ))}
      </div>
    </li>
  );
}

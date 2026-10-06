/**
 * The vocabulary of curated links, in one place.
 *
 * The panel reads "9router depends on AIS-OS" and the curate dialog offers
 * the same kinds by name, so the labels and the sentence builder sit
 * together: a kind that reads one way in the list and another in the
 * picker is a bug nobody notices until it has been on screen for a month.
 */

import type { RepoLinkKind } from "@shared/types";

/** Labels for `repo_links.kind`, phrased to read mid-sentence. */
export const LINK_KIND_LABELS: Record<RepoLinkKind, string> = {
  "part-of": "part of",
  "depends-on": "depends on",
  supersedes: "supersedes",
  "forked-from": "forked from",
  related: "related to",
};

/**
 * The order the picker offers kinds in.
 *
 * Structural claim first. `part-of` is the link that makes the map
 * actionable for reorganising folders, so it is the one a hurried user
 * should land on — not `related`, which asserts the least.
 */
export const LINK_KINDS: readonly RepoLinkKind[] = [
  "part-of",
  "depends-on",
  "forked-from",
  "supersedes",
  "related",
];

/**
 * One link as a sentence.
 *
 * Direction is kept rather than normalised, because `part-of` reads very
 * differently each way: "app is part of monorepo" is a different claim
 * from "monorepo is part of app". The sentence names both ends in the
 * order the assertion actually points.
 */
export function linkSentence(input: {
  kind: RepoLinkKind;
  direction: "outgoing" | "incoming";
  selfName: string;
  otherName: string;
}): string {
  const label = LINK_KIND_LABELS[input.kind];
  return input.direction === "outgoing"
    ? `${input.selfName} ${label} ${input.otherName}`
    : `${input.otherName} ${label} ${input.selfName}`;
}

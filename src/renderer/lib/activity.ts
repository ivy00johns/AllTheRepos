/**
 * Repo activity / recency.
 *
 * Every card in the old catalog read "last commit 4mo ago". A hundred
 * identical strings convey nothing — the eye can't rank them, so the
 * single most useful sorting signal in the whole app was invisible.
 *
 * This module buckets a timestamp into a small ordinal scale so recency
 * can be encoded as POSITION and COLOR (which the eye reads instantly)
 * with the exact text kept as a secondary detail. Colour is never the
 * only channel: each bucket also has a distinct label and its own
 * position in the scale.
 *
 * PURE module: no DOM, no Node, no IPC.
 */

/** Ordinal recency buckets, freshest first. */
export type ActivityLevel =
  | "active"
  | "warm"
  | "cooling"
  | "idle"
  | "dormant"
  | "unknown";

export interface ActivityInfo {
  level: ActivityLevel;
  /** Whole days since the timestamp; `null` when unknown. */
  days: number | null;
  /** Short label for chips: "This week", "Dormant", … */
  label: string;
  /** Relative phrase for inline text: "4 months ago". */
  relative: string;
  /**
   * 0–1 heat value used for the recency bar width and colour mix.
   * 1 = touched today, 0 = a year or more ago / unknown.
   */
  heat: number;
  /** CSS colour token for the bucket. Paired with a label everywhere. */
  color: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound in days for each bucket, checked in order. */
const THRESHOLDS: Array<{ level: ActivityLevel; maxDays: number }> = [
  { level: "active", maxDays: 7 },
  { level: "warm", maxDays: 30 },
  { level: "cooling", maxDays: 90 },
  { level: "idle", maxDays: 365 },
];

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  active: "This week",
  warm: "This month",
  cooling: "Last 3 months",
  idle: "This year",
  dormant: "Over a year",
  unknown: "Never committed",
};

/**
 * Bucket colours run a single warm→cold ramp so the scale reads as one
 * continuous axis. `active` deliberately uses the app accent so the
 * freshest work matches the app's primary colour.
 */
export const ACTIVITY_COLORS: Record<ActivityLevel, string> = {
  active: "var(--color-activity-active)",
  warm: "var(--color-activity-warm)",
  cooling: "var(--color-activity-cooling)",
  idle: "var(--color-activity-idle)",
  dormant: "var(--color-activity-dormant)",
  unknown: "var(--color-activity-unknown)",
};

/** Display order for grouping and for the legend. */
export const ACTIVITY_ORDER: readonly ActivityLevel[] = [
  "active",
  "warm",
  "cooling",
  "idle",
  "dormant",
  "unknown",
];

/**
 * Human relative time. Kept here (rather than reusing the catalog's
 * `relativeTime`) so a single call yields both the bucket and the
 * phrase from one parse of the timestamp.
 */
function relativePhrase(days: number): string {
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  const remainder = days - years * 365;
  if (years === 1 && remainder > 180) return "over 1.5 years ago";
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/**
 * Classify an ISO-8601 timestamp.
 *
 * `now` is injectable so tests are deterministic and so a list render can
 * pass one shared timestamp instead of re-reading the clock per row.
 */
export function activityOf(
  iso: string | null | undefined,
  now: number = Date.now(),
): ActivityInfo {
  if (!iso) {
    return {
      level: "unknown",
      days: null,
      label: ACTIVITY_LABELS.unknown,
      relative: "never",
      heat: 0,
      color: ACTIVITY_COLORS.unknown,
    };
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return {
      level: "unknown",
      days: null,
      label: ACTIVITY_LABELS.unknown,
      relative: "unknown",
      heat: 0,
      color: ACTIVITY_COLORS.unknown,
    };
  }

  const days = Math.max(0, Math.floor((now - parsed) / DAY_MS));
  const level =
    THRESHOLDS.find((t) => days <= t.maxDays)?.level ?? ("dormant" as const);

  // Log-shaped falloff: the first month of staleness matters far more
  // than the difference between two and three years, and a linear ramp
  // would flatten every older repo to the same value.
  const heat = Math.max(0, 1 - Math.log10(1 + days) / Math.log10(1 + 730));

  return {
    level,
    days,
    label: ACTIVITY_LABELS[level],
    relative: relativePhrase(days),
    heat,
    color: ACTIVITY_COLORS[level],
  };
}

/**
 * The most recent of a repo's timestamps — the honest answer to "when did
 * I last touch this". A repo you opened in an editor yesterday but never
 * committed to is NOT dormant, and sorting purely on commit date buries it.
 */
export function lastTouched(repo: {
  lastCommitDate: string | null;
  lastOpenedAt: string | null;
}): string | null {
  const candidates = [repo.lastCommitDate, repo.lastOpenedAt].filter(
    (v): v is string => Boolean(v),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

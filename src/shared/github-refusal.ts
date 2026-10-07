/**
 * "GitHub declined to answer" — one definition, three readers.
 *
 * The update check is anonymous on purpose: that is what makes it work on
 * somebody else's machine rather than only on the one that built the app. The
 * cost of anonymity is that an address gets 60 API requests an hour, shared
 * with every other process on the connection, and when the allowance is gone
 * GitHub answers `403` (or `429`) instead of answering anything. That status is
 * **not a verdict on the feed** — no release went missing, nothing rotted — and
 * three separate places have to agree about what it means:
 *
 *   - `src/main/services/updater.ts` shows a person the sentence below, rather
 *     than electron-updater's raw `HttpError` with every response header in it;
 *   - `scripts/check-updater-feed.mjs` exits `2` — "could not run" — instead of
 *     failing, so a weekly gate does not go red on somebody else's spending;
 *   - `tests/e2e/packaged-update-check.spec.ts` stops with a reason, which is
 *     the whole reason `scripts/refused-update-check.mjs` exists: a skip path
 *     nobody exercises is indistinguishable from a guard that stopped guarding.
 *
 * They used to agree **by convention** — a copied `isRefusal` here, a string
 * literal there, and a `raw.includes("401")` chain in the app — which is a
 * three-way drift waiting for its first edit. The statuses and the two sentences
 * now live in `github-refusal.json` beside this file, and everything reads it.
 *
 * **Why JSON rather than this module alone.** Two of the readers are plain Node
 * scripts (`scripts/check-updater-feed.mjs`, `scripts/refused-update-check.mjs`)
 * run by `node` with no build step, and Node cannot import a `.ts` file on the
 * versions this project supports. Every format that both a script and the
 * bundled TypeScript can read is data, so the data is what is shared; this
 * module is the typed, commented view of it, and it *re-exports* the values
 * rather than restating them, so there is nothing here to drift.
 *
 * The `401` is deliberate and is not a rate limit in the usual sense: an
 * anonymous read that comes back "who are you?" has been refused just as surely
 * as one that came back "you have asked too often", and a person can act on
 * neither of them. What must *not* be in this set is `404` — an anonymous reader
 * gets that for a release that does not exist and for a repo it is not allowed
 * to see, and both of those are real rot worth failing on.
 */

import refusal from "./github-refusal.json";

/**
 * The statuses that mean GitHub declined to answer.
 *
 * Read from the shared data rather than written here: see the header for why
 * that file exists and why this one does not carry a second copy.
 */
export const REFUSED_STATUSES: readonly number[] = refusal.refusedStatuses;

/** Is this HTTP status a refusal, rather than something about the feed? */
export function isRefusalStatus(status: number): boolean {
  return REFUSED_STATUSES.includes(status);
}

/**
 * The same question asked of an error's text, because that is the shape
 * electron-updater hands back: an `HttpError` whose message carries the status
 * inside a dump of headers, not a status it lets us read as a number.
 *
 * A substring test, and it is the one the app has always used — `"4013"` in some
 * unrelated number would match it, and narrowing it to a parsed status is a
 * change to the app's behaviour rather than to where the words come from. This
 * refactor moves the *definition*, not the matching.
 */
export function isRefusalText(raw: string): boolean {
  return REFUSED_STATUSES.some((status) => raw.includes(String(status)));
}

/**
 * How the refusal is named in a log or a skip reason.
 *
 * The same words in the app's sentence, the feed checker's error and the e2e
 * spec's skip reason, so one grep over a run finds all three.
 */
export const ANONYMOUS_READ_REFUSAL: string = refusal.anonymousRead;

/** What a person is shown when a check could not run — and told to try again. */
export const REFUSED_REQUEST_MESSAGE: string = refusal.requestRefused;

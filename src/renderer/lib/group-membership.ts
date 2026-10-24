/**
 * Membership arithmetic for manual groups.
 *
 * `groups:setMembers` replaces the ENTIRE member set — there is no `addMember`
 * channel. So "add these repos to that group" is a read-modify-write: read the
 * current members, union them with the selection, write the result back. The
 * union has to be computed against the set that was just read, not against a
 * `repoCount` or a member list cached earlier: writing back a stale union
 * silently removes every repo somebody else put in the group in the meantime.
 *
 * Kept pure and free of React so the arithmetic — which is the part that can be
 * wrong in a way that loses data — is testable without rendering anything
 * (`tests/unit/renderer/group-membership.spec.ts`).
 */

/** Dedupe, keeping first-seen order so a write is not a reshuffle. */
function unique(slugs: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/**
 * The full member set after adding `slugs` to `current`.
 *
 * Existing members keep their position; the additions are appended in the order
 * they were given. Slugs already in the group are absorbed rather than
 * duplicated — `setGroupMembersBySlugs` would dedupe them anyway, but a caller
 * comparing counts (and the tests) should not have to know that.
 */
export function addGroupMembers(
  current: Iterable<string>,
  slugs: Iterable<string>,
): string[] {
  const members = unique(current);
  const present = new Set(members);
  for (const slug of unique(slugs)) {
    if (present.has(slug)) continue;
    present.add(slug);
    members.push(slug);
  }
  return members;
}

/**
 * The full member set after taking `slugs` out of `current`.
 *
 * Removing something that was never a member is a no-op, not an error: the
 * same button is offered for any selection, and a repo that joined the group
 * twice through two windows is still just absent afterwards.
 */
export function removeGroupMembers(
  current: Iterable<string>,
  slugs: Iterable<string>,
): string[] {
  const drop = new Set(slugs);
  return unique(current).filter((slug) => !drop.has(slug));
}

/**
 * The requested slugs that are NOT members yet — what an add would move.
 *
 * The UI reports this rather than the size of the selection, so adding a repo
 * that is already in the group says "0 added" instead of claiming a change it
 * did not make.
 */
export function slugsNotInGroup(
  current: Iterable<string>,
  slugs: Iterable<string>,
): string[] {
  const present = new Set(current);
  return unique(slugs).filter((slug) => !present.has(slug));
}

/** The requested slugs that ARE members — what a removal would move. */
export function slugsInGroup(
  current: Iterable<string>,
  slugs: Iterable<string>,
): string[] {
  const present = new Set(current);
  return unique(slugs).filter((slug) => present.has(slug));
}

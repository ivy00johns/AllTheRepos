/**
 * Groups, end to end: make one, put a repo in it, rename it, delete it — the
 * bulk path, where a selection made with the new checkboxes is added from the
 * toolbar instead of one repo at a time — and a saved filter, which is the same
 * entity filled by a rule rather than by hand.
 *
 * Why this spec exists rather than another unit test: every piece of group
 * support already existed and was individually tested — the IPC handlers, the
 * schemas, the member filter, the hooks — and the app still could not do any of
 * it. Create, rename and delete lived in a component that was never mounted,
 * and `groups:setMembers` was called by nobody, so a group could be read and
 * never written. That is a wiring failure, and the only place wiring is
 * observable is a real window talking to the real main process. The same was
 * true of smart groups: `isSmart` and `smartFilter` have been part of
 * `groups:create` since Phase 1, the catalog has evaluated them for as long as
 * it has drawn groups, and nothing ever sent one.
 *
 * The assertions are deliberately about state a person can see — a row in the
 * rail, a badge in the detail panel, the catalog narrowed to the group — not
 * about the bridge having been called.
 */

import { expect, test } from "@playwright/test";

import { launchApp } from "./_launch-app";

/** One of the three repos the shared template profile is seeded with. */
const REPO = "Demo Web";

test("a group is created from the rail, filled from a repo, renamed, and deleted", async () => {
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });

    // ----- A group can be made at all -----
    //
    // The row is present before any group exists. A section that only appears
    // once it holds something is a section nothing can be put into, which is
    // exactly the state this feature shipped in.
    const newGroup = sidebar.getByRole("button", { name: "New group" });
    await expect(newGroup).toBeVisible();

    await newGroup.click();
    const createDialog = win.getByRole("dialog", { name: "New group" });
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel("Name").fill("E2E group");
    await createDialog.getByRole("button", { name: "Create" }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    // The rail owns the new group immediately, at zero.
    const groupRow = sidebar.getByRole("button", { name: /^E2E group/ });
    await expect(groupRow).toBeVisible({ timeout: 10_000 });

    // ----- A repo can be put in it -----
    //
    // Through the detail panel, because that path needs no modifier key: the
    // toolbar's version acts on a ⌘-click selection, and a feature whose only
    // door is an undocumented gesture is still effectively unavailable.
    await win.getByRole("button", { name: new RegExp(`^${REPO},`) }).click();

    const membership = win.getByRole("button", { name: "Add to group" });
    await expect(membership).toBeVisible({ timeout: 15_000 });
    await expect(win.getByText("Not in a group yet.")).toBeVisible();

    const badge = win.getByRole("button", {
      name: `Remove ${REPO} from E2E group`,
    });

    const addToGroup = async () => {
      await membership.click();
      await win.getByRole("menuitem", { name: /^E2E group/ }).click();
    };

    await addToGroup();

    // The badge is the write landing: it only renders a membership the panel
    // was told about after the mutation resolved.
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // And the rail counts it, which is the groups list refetching from SQLite.
    await expect(
      sidebar.getByRole("button", { name: /^E2E group\s*1$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // ----- And taken out again -----
    //
    // The badge's own ×, not the toolbar's "Remove": this is the control that
    // has to work on a repo that is already in the group, and removal is the
    // half of `setMembers` a union-only implementation would silently get
    // wrong (it would write the member back rather than out).
    await badge.click();
    await expect(win.getByText("Not in a group yet.")).toBeVisible({
      timeout: 15_000,
    });
    // A zero count renders no badge at all (`CountBadge` returns null), so the
    // empty group's row is named exactly "E2E group" — the absence of the
    // number is the assertion.
    await expect(
      sidebar.getByRole("button", { name: /^E2E group$/ }),
    ).toBeVisible({ timeout: 15_000 });

    await addToGroup();
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(
      sidebar.getByRole("button", { name: /^E2E group\s*1$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // ----- Opening the group narrows the catalog to its members -----
    await sidebar.getByRole("button", { name: /^E2E group\s*1$/ }).click();

    const banner = win.getByRole("status", { name: "Active group" });
    await expect(banner).toContainText("Group: E2E group");
    await expect(banner).toContainText("1 repos");
    await expect(win.locator("[data-repo-slug]")).toHaveCount(1, {
      timeout: 15_000,
    });

    // A manually filled group has no rule to describe and no conditions to
    // edit, so neither the explanation nor the shortcut may appear for it —
    // an editor opened here would have nothing to edit.
    await expect(win.locator("[data-saved-filter-rule]")).toHaveCount(0);
    await expect(
      banner.getByRole("button", { name: "Edit filter…" }),
    ).toHaveCount(0);

    // ----- Rename -----
    const row = sidebar.getByRole("button", { name: /^E2E group/ });
    await row.hover();
    await sidebar
      .getByRole("button", { name: "Actions for group E2E group" })
      .click();
    await win.getByRole("menuitem", { name: "Rename…" }).click();

    const renameDialog = win.getByRole("dialog", { name: "Rename group" });
    await expect(renameDialog).toBeVisible();
    await renameDialog.getByLabel("Name").fill("E2E renamed");
    await renameDialog.getByRole("button", { name: "Save" }).click();
    await expect(renameDialog).toBeHidden({ timeout: 10_000 });

    await expect(
      sidebar.getByRole("button", { name: /^E2E renamed/ }),
    ).toBeVisible({ timeout: 10_000 });

    // The banner follows the rename, so the scope on screen is named correctly
    // after somebody changed it from under it.
    await expect(banner).toContainText("Group: E2E renamed", {
      timeout: 10_000,
    });

    // ----- Delete -----
    await sidebar.getByRole("button", { name: /^E2E renamed/ }).hover();
    await sidebar
      .getByRole("button", { name: "Actions for group E2E renamed" })
      .click();
    await win.getByRole("menuitem", { name: "Delete…" }).click();

    const deleteDialog = win.getByRole("dialog", { name: "Delete group" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await expect(deleteDialog).toBeHidden({ timeout: 10_000 });

    // Gone from the rail, gone as a scope, and the whole catalog is back —
    // deleting a group must not leave the catalog filtered to a group that no
    // longer exists.
    await expect(
      sidebar.getByRole("button", { name: /^E2E renamed/ }),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(banner).toHaveCount(0);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

/**
 * The other door into a group: tick rows, add them from the toolbar.
 *
 * This is the path the checkboxes exist for. Until they were added the only way
 * to build a selection was ⌘-click, so `Add to group` could be on screen and
 * still effectively unreachable — and an action nobody can reach is worth about
 * as much as one that was never written. The test drives the affordances a
 * first-time user would find: the box on each card, the toolbar's count, and the
 * toolbar's menu.
 */
test("checkboxes build a selection, and the toolbar puts it in a group", async () => {
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 15_000,
    });

    // A group to put them in.
    await sidebar.getByRole("button", { name: "New group" }).click();
    const createDialog = win.getByRole("dialog", { name: "New group" });
    await createDialog.getByLabel("Name").fill("Bulk group");
    await createDialog.getByRole("button", { name: "Create" }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    // ----- Select all visible, in one click -----
    await win.getByRole("button", { name: "Select all 3 repos shown" }).click();
    await expect(win.getByText("3 selected")).toBeVisible({ timeout: 10_000 });
    await expect(win.getByRole("checkbox", { checked: true })).toHaveCount(3);

    // And back out, so the next step is a partial selection.
    await win.getByRole("button", { name: "Clear selection" }).click();
    await expect(win.getByText("3 repos")).toBeVisible({ timeout: 10_000 });

    // ----- Two of them, by their own checkboxes -----
    await win.getByRole("checkbox", { name: "Select Demo Web" }).click();
    await win.getByRole("checkbox", { name: "Select Demo CLI" }).click();
    await expect(win.getByText("2 selected")).toBeVisible({ timeout: 10_000 });

    // Clicking a box must not also open the repo — the card's own click handler
    // is one bubble away, and this asserts it stayed out of the way.
    await expect(
      win.getByRole("complementary", { name: /repo detail/i }),
    ).toBeHidden();

    // ----- The toolbar's Add to group -----
    await win.getByRole("button", { name: "Add to group" }).click();
    await win.getByRole("menuitem", { name: /^Bulk group/ }).click();

    await expect(
      win.getByText("Added 2 repos to Bulk group"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      sidebar.getByRole("button", { name: /^Bulk group\s*2$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // ----- And the group holds exactly those two -----
    await sidebar.getByRole("button", { name: /^Bulk group\s*2$/ }).click();
    await expect(win.locator("[data-repo-slug]")).toHaveCount(2, {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

/**
 * The other kind of group: a saved filter, where membership is a rule.
 *
 * The tag this filters on is made through the UI here rather than seeded,
 * because the assertion has to be that the filter SELECTS something. A filter
 * whose conditions are ignored still matches everything, and a test written
 * against the seeded catalog (three repos with no language, no tags and no
 * commits) could not tell those two apart.
 */
test("a saved filter is created from the rail, fills itself, and is managed like a group", async () => {
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 15_000,
    });

    // ----- A tag for the filter to find -----
    await win.getByRole("button", { name: /^Demo Web,/ }).click();
    await win.getByLabel("New tag").fill("focus");
    await win.getByRole("button", { name: "Add tag" }).click();
    await expect(
      win.getByRole("button", { name: "Remove tag focus" }),
    ).toBeVisible({ timeout: 15_000 });

    // ----- The dialog, from the rail -----
    await sidebar.getByRole("button", { name: "New saved filter" }).click();
    const dialog = win.getByRole("dialog", { name: "New saved filter" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Name").fill("Tagged focus");
    // A filter with no conditions matches every repo, so saving is refused
    // until there is something to filter on.
    await expect(
      dialog.getByRole("button", { name: "Save filter" }),
    ).toBeDisabled();

    await dialog.getByLabel("Tagged with").fill("focus");

    // The count is the filter evaluated before it is saved. It reaches 1 only
    // after the tag write has landed and the catalog refetched, so this also
    // proves the tag persisted rather than sitting in the panel's local state.
    await expect(dialog.getByText("1 repo matches")).toBeVisible({
      timeout: 15_000,
    });

    await dialog.getByRole("button", { name: "Save filter" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ----- It fills itself, and opens so the rule can be seen working -----
    //
    // The badge is computed from what the filter matches, not from membership
    // rows: a smart group has none, and reading `repoCount` would put a 0 here.
    await expect(
      sidebar.getByRole("button", { name: /^Tagged focus\s*1$/ }),
    ).toBeVisible({ timeout: 15_000 });

    const banner = win.getByRole("status", { name: "Active group" });
    await expect(banner).toContainText("Group: Tagged focus", {
      timeout: 15_000,
    });
    await expect(banner).toContainText("1 repos");
    await expect(win.locator("[data-repo-slug]")).toHaveCount(1, {
      timeout: 15_000,
    });

    // The rule is spelled out above the grid it narrows: the rail's name and
    // count say nothing about WHY these repos are the ones on screen.
    const rule = win.locator("[data-saved-filter-rule]");
    await expect(rule).toHaveText("tagged focus");

    // ----- Edit: a filter is a rule, and rules get typos -----
    //
    // The row menu's editor has to open on what was SAVED, not on the form's
    // defaults — a tag that appears blank in the editor gets typed a second time
    // and saved as a duplicate condition.
    await sidebar
      .getByRole("button", { name: /^Tagged focus\s*1$/ })
      .hover();
    await sidebar
      .getByRole("button", { name: "Actions for group Tagged focus" })
      .click();
    await win.getByRole("menuitem", { name: "Edit filter…" }).click();

    const editDialog = win.getByRole("dialog", { name: "Edit saved filter" });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByLabel("Tagged with")).toHaveValue("focus");

    // A rule that matches nothing, which is only visible as a real change if
    // the grid and the row count follow the saved rule rather than the one the
    // group was born with.
    await editDialog.getByLabel("Tagged with").fill("focus, missing");
    await expect(editDialog.getByText(/No repos match yet/)).toBeVisible();
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toBeHidden({ timeout: 10_000 });

    await expect(
      sidebar.getByRole("button", { name: /^Tagged focus$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText("0 repos", { timeout: 15_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(0, {
      timeout: 15_000,
    });

    // The banner's explanation follows the saved rule, so an empty grid is
    // explained rather than mysterious.
    await expect(rule).toHaveText("tagged focus, missing");

    // ----- And back through the banner's own shortcut -----
    //
    // The reason you are reading this line is usually that it says something
    // you did not mean, so the editor opens from here too — not only from a
    // row menu on the other side of the window.
    await banner.getByRole("button", { name: "Edit filter…" }).click();

    const editAgain = win.getByRole("dialog", { name: "Edit saved filter" });
    await expect(editAgain.getByLabel("Tagged with")).toHaveValue(
      "focus, missing",
    );
    await editAgain.getByLabel("Tagged with").fill("focus");
    await expect(editAgain.getByText("1 repo matches")).toBeVisible({
      timeout: 15_000,
    });
    await editAgain.getByRole("button", { name: "Save changes" }).click();
    await expect(editAgain).toBeHidden({ timeout: 10_000 });

    await expect(
      sidebar.getByRole("button", { name: /^Tagged focus\s*1$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText("1 repos", { timeout: 15_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(rule).toHaveText("tagged focus");

    // ----- Rename: the row menu is there for saved filters too -----
    await sidebar
      .getByRole("button", { name: /^Tagged focus\s*1$/ })
      .hover();
    await sidebar
      .getByRole("button", { name: "Actions for group Tagged focus" })
      .click();
    await win.getByRole("menuitem", { name: "Rename…" }).click();

    const renameDialog = win.getByRole("dialog", { name: "Rename group" });
    await expect(renameDialog).toBeVisible();
    await renameDialog.getByLabel("Name").fill("Tagged focus renamed");
    await renameDialog.getByRole("button", { name: "Save" }).click();
    await expect(renameDialog).toBeHidden({ timeout: 10_000 });

    await expect(banner).toContainText("Group: Tagged focus renamed", {
      timeout: 10_000,
    });

    // ----- Delete: the view goes, the repos stay -----
    await sidebar
      .getByRole("button", { name: /^Tagged focus renamed\s*1$/ })
      .hover();
    await sidebar
      .getByRole("button", { name: "Actions for group Tagged focus renamed" })
      .click();
    await win.getByRole("menuitem", { name: "Delete…" }).click();

    const deleteDialog = win.getByRole("dialog", { name: "Delete group" });
    await expect(deleteDialog).toContainText("saved filter");
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await expect(deleteDialog).toBeHidden({ timeout: 10_000 });

    await expect(
      sidebar.getByRole("button", { name: /^Tagged focus renamed/ }),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(banner).toHaveCount(0);
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

/**
 * The other way to describe a rule: keep the view instead of typing it out.
 *
 * The rail's dialog asks somebody to translate what they are looking at into
 * conditions. The toolbar's version starts from those conditions, which is only
 * worth anything if two things hold: the boxes that ARE on screen arrive ticked,
 * and the ones a saved filter cannot hold (folder scope, owner, search) are said
 * out loud rather than dropped. The second is the one that would go unnoticed —
 * a group that quietly matches the whole catalog where one repo was on screen
 * reads as a filter that does not work.
 */
test("a saved filter can be made from the filters already on screen", async () => {
  const { app, close } = await launchApp();

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    const sidebar = win.locator("#catalog-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(win.locator("[data-repo-slug]")).toHaveCount(3, {
      timeout: 15_000,
    });

    const saveAsFilter = win.getByRole("button", {
      name: "Save these filters as a saved filter",
    });

    // ----- An unnarrowed view has nothing to save -----
    //
    // Not an error state to hide: the dialog opens and refuses, which is the same
    // answer the rail's creator gives to an empty form.
    await saveAsFilter.click();
    const empty = win.getByRole("dialog", { name: "New saved filter" });
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("button", { name: "Save filter" })).toBeDisabled();
    await expect(empty.locator("[data-filter-not-carried]")).toHaveCount(0);
    await empty.getByRole("button", { name: "Cancel" }).click();
    await expect(empty).toBeHidden({ timeout: 10_000 });

    // ----- Narrow the view through the rail -----
    // Pinned reads as a box in the dialog; the owner filter has no equivalent.
    await win.getByRole("button", { name: "Pin Demo Web" }).click();
    await expect(
      win.getByRole("button", { name: "Unpin Demo Web" }),
    ).toBeVisible({ timeout: 15_000 });

    await sidebar.getByRole("button", { name: /^Favourites/ }).click();
    await sidebar.getByRole("button", { name: /^Local only/ }).click();
    await expect(win.locator("[data-repo-slug]")).toHaveCount(1, {
      timeout: 15_000,
    });

    // ----- The dialog arrives holding what the view holds -----
    await saveAsFilter.click();
    const dialog = win.getByRole("dialog", { name: "New saved filter" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Only pinned repos")).toBeChecked();
    await expect(
      dialog.getByLabel("Only repos with uncommitted changes"),
    ).not.toBeChecked();
    await expect(dialog.getByLabel("Include archived folders")).not.toBeChecked();

    // The owner filter is named as not carried over; the count is what the
    // filter really matches, which is why it is not simply the grid's number.
    await expect(dialog.locator("[data-filter-not-carried]")).toContainText(
      "owner local",
    );
    await expect(dialog.getByText("1 repo matches")).toBeVisible({
      timeout: 15_000,
    });

    await dialog.getByLabel("Name").fill("Pinned work");
    await dialog.getByRole("button", { name: "Save filter" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ----- Saved, opened, and showing the rule rather than the view -----
    //
    // The owner filter is gone from the grid because the group does not carry
    // it; the pin remains because the group does.
    await expect(
      sidebar.getByRole("button", { name: /^Pinned work\s*1$/ }),
    ).toBeVisible({ timeout: 15_000 });
    const banner = win.getByRole("status", { name: "Active group" });
    await expect(banner).toContainText("Group: Pinned work", {
      timeout: 15_000,
    });
    await expect(win.locator("[data-saved-filter-rule]")).toHaveText(
      "pinned repos",
    );
    await expect(win.locator("[data-repo-slug]")).toHaveCount(1, {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

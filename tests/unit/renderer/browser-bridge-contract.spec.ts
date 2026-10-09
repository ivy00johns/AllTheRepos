/**
 * Contract test for the browser bridge: every method it exposes, checked
 * against the schema the main process validates that answer with.
 *
 * The bridge is hand-written to mimic the preload bridge, and twice a return
 * value has drifted from the shape its caller reads — `system.ping` answered a
 * bare `{ ok: true }` where `/debug` prints three fields, and `git.fetch`
 * answered `{ results: [] }` where the catalog's summary walks `result.entries`,
 * which threw on every Fetch click. Both were invisible to the type checker
 * because the bridge casts its own answers (`as never`) and to the IPC layer
 * because these answers never pass through it. Nothing bridged the two ends.
 *
 * So the table below pairs each method with `@shared/schemas` — the same
 * schemas `src/main/ipc/*.ts` parses every real handler's result with. That is
 * the point: this file does not describe the contract, it borrows the one
 * already written, so the stub and the real handler cannot disagree.
 *
 * Two tests keep it honest as the surface grows:
 *
 *   - every method on the installed bridge has an entry, so adding a method
 *     without a schema fails rather than shipping unchecked;
 *   - every entry names a method that still exists, so a removed method cannot
 *     leave a green test behind for a call nobody makes.
 *
 * Inputs are deliberately unremarkable. The subject of this file is what a
 * method RESOLVES; an input is only the trigger that reaches it, so these are
 * the smallest values the demo store will accept, chosen so that the entries
 * which mutate the browser's own copy run last.
 */

import type { ZodTypeAny } from "zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schemas from "@shared/schemas";

import type { AtrBridge } from "@renderer/lib/atr";

const globals = globalThis as { window?: { atr?: unknown } };

/** Values the entries below share, read off the catalog rather than guessed. */
interface Fixtures {
  /** A repo the catalog holds. Nothing destructive is pointed at it. */
  slug: string;
  /** A different repo, for the two-ended calls (links) and the destructive one. */
  otherSlug: string;
  /** The folder `slug` lives in. */
  folder: string;
  /** A path that is deliberately not a scan root, so a move cannot happen. */
  outside: string;
}

type Check =
  | { kind: "returns"; schema: ZodTypeAny; call: (bridge: AtrBridge, f: Fixtures) => unknown }
  | { kind: "refuses"; call: (bridge: AtrBridge, f: Fixtures) => unknown }
  | { kind: "subscribes"; call: (bridge: AtrBridge, f: Fixtures) => unknown }
  | { kind: "void"; call: (bridge: AtrBridge, f: Fixtures) => unknown };

const returns = (
  schema: ZodTypeAny,
  call: (bridge: AtrBridge, f: Fixtures) => unknown,
): Check => ({ kind: "returns", schema, call });

/**
 * Every method on the bridge, keyed by the path a caller reaches it by.
 *
 * Order matters only where an entry mutates the browser's copy of the catalog:
 * `catalog.delete` and the folder operations run last, and none of them touch
 * the repo the other entries point at.
 */
const TABLE: Record<string, Check> = {
  // --- system ---------------------------------------------------------------
  "system.ping": returns(schemas.PingResponseSchema, (b) => b.system.ping({ nonce: "contract" })),

  // --- catalog (reads) ------------------------------------------------------
  "catalog.list": returns(schemas.ListReposResultSchema, (b) => b.catalog.list({ limit: 5 })),
  "catalog.get": returns(schemas.GetRepoResultSchema, (b, f) => b.catalog.get({ slug: f.slug })),
  "catalog.search": returns(schemas.SearchReposResultSchema, (b) => b.catalog.search({ q: "a" })),
  "catalog.smartFilter": returns(schemas.SmartFilterResultSchema, (b) => b.catalog.smartFilter({ prompt: "recent" })),
  "catalog.cover": returns(schemas.CoverResultSchema, (b, f) => b.catalog.cover({ slug: f.slug })),
  "catalog.moveLast": returns(schemas.MoveLastResultSchema, (b) => b.catalog.moveLast({})),
  "catalog.moveCheck": returns(schemas.MoveCheckResultSchema, (b, f) =>
    b.catalog.moveCheck({ slugs: [f.slug], targetDir: f.outside })),
  "catalog.folderCheck": returns(schemas.FolderCheckResultSchema, (b, f) =>
    b.catalog.folderCheck({ fromPath: f.folder, toPath: `${f.folder}-checked` })),

  // --- scan -----------------------------------------------------------------
  // `StartScanResult` has no field that can say "not started", so a tab refuses.
  "scan.start": { kind: "refuses", call: (b) => b.scan.start({ paths: [] }) },
  "scan.status": returns(schemas.ScanStatusResultSchema, (b) => b.scan.status({ jobId: "contract" })),
  "scan.cancel": returns(schemas.CancelScanResultSchema, (b) => b.scan.cancel({ jobId: "contract" })),
  "scan.onProgress": { kind: "subscribes", call: (b) => b.scan.onProgress(() => {}) },

  // --- git ------------------------------------------------------------------
  "git.fetch": returns(schemas.SyncResultSchema, (b, f) => b.git.fetch({ slugs: [f.slug] })),
  "git.pull": returns(schemas.SyncResultSchema, (b, f) => b.git.pull({ slugs: [f.slug] })),
  "git.status": returns(schemas.GitStatusSchema, (b, f) => b.git.status({ slug: f.slug })),
  "git.branches": returns(schemas.GitBranchesResultSchema, (b, f) => b.git.branches({ slug: f.slug })),
  "git.openInEditor": returns(schemas.OpenInEditorResultSchema, (b, f) => b.git.openInEditor({ slug: f.slug })),

  // --- tasks ----------------------------------------------------------------
  "tasks.list": returns(schemas.TaskListResultSchema, (b, f) => b.tasks.list({ slug: f.slug })),
  "tasks.start": returns(schemas.TaskStartResultSchema, (b, f) => b.tasks.start({ slug: f.slug, taskId: "dev" })),
  "tasks.stop": returns(schemas.TaskStopResultSchema, (b) => b.tasks.stop({ runId: "no-such-run" })),
  "tasks.active": returns(schemas.TaskActiveResultSchema, (b) => b.tasks.active({})),
  "tasks.onOutput": { kind: "subscribes", call: (b) => b.tasks.onOutput(() => {}) },

  // --- graph ----------------------------------------------------------------
  "graph.build": returns(schemas.GraphResultSchema, (b) => b.graph.build({})),
  "graph.links": returns(schemas.RepoRelationsResultSchema, (b, f) => b.graph.links({ slug: f.slug })),
  "graph.link": returns(schemas.AssertRepoLinkResultSchema, (b, f) =>
    b.graph.link({ fromSlug: f.slug, toSlug: f.otherSlug, kind: "part-of", why: "contract test" })),
  "graph.unlink": returns(schemas.RemoveRepoLinkResultSchema, (b, f) =>
    b.graph.unlink({ fromSlug: f.slug, toSlug: f.otherSlug, kind: "part-of" })),

  // --- update ---------------------------------------------------------------
  "update.check": returns(schemas.UpdateStatusSchema, (b) => b.update.check({})),
  "update.status": returns(schemas.UpdateStatusSchema, (b) => b.update.status({})),
  "update.openRelease": returns(schemas.OpenReleaseResultSchema, (b) => b.update.openRelease({})),
  "update.install": returns(schemas.InstallUpdateResultSchema, (b) => b.update.install({})),
  "update.onStatus": { kind: "subscribes", call: (b) => b.update.onStatus(() => {}) },

  // --- settings -------------------------------------------------------------
  "settings.get": returns(schemas.GetSettingsResultSchema, (b) => b.settings.get()),
  "settings.update": returns(schemas.UpdateSettingsResultSchema, (b) => b.settings.update({})),
  "settings.pickScanPath": returns(schemas.PickScanPathResultSchema, (b) => b.settings.pickScanPath({})),
  "settings.countUnder": returns(schemas.CountUnderResultSchema, (b, f) => b.settings.countUnder({ path: f.folder })),
  "settings.addScanPath": returns(schemas.AddScanPathResultSchema, (b, f) => b.settings.addScanPath({ path: f.outside })),
  "settings.removeScanPath": returns(schemas.RemoveScanPathResultSchema, (b, f) =>
    b.settings.removeScanPath({ path: f.outside, forgetRepos: false })),

  // --- groups ---------------------------------------------------------------
  "groups.list": returns(schemas.ListGroupsResultSchema, (b) => b.groups.list()),
  // Membership in the demo library is derived from where a repo lives, so the
  // three group writes cannot change anything a reviewer would then see. They
  // refuse, in the same voice as the bridge's other refusals, and `delete`
  // answers with a result because "there is nothing to delete" is an answer.
  "groups.create": { kind: "refuses", call: (b) => b.groups.create({ name: "contract" }) },
  "groups.rename": { kind: "refuses", call: (b) => b.groups.rename({ id: 1, name: "contract" }) },
  "groups.setMembers": { kind: "refuses", call: (b) => b.groups.setMembers({ groupId: 1, slugs: [] }) },
  // `deleted` is `z.literal(true)` — there is no shape for "nothing deleted".
  "groups.delete": { kind: "refuses", call: (b) => b.groups.delete({ id: 999_999 }) },

  // --- app / native shell ---------------------------------------------------
  "app.setDockBadge": returns(schemas.SetDockBadgeResultSchema, (b) => b.app.setDockBadge({ count: 0 })),
  "app.notify": returns(schemas.NotifyResultSchema, (b) => b.app.notify({ title: "t", body: "b" })),
  // `visible` is `z.literal(true)`, and a tab has no spotlight window.
  "app.showSpotlight": { kind: "refuses", call: (b) => b.app.showSpotlight() },
  "app.hideSpotlight": returns(schemas.HideSpotlightResultSchema, (b) => b.app.hideSpotlight()),
  "app.registerActions": returns(schemas.RegisterActionsResultSchema, (b) => b.app.registerActions({ actions: [] })),
  // Not in the frozen contract — an optional dev-only helper the action calls
  // if it is present. It answers nothing, which is the whole contract for it.
  "app.toggleDevtools": { kind: "void", call: (b) => b.app.toggleDevtools?.() },
  "app.onMenuCommand": { kind: "subscribes", call: (b) => b.app.onMenuCommand?.(() => {}) },
  "app.onDeepLink": { kind: "subscribes", call: (b) => b.app.onDeepLink?.(() => {}) },
  "app.onOpenRepo": { kind: "subscribes", call: (b) => b.app.onOpenRepo?.(() => {}) },

  // --- push streams ---------------------------------------------------------
  "menu.onCommand": { kind: "subscribes", call: (b) => b.menu.onCommand(() => {}) },
  "protocol.onDeepLink": { kind: "subscribes", call: (b) => b.protocol.onDeepLink(() => {}) },
  "tray.onOpenRepo": { kind: "subscribes", call: (b) => b.tray.onOpenRepo(() => {}) },

  // --- processes ------------------------------------------------------------
  "process.list": returns(schemas.ListProcessesResultSchema, (b) => b.process.list()),
  "process.listForRepo": returns(schemas.ListProcessesForRepoResultSchema, (b, f) =>
    b.process.listForRepo({ slug: f.slug })),
  "process.refresh": returns(schemas.ListProcessesResultSchema, (b) => b.process.refresh()),
  "process.kill": returns(schemas.KillProcessResultSchema, (b) => b.process.kill({ pid: 999_999 })),
  "process.onUpdate": { kind: "subscribes", call: (b) => b.process.onUpdate(() => {}) },

  // --- launcher -------------------------------------------------------------
  "launcher.detect": returns(schemas.DetectLauncherResultSchema, (b) => b.launcher.detect()),
  // Every launcher call is a refusal here — opening an editor needs a main
  // process — but a refusal is a `LauncherResult`, and that shape is the point.
  "launcher.openInEditor": returns(schemas.LauncherResultSchema, (b, f) => b.launcher.openInEditor({ slug: f.slug })),
  "launcher.openInTerminal": returns(schemas.LauncherResultSchema, (b, f) => b.launcher.openInTerminal({ slug: f.slug })),
  "launcher.openInFinder": returns(schemas.LauncherResultSchema, (b, f) => b.launcher.openInFinder({ slug: f.slug })),
  "launcher.openRemote": returns(schemas.LauncherResultSchema, (b, f) => b.launcher.openRemote({ slug: f.slug })),
  "launcher.copyPath": returns(schemas.LauncherResultSchema, (b, f) => b.launcher.copyPath({ slug: f.slug })),

  // --- claude ---------------------------------------------------------------
  "claude.index": returns(schemas.ClaudeIndexResultSchema, (b) => b.claude.index()),
  "claude.projects": returns(schemas.ClaudeProjectsResultSchema, (b) => b.claude.projects()),
  "claude.repoState": returns(schemas.ClaudeRepoStateResultSchema, (b, f) => b.claude.repoState({ slug: f.slug })),
  "claude.sessionTranscript": returns(schemas.ClaudeSessionTranscriptResultSchema, (b) =>
    b.claude.sessionTranscript({ sessionId: "contract", cursor: 0 })),
  "claude.globalUsage": returns(schemas.ClaudeGlobalUsageResultSchema, (b) => b.claude.globalUsage({})),
  "claude.launch": returns(schemas.ClaudeLaunchResultSchema, (b, f) => b.claude.launch({ slug: f.slug })),
  "claude.openClaudeMd": returns(schemas.ClaudeOpenClaudeMdResultSchema, (b, f) =>
    b.claude.openClaudeMd({ slug: f.slug })),
  "claude.onUpdate": { kind: "subscribes", call: (b) => b.claude.onUpdate(() => {}) },

  // --- catalog (writes) — last, they change the browser's copy --------------
  "catalog.setFavorite": returns(schemas.SetFavoriteResultSchema, (b, f) =>
    b.catalog.setFavorite({ slug: f.slug, favorite: true })),
  "catalog.setTags": returns(schemas.SetRepoTagsResultSchema, (b, f) =>
    b.catalog.setTags({ slug: f.slug, tags: ["contract"] })),
  "catalog.rescan": returns(schemas.RescanRepoResultSchema, (b, f) => b.catalog.rescan({ slug: f.slug })),
  "catalog.move": returns(schemas.MoveResultSchema, (b, f) => b.catalog.move({ slugs: [f.slug], targetDir: f.outside })),
  "catalog.moveUndo": returns(schemas.MoveResultSchema, (b) => b.catalog.moveUndo({})),
  "catalog.folderRename": returns(schemas.FolderOpResultSchema, (b, f) =>
    b.catalog.folderRename({ fromPath: `${f.folder}-absent`, newName: "contract" })),
  "catalog.folderMove": returns(schemas.FolderOpResultSchema, (b, f) =>
    b.catalog.folderMove({ fromPath: `${f.folder}-absent`, parentPath: f.folder })),
  "catalog.folderCreate": returns(schemas.FolderOpResultSchema, (b, f) =>
    b.catalog.folderCreate({ parentPath: f.folder, name: "contract-folder" })),
  "catalog.onChanged": { kind: "subscribes", call: (b) => b.catalog.onChanged(() => {}) },
  // Pointed at the last repo in the catalog rather than the fixture, so the
  // entries above never race the one row this removes.
  "catalog.delete": returns(schemas.DeleteRepoResultSchema, (b, f) => b.catalog.delete({ slug: f.otherSlug })),
};

let bridge: AtrBridge;
let fixtures: Fixtures;

beforeAll(async () => {
  // The bridge narrates which library it is serving on `info`, and the store
  // warns that the export could not be read on `warn`. Both are expected here —
  // no export is this file's fixture — so neither belongs in the suite output.
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  globals.window = {};
  // Pin the fixture twice over, because this suite runs every file in one
  // process (`poolOptions.forks.singleFork`) and module singletons plus globals
  // are shared with whatever ran first:
  //
  //   - no export, so the bridge is answering from the demo library rather than
  //     from a catalog another file's stubbed `fetch` left behind;
  //   - a fresh registry, the same device `demo-store.spec.ts` uses to build a
  //     fresh store per case.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("contract test: no export")));
  vi.resetModules();
  const { installBrowserBridge } = await import("@renderer/lib/browser-bridge");
  installBrowserBridge();
  bridge = globals.window?.atr as AtrBridge;

  const catalog = await bridge.catalog.list({ limit: 200 });
  const [first, second] = catalog.items;
  if (!first || !second) throw new Error("The demo catalog needs at least two repos");
  fixtures = {
    slug: first.slug,
    otherSlug: second.slug,
    folder: first.fullPath.slice(0, first.fullPath.lastIndexOf("/")),
    outside: "/contract-test/not-a-scan-root",
  };
});

// In `afterAll`, not `afterEach`: the stubs above have to hold for every case in
// this file, and they must not outlive it — a leaked `fetch` stub would break
// whichever file runs next.
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the browser bridge answers to the contract its callers read", () => {
  it.each(Object.entries(TABLE))("%s", async (path, check) => {
    const call = check.call as (b: AtrBridge, f: Fixtures) => unknown;

    if (check.kind === "subscribes" || check.kind === "void") {
      // A subscription owes a caller an unsubscribe lambda; a void helper owes
      // it nothing. Neither may throw on the way.
      const answer = call(bridge, fixtures);
      if (check.kind === "subscribes") expect(typeof answer).toBe("function");
      return;
    }

    if (check.kind === "refuses") {
      await expect(Promise.resolve(call(bridge, fixtures))).rejects.toThrow(/browser bridge/i);
      return;
    }

    const result = await call(bridge, fixtures);
    const parsed = check.schema.safeParse(result);
    // On a mismatch the zod issue path is the useful part of the failure: it
    // names the exact field that drifted, which is what was missing both times
    // this went wrong in the wild.
    expect(parsed.success ? [] : parsed.error.issues, `${path} did not match its schema`).toEqual([]);
  });

  it("covers every method the bridge exposes", () => {
    const exposed: string[] = [];
    for (const [namespace, members] of Object.entries(bridge as unknown as Record<string, unknown>)) {
      if (typeof members !== "object" || members === null) continue;
      for (const [method, value] of Object.entries(members as Record<string, unknown>)) {
        if (typeof value === "function") exposed.push(`${namespace}.${method}`);
      }
    }

    // A method with no entry has no contract check, which is how both of the
    // drifts this file exists for got shipped.
    expect(exposed.filter((path) => !(path in TABLE))).toEqual([]);
    // And an entry for a method that no longer exists would keep passing while
    // checking nothing.
    expect(Object.keys(TABLE).filter((path) => !exposed.includes(path))).toEqual([]);
  });
});

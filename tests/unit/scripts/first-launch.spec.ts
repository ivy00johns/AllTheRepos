/**
 * Unit test for `scripts/first-launch.mjs` — the one place the first-launch
 * instructions are written down.
 *
 * The failure this guards is not a crash. It is four surfaces that used to agree
 * because a person kept them in step, and did not: the file inside the DMG, the
 * release-note paragraph, the CI warning and the in-app notice all told people to
 * right-click the app and choose **Open**, an override Apple had removed in macOS
 * 15. Nothing failed, because nothing was comparing them — the copy that was
 * missed is the one a person reads while stuck at a launch macOS refused.
 *
 * So the assertions here are about **agreement**, not wording. That each file on
 * disk is byte-for-byte what the source renders, is what makes the other
 * statements true by construction rather than by review. And that every surface
 * names the procedure Apple documents — and names the removed shortcut only as
 * something that does not work — is the part a reader actually depends on.
 *
 * The one thing this file is not allowed to do is restate the instructions. A test
 * with its own copy of the sentence would be the fourth surface, and it would be
 * the one nobody updates.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations), and its CLI is
 * exercised by running it, because `--print read-me` being redirect-safe is a
 * property of the program rather than of a function.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "first-launch.mjs");

interface CheckResult {
  ok: boolean;
  target: string;
  reason: string;
  expected?: string;
  actual?: string;
}

interface RenderedFile {
  ok: boolean;
  file: string;
  target: string;
  reason: string;
  expected?: string;
  actual?: string;
}

interface FirstLaunchModule {
  READ_ME_FIRST: string;
  NOTICE_MODULE: string;
  APP_NAME: string;
  INSTALL_PATH: string;
  SETTINGS_PATH: readonly string[];
  SHORTCUT_REMOVED_IN: string;
  QUARANTINE_COMMAND: string;
  REFUSAL_QUOTE: string;
  CANNOT_INSTALL_UPDATES: string;
  ARROW: Readonly<{ plain: string; rich: string }>;
  PRINTS: Record<string, () => string>;
  removedShortcut(arrow?: string): string;
  settingsPath(arrow?: string): string;
  releaseNoteParagraph(): string;
  workflowWarning(): string;
  renderReadMeFirst(): string;
  noticeTitle(): string;
  noticeBody(): string;
  noticeText(): string;
  renderNoticeModule(): string;
  RENDERED_FILES: ReadonlyArray<{ file: string; render: () => string }>;
  checkReadMeFirst(options?: { root?: string }): CheckResult;
  checkRenderedFiles(options?: { root?: string }): RenderedFile[];
  firstDifference(
    expected: string,
    actual: string,
  ): { line: number; expected: string; actual: string } | null;
}

let firstLaunch: FirstLaunchModule;

beforeAll(async () => {
  firstLaunch = (await import(
    pathToFileURL(SCRIPT).href
  )) as unknown as FirstLaunchModule;
});

/** The prose, flattened — several of these wrap, and the path spans lines. */
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The canonical procedure, as a reader sees it in rendered Markdown. */
const OPEN_ANYWAY = "System Settings → Privacy & Security → Open Anyway";

function runCli(args: string[], options: { cwd?: string; script?: string } = {}) {
  const result = spawnSync(process.execPath, [options.script ?? SCRIPT, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function withTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atr-first-launch-"));
}

describe("the DMG's file is rendered, not maintained by hand", () => {
  test("resources/READ-ME-FIRST.txt is byte-for-byte what the source renders", () => {
    const result = firstLaunch.checkReadMeFirst({ root: ROOT });

    // The reason, not just the boolean: a `false` here has three causes and the
    // message is what tells them apart.
    expect(result.reason).toBe("matches");
    expect(result.ok).toBe(true);
  });

  test("... and the path it checks is the one the DMG actually ships", () => {
    expect(firstLaunch.READ_ME_FIRST).toBe("resources/READ-ME-FIRST.txt");

    // `electron-builder.yml` lists it in `dmg.contents`, and defining `contents`
    // replaces the defaults — so a path that moves loses the file silently, and
    // this is the only surface that exists before the app can run.
    const builder = fs.readFileSync(
      path.join(ROOT, "electron-builder.yml"),
      "utf8",
    );
    expect(builder).toContain(`resources/READ-ME-FIRST.txt`);
  });

  test("drift is reported against the line that drifted", () => {
    const root = withTempRoot();
    try {
      fs.mkdirSync(path.join(root, "resources"), { recursive: true });
      fs.writeFileSync(
        path.join(root, firstLaunch.READ_ME_FIRST),
        firstLaunch.renderReadMeFirst().replace("Open Anyway", "Some Other Button"),
      );

      const result = firstLaunch.checkReadMeFirst({ root });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not what this file renders");

      const difference = firstLaunch.firstDifference(
        result.expected ?? "",
        result.actual ?? "",
      );
      // The point of `firstDifference`: name the edit, not the file.
      expect(difference?.actual).toContain("Some Other Button");
      expect(difference?.expected).toContain("Open Anyway");
      expect(difference?.line).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing file is drift as well, not a crash", () => {
    const root = withTempRoot();
    try {
      const result = firstLaunch.checkReadMeFirst({ root });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("does not exist");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an identical file reports no difference at all", () => {
    const same = firstLaunch.renderReadMeFirst();
    expect(firstLaunch.firstDifference(same, same)).toBeNull();
  });
});

describe("the four surfaces agree because they share the facts", () => {
  const surfaces = () => ({
    "the release note": firstLaunch.releaseNoteParagraph(),
    "the CI warning": firstLaunch.workflowWarning(),
    "the DMG's file": firstLaunch.renderReadMeFirst(),
    "the in-app notice": firstLaunch.noticeText(),
  });

  test("every surface names the procedure Apple documents", () => {
    expect(flat(firstLaunch.releaseNoteParagraph())).toContain(OPEN_ANYWAY);
    expect(firstLaunch.workflowWarning()).toContain(OPEN_ANYWAY);

    // The DMG's file is the one that does not use the run-on form, and
    // deliberately: it numbers the path, naming Privacy & Security in one step
    // and the button to click in the next, because that is the order the window
    // is in and a reader is following along with it on screen.
    const file = flat(firstLaunch.renderReadMeFirst());
    expect(file).toContain("System Settings -> Privacy & Security");
    expect(file).toContain("Open Anyway");
  });

  test("the release note is where a person reads it before downloading", () => {
    const note = firstLaunch.releaseNoteParagraph();
    expect(note).toContain("macOS will refuse the first launch");
    expect(note).toContain("READ-ME-FIRST.txt");
    // One paragraph: a blank line would split it in the rendered release body,
    // and the second half would read as a separate, unexplained statement.
    expect(note).not.toMatch(/\n\s*\n/);
  });

  test("the CI warning is a log line, so it carries no Markdown emphasis", () => {
    const warning = firstLaunch.workflowWarning();
    // Read by somebody paging a failed run: `**` there is literal asterisks.
    expect(warning).not.toContain("**");
    // ... and it has to name the consequence, not just the missing secret. This
    // is the half `release.yml` renders; the secret's name stays in the step.
    expect(warning).toContain("cannot install its own updates");
  });

  test("the DMG's file is ASCII, because it is read with `cat`", () => {
    const file = firstLaunch.renderReadMeFirst();
    expect(file).not.toContain("→");
    expect(file).toContain("->");
    // The refusal is quoted so somebody can recognise the dialog they are staring
    // at — which is the state this file is written for.
    expect(file).toContain("Apple could not verify");
  });

  test("no surface offers the removed shortcut as the way through", () => {
    for (const [name, text] of Object.entries(surfaces())) {
      for (const paragraph of text.split(/\n\s*\n/)) {
        if (!/right[- ]click/i.test(paragraph)) continue;
        // Mentioning it is the point — a reader reaching for the reflex has to be
        // told why it does not work. Offering it is the failure.
        expect(paragraph, `${name} offers the removed shortcut: ${paragraph}`).toMatch(
          /removed|no longer/i,
        );
      }
    }
  });

  test("the two that explain the history name the macOS release that ended it", () => {
    // Not the warning: a maintainer paging a failed run needs the consequence and
    // which secret to set, not the story of which macOS release changed the rules.
    expect(firstLaunch.releaseNoteParagraph()).toContain(
      firstLaunch.SHORTCUT_REMOVED_IN,
    );
    expect(firstLaunch.renderReadMeFirst()).toContain(
      firstLaunch.SHORTCUT_REMOVED_IN,
    );
  });

  test("... and the same facts come out of the exporters, not a second copy", () => {
    expect(firstLaunch.removedShortcut()).toBe("right-click → **Open**");
    expect(firstLaunch.removedShortcut(firstLaunch.ARROW.plain)).toBe(
      "right-click -> Open",
    );
    expect(firstLaunch.settingsPath()).toBe(OPEN_ANYWAY);
    expect(firstLaunch.settingsPath(firstLaunch.ARROW.plain)).toBe(
      "System Settings -> Privacy & Security -> Open Anyway",
    );
    expect(firstLaunch.SETTINGS_PATH.join(" ")).toBe(
      "System Settings Privacy & Security Open Anyway",
    );
  });

  test("the quarantine command and the app path are one fact", () => {
    expect(firstLaunch.INSTALL_PATH).toBe(
      `/Applications/${firstLaunch.APP_NAME}.app`,
    );
    expect(firstLaunch.QUARANTINE_COMMAND).toBe(
      `xattr -dr com.apple.quarantine ${firstLaunch.INSTALL_PATH}`,
    );
    // The file offers it as the alternative to clicking through dialogs, so it has
    // to be the command that actually clears the flag.
    expect(firstLaunch.renderReadMeFirst()).toContain(
      `    ${firstLaunch.QUARANTINE_COMMAND}`,
    );
  });
});

describe("the in-app notice is rendered, not written into the component", () => {
  test("every file the source renders is current, and there are two of them", () => {
    const results = firstLaunch.checkRenderedFiles({ root: ROOT });

    // Named rather than counted as "no failures": a renderer dropped from
    // `RENDERED_FILES` is invisible to a loop over what is left, and that is
    // exactly how the fifth hand-written copy would come back.
    expect(results.map((entry) => entry.file).sort()).toEqual(
      [firstLaunch.NOTICE_MODULE, firstLaunch.READ_ME_FIRST].sort(),
    );
    for (const result of results) {
      expect(result.reason, result.file).toBe("matches");
    }
  });

  test("the words live where the renderer can import them", () => {
    // `src/shared/` because both TypeScript projects include it — the renderer's
    // for the component, the root one for this spec — and a generated file
    // nothing typechecks is a generated file nobody notices.
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(ROOT, "tsconfig.web.json"), "utf8"),
    ) as { include: string[] };
    expect(firstLaunch.NOTICE_MODULE.startsWith("src/shared/")).toBe(true);
    expect(tsconfig.include).toContain("src/shared/**/*.ts");

    // The module is the notice, so the export it generates has to be the words
    // the other surfaces were checked against.
    const module = firstLaunch.renderNoticeModule();
    expect(module).toContain(JSON.stringify(firstLaunch.noticeTitle()));
    expect(module).toContain(JSON.stringify(firstLaunch.noticeBody()));
  });

  test("the component renders the generated words instead of holding a copy", () => {
    const component = fs.readFileSync(
      path.join(ROOT, "src/renderer/components/layout/adhoc-build-notice.tsx"),
      "utf8",
    );
    expect(component).toContain("@shared/adhoc-notice");
    expect(component).toContain("AD_HOC_NOTICE_TITLE");
    expect(component).toContain("AD_HOC_NOTICE_BODY");
    // The half that catches a paste-back: had the sentence returned to the
    // component, the generated module would still be current and every other
    // assertion in this file would pass.
    expect(component).not.toContain(
      "macOS asked you to confirm the first launch",
    );
  });

  test("the notice composes the shared facts rather than restating them", () => {
    // What makes this a rendered surface rather than a moved one: the procedure
    // is interpolated, so the day that path is named differently the notice
    // follows without anybody remembering it exists.
    expect(firstLaunch.noticeBody()).toContain(firstLaunch.settingsPath());
    expect(firstLaunch.noticeBody()).toContain(
      firstLaunch.CANNOT_INSTALL_UPDATES,
    );
    expect(firstLaunch.noticeTitle().toLowerCase()).toContain("first launch");

    // ... and it explains rather than instructs, because the person reading it
    // has already been through the steps.
    expect(firstLaunch.noticeBody()).not.toMatch(/\n\s*\d\./);
  });

  test("drift in the generated module is drift, and it does not hide the other file", () => {
    const root = withTempRoot();
    try {
      fs.mkdirSync(path.join(root, "src", "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(root, firstLaunch.NOTICE_MODULE),
        firstLaunch
          .renderNoticeModule()
          .replace("Open Anyway", "Some Other Button"),
      );

      const results = firstLaunch.checkRenderedFiles({ root });
      const notice = results.find(
        (entry) => entry.file === firstLaunch.NOTICE_MODULE,
      );
      expect(notice?.ok).toBe(false);
      expect(notice?.reason).toContain("not what this file renders");

      // Both are reported: a run that stopped at the first problem would leave
      // the other to be discovered on the next push, and one flag fixes both.
      expect(results.every((entry) => !entry.ok)).toBe(true);
      expect(results.map((entry) => entry.file)).toContain(
        firstLaunch.READ_ME_FIRST,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the CLI", () => {
  test("--print read-me is byte-for-byte the file it describes", () => {
    const printed = runCli(["--print", "read-me"]);
    expect(printed.status).toBe(0);
    // This is what makes `--print read-me > resources/READ-ME-FIRST.txt` a no-op
    // rather than a one-line diff nobody can explain.
    expect(printed.stdout).toBe(
      fs.readFileSync(path.join(ROOT, firstLaunch.READ_ME_FIRST), "utf8"),
    );
  });

  test("--print writes each of the four surfaces, and only those", () => {
    for (const mode of Object.keys(firstLaunch.PRINTS)) {
      const printed = runCli(["--print", mode]);
      expect(printed.status, `--print ${mode}`).toBe(0);
      expect(printed.stdout.trim().length).toBeGreaterThan(0);
    }
    expect(Object.keys(firstLaunch.PRINTS).sort()).toEqual([
      "notice",
      "read-me",
      "release-note",
      "warning",
    ]);
  });

  test("--check passes on this repository", () => {
    const checked = runCli(["--check"]);
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("matches this file");
  });

  test("--check fails, and says how to repair it, when the file has drifted", () => {
    // Run from a copy of the script, because it resolves the repository from its
    // own location rather than from the working directory. That is the right way
    // round — a check that could be pointed at another tree is one that could be
    // pointed away from the tree it is supposed to be checking — but it does mean
    // the failure path is only reachable from a tree that is genuinely drifted.
    const root = withTempRoot();
    try {
      const script = path.join(root, "scripts", "first-launch.mjs");
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.mkdirSync(path.join(root, "resources"), { recursive: true });
      fs.copyFileSync(SCRIPT, script);
      fs.writeFileSync(
        path.join(root, firstLaunch.READ_ME_FIRST),
        "something a person edited by hand\n",
      );

      const checked = runCli(["--check"], { cwd: root, script });
      expect(checked.status).toBe(1);
      // A failure that does not name the fix is a failure that comes back.
      expect(checked.stderr).toContain("--write");
      expect(checked.stderr).toContain("line 1");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("--write puts every rendered file back, and --check then agrees", () => {
    // From a copy of the script in an empty tree, so `--write` has to create the
    // directories it writes into: a repair that only works in a checkout is not a
    // repair. Both files, because one flag fixes both and a half-written pair is
    // the drift this exists to prevent.
    const root = withTempRoot();
    try {
      const script = path.join(root, "scripts", "first-launch.mjs");
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.copyFileSync(SCRIPT, script);

      const written = runCli(["--write"], { cwd: root, script });
      expect(written.status).toBe(0);
      expect(written.stdout).toContain(firstLaunch.NOTICE_MODULE);
      expect(
        fs.existsSync(path.join(root, firstLaunch.NOTICE_MODULE)),
      ).toBe(true);

      const checked = runCli(["--check"], { cwd: root, script });
      expect(checked.status).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("bad usage exits 2 without pretending to have done something", () => {
    const unknown = runCli(["--print", "bogus"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("read-me");

    const nothing = runCli([]);
    expect(nothing.status).toBe(2);
    expect(nothing.stderr).toContain("nothing to do");
  });
});

describe("CI runs the gate", () => {
  test("ci.yml checks both halves on every push and pull request", () => {
    const ci = fs.readFileSync(
      path.join(ROOT, ".github/workflows/ci.yml"),
      "utf8",
    );

    // A check nobody runs is a comment. This one is wired into the fast job, on
    // every push and every pull request, because the thing it guards is a sentence
    // in a document rather than code that stops compiling.
    expect(ci).toContain("pnpm first-launch:check");
    expect(ci).toMatch(/^on:\n\s+push:/m);
    expect(ci).toContain("pull_request:");
  });

  test("the package script runs the freshness check and the advice check", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    // Both halves, in that order: the file has to be what the source renders, and
    // no surface may still offer the removed shortcut. `--write` is the repair.
    expect(pkg.scripts["first-launch:check"]).toContain("first-launch.mjs --check");
    expect(pkg.scripts["first-launch:check"]).toContain(
      "check-first-launch-advice.mjs",
    );
    expect(pkg.scripts["first-launch:write"]).toContain("first-launch.mjs --write");
  });
});

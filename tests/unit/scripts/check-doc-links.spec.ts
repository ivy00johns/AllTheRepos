/**
 * Unit test for `scripts/check-doc-links.mjs`.
 *
 * The point of that script is a verdict, so this test is about verdicts:
 *
 *   1. **Extraction** — which strings in a Markdown file count as links, and
 *      where they are. Written against real file shapes (an autolink, a
 *      reference definition, a sentence ending in a full stop).
 *   2. **The decision, before any request** — what is skipped, what is checked
 *      over the API, what is checked over the web.
 *   3. **The verdict** — and above all the line between *dead* and *could not
 *      be judged*. A 404 is a verdict; a 403, a 429, a 5xx and a timeout are
 *      not, and getting that wrong is how a link check becomes a flaky gate
 *      everyone learns to ignore.
 *
 * No network: `fetch` is injected everywhere, so a test never depends on a host
 * being reachable — or on it still being up in six months, which is the whole
 * reason the script exists.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

interface Link {
  url: string;
  file: string;
  line: number;
}

interface Result extends Link {
  state: "ok" | "dead" | "unverified" | "skipped";
  reason: string;
  places: { file: string; line: number }[];
}

type Plan =
  | { action: "skip"; reason: string }
  | {
      action: "check";
      via: "api" | "http";
      target: string;
      repoApi: string | null;
    };

interface CheckDocLinksModule {
  extractLinks(markdown: string): { url: string; line: number }[];
  extractLocalLinks(markdown: string): { target: string; line: number }[];
  planLocalLink(input: { target: string; file: string; root: string }): {
    state: "ok" | "dead" | "skipped";
    relative: string | null;
    reason: string;
  };
  collectLocalLinks(root: string, files?: string[]): {
    target: string;
    file: string;
    line: number;
  }[];
  githubApiPath(url: string | URL): string | null;
  planFor(
    url: string,
    options?: { pendingRelease?: string | null; pendingVersion?: string | null },
  ): Plan;
  verdictFor(input: {
    via: "api" | "http";
    status: number;
    error?: string;
  }): { state: "ok" | "dead" | "unverified"; reason: string };
  exitCodeFor(
    results: { state: string }[],
    localResults?: { state: string }[],
  ): number;
  checkLink(
    link: { url: string; file: string; line: number },
    options: Record<string, unknown>,
  ): Promise<Result>;
  checkLinks(
    links: { url: string; file: string; line: number }[],
    options: Record<string, unknown>,
  ): Promise<Result[]>;
  collectLinks(root: string, files?: string[]): Link[];
  pendingReleaseUrl(root: string): string | null;
  run(options: Record<string, unknown>): Promise<number>;
  LOCAL_HOSTS: Set<string>;
  NOT_A_LINK: Map<string, string>;
}

let links: CheckDocLinksModule;

beforeAll(async () => {
  links = (await import(
    pathToFileURL(path.join(SCRIPTS, "check-doc-links.mjs")).href
  )) as CheckDocLinksModule;
});

/**
 * A `fetch` that answers from a table and records what it was asked.
 *
 * The responder returns either a status or a thrown error (a timeout, a DNS
 * failure), because both are how a link fails to be judged.
 */
function stubFetch(
  responder: (
    url: string,
    init: { method: string; headers: Record<string, string> },
  ) => { status: number } | { error: Error },
) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] =
    [];
  const fetchImpl = (async (
    url: string,
    init: { method?: string; headers?: Record<string, string> },
  ) => {
    const call = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
    };
    calls.push(call);
    const result = responder(call.url, call);
    if ("error" in result) throw result.error;
    return { status: result.status, url };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const at = (url: string, file = "README.md", line = 1): Link => ({
  url,
  file,
  line,
});

describe("extractLinks", () => {
  test("finds every URL shape the repo writes, on the right line", () => {
    const markdown = [
      "# Title",
      "",
      "An autolink <https://www.electronjs.org/docs/latest/api/menu>.",
      "A link [docs](https://keepachangelog.com/en/1.1.0/) inline.",
      "[0.1.4]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4",
    ].join("\n");

    expect(links.extractLinks(markdown)).toEqual([
      {
        url: "https://www.electronjs.org/docs/latest/api/menu",
        line: 3,
      },
      { url: "https://keepachangelog.com/en/1.1.0/", line: 4 },
      {
        url: "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4",
        line: 5,
      },
    ]);
  });

  test("trims the sentence punctuation Markdown leaves stuck to the URL", () => {
    // Every one of these shapes is in the repo: prose that ends in a full stop,
    // a table cell, a bolded URL, and `api.openai.com;` in NEW-PLAN.md.
    expect(links.extractLinks("see https://semver.org/spec/v2.0.0.html.")).toEqual(
      [{ url: "https://semver.org/spec/v2.0.0.html", line: 1 }],
    );
    expect(links.extractLinks("| https://linktr.ee/john.stennett |")).toEqual([
      { url: "https://linktr.ee/john.stennett", line: 1 },
    ]);
    expect(links.extractLinks("**https://buymeacoffee.com/john00ivyz**")).toEqual([
      { url: "https://buymeacoffee.com/john00ivyz", line: 1 },
    ]);
    expect(links.extractLinks("- https://api.openai.com; the endpoint")).toEqual([
      { url: "https://api.openai.com", line: 1 },
    ]);
  });

  test("does not swallow the delimiters around a URL", () => {
    expect(links.extractLinks('<https://x.test/a> and `https://x.test/b`')).toEqual(
      [
        { url: "https://x.test/a", line: 1 },
        { url: "https://x.test/b", line: 1 },
      ],
    );
  });

  test("finds nothing in prose that merely mentions a host", () => {
    expect(links.extractLinks("no link here, just words")).toEqual([]);
  });
});

describe("extractLocalLinks", () => {
  test("finds both syntaxes the repo writes", () => {
    const markdown = [
      "See [the plan](./PLAN.md) and [a section](#how-to-read-this).",
      '<img src="docs/images/catalog.png" alt="the catalog" />',
      "[remaining]: docs/REMAINING-WORK.md",
      "[upstream](https://semver.org/spec/v2.0.0.html)",
    ].join("\n");

    expect(links.extractLocalLinks(markdown)).toEqual([
      { target: "./PLAN.md", line: 1 },
      { target: "docs/images/catalog.png", line: 2 },
      { target: "docs/REMAINING-WORK.md", line: 3 },
    ]);
  });

  test("ignores external targets and same-page anchors", () => {
    expect(links.extractLocalLinks("[a](#anchor) [b](mailto:x@y.z)")).toEqual([]);
  });
});

describe("planLocalLink", () => {
  // Its own tree, and not through `fixture()`: that helper's directory is swept
  // by the file-wide `afterEach`, which deletes it after the first test in the
  // file and would leave every test here resolving against nothing.
  const root = tree({
    "README.md": "# r\n",
    "docs/PLAN.md": "# p\n",
    "docs/agents/PLAN.md": "# a\n",
    "docs/images/shot one.png": "x\n",
  });
  afterAll(() => cleanupTmp(root));

  const plan = (target: string, file: string) =>
    links.planLocalLink({ target, file, root });

  test("resolves against the file that names the link, not the repo root", () => {
    // The same target is two different files from two directories — which is
    // the whole reason a broken relative link is so easy to miss.
    expect(plan("./PLAN.md", "docs/REMAINING-WORK.md")).toMatchObject({
      state: "ok",
      relative: path.join("docs", "PLAN.md"),
    });
    expect(plan("./PLAN.md", "docs/agents/domain-docs.md")).toMatchObject({
      state: "ok",
      relative: path.join("docs", "agents", "PLAN.md"),
    });
  });

  test("walks up with ../ and down into a directory", () => {
    expect(plan("../PLAN.md", "docs/agents/domain-docs.md")).toMatchObject({
      state: "ok",
      relative: path.join("docs", "PLAN.md"),
    });
    expect(plan("./agents/", "docs/PLAN.md")).toMatchObject({ state: "ok" });
  });

  test("treats a leading slash as repository-root relative, the way GitHub does", () => {
    expect(plan("/docs/PLAN.md", "README.md")).toMatchObject({
      state: "ok",
      relative: path.join("docs", "PLAN.md"),
    });
  });

  test("judges the file, not the fragment or the query", () => {
    expect(plan("./PLAN.md#the-next-wave", "docs/REMAINING-WORK.md").state).toBe(
      "ok",
    );
    expect(plan("./PLAN.md#a-heading-that-does-not-exist", "docs/REMAINING-WORK.md").state).toBe(
      "ok",
    );
  });

  test("decodes a percent-escaped path, so a space does not look like rot", () => {
    expect(plan("docs/images/shot%20one.png", "README.md")).toMatchObject({
      state: "ok",
    });
  });

  test("reports a target that is not there, with where it looked", () => {
    const result = plan("../design-system/alltherepos/MASTER.md", "docs/archive/plan-mvp.md");

    expect(result.state).toBe("dead");
    expect(result.reason).toBe("no such file or directory");
    // The resolved path is the actionable part: it is what says "this moved".
    expect(result.relative).toBe(
      path.join("docs", "design-system", "alltherepos", "MASTER.md"),
    );
  });

  test("refuses a target that climbs out of the repository", () => {
    expect(plan("../../../../etc/passwd", "docs/PLAN.md")).toMatchObject({
      state: "dead",
      reason: "resolves outside the repository",
    });
  });

  test("ignores a link to a section of its own file", () => {
    expect(plan("#how-to-read-this", "docs/PLAN.md").state).toBe("skipped");
  });
});

describe("planFor", () => {
  test("skips a URL that only answers on the machine reading the file", () => {
    expect(links.planFor("http://localhost:11434")).toEqual({
      action: "skip",
      reason: "answers only on the reading machine",
    });
    expect(links.planFor("http://127.0.0.1:3000/docs")).toMatchObject({
      action: "skip",
    });
  });

  test("skips every illustration, each with the reason it is one", () => {
    for (const [url, reason] of links.NOT_A_LINK) {
      expect(links.planFor(url), url).toEqual({ action: "skip", reason });
      expect(reason.length, `${url} needs a reason`).toBeGreaterThan(10);
    }
    // The placeholder at the top of the list is the one that would otherwise be
    // the check's first false positive.
    expect(links.planFor("https://github.com/user/repo.git").action).toBe("skip");
  });

  test("excuses the release page of the version being released, and only that URL", () => {
    // The bump commit lands minutes before the artifacts do, so the newest
    // version link 404s in that window. It is excused by exact URL, so a 404 on
    // any *other* version is still a dead link.
    const pending =
      "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.5";

    expect(links.planFor(pending, { pendingRelease: pending })).toEqual({
      action: "skip",
      reason:
        "the version being released — its page appears when the release workflow publishes it, and that workflow verifies the publish",
    });
    expect(
      links.planFor(
        "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4",
        { pendingRelease: pending },
      ),
    ).toMatchObject({ action: "check", via: "api" });
    // Without a pending version to excuse, it is judged like any other link —
    // which is what happens on the next run after a bump moves it on.
    expect(links.planFor(pending)).toMatchObject({ action: "check", via: "api" });
  });

  test("excuses the changelog's compare against the version being released, and only that", () => {
    // A release leaves *two* links pointing at a version that does not exist
    // yet: the release page above, and the changelog's own `[Unreleased]`
    // compare, which `scripts/next-release.mjs` rewrites on the bump commit.
    // Excusing only the first left this check red for a release that had been
    // prepared and not yet pushed — which is exactly what the repository's own
    // tooling asks a person to do, and how this was found.
    const pending =
      "https://github.com/ivy00johns/AllTheRepos/compare/v0.1.8...HEAD";

    expect(links.planFor(pending, { pendingVersion: "0.1.8" })).toEqual({
      action: "skip",
      reason:
        "the compare for the version being released — it resolves when the release workflow pushes the tag",
    });
    // Still only the version being released: a compare against an older one is
    // judged, so the excuse cannot swallow a genuinely dead link.
    expect(
      links.planFor(
        "https://github.com/ivy00johns/AllTheRepos/compare/v0.1.7...HEAD",
        { pendingVersion: "0.1.8" },
      ),
    ).toMatchObject({ action: "check" });
    // And with nothing being released, it is judged like any other link.
    expect(links.planFor(pending)).toMatchObject({ action: "check" });
  });

  test("checks GitHub through the API, and remembers the repository root", () => {
    expect(
      links.planFor(
        "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4",
      ),
    ).toEqual({
      action: "check",
      via: "api",
      target:
        "https://api.github.com/repos/ivy00johns/alltherepos-releases/releases/tags/v0.1.4",
      repoApi: "https://api.github.com/repos/ivy00johns/alltherepos-releases",
    });
  });

  test("checks anything else over plain HTTP", () => {
    expect(links.planFor("https://semver.org/spec/v2.0.0.html")).toEqual({
      action: "check",
      via: "http",
      target: "https://semver.org/spec/v2.0.0.html",
      repoApi: null,
    });
  });

  test("skips something that is not a URL at all", () => {
    expect(links.planFor("https://")).toMatchObject({ action: "skip" });
  });
});

describe("githubApiPath", () => {
  test("maps the shapes the repo actually writes", () => {
    expect(links.githubApiPath("https://github.com/IBM/plex")).toBe(
      "/repos/IBM/plex",
    );
    expect(
      links.githubApiPath("https://github.com/ivy00johns/alltherepos-releases"),
    ).toBe("/repos/ivy00johns/alltherepos-releases");
    expect(
      links.githubApiPath(
        "https://github.com/ivy00johns/alltherepos-releases/releases",
      ),
    ).toBe("/repos/ivy00johns/alltherepos-releases/releases");
    expect(
      links.githubApiPath(
        "https://github.com/ivy00johns/AllTheRepos/compare/v0.1.4...HEAD",
      ),
    ).toBe("/repos/ivy00johns/AllTheRepos/compare/v0.1.4...HEAD");
    expect(
      links.githubApiPath(
        "https://github.com/ivy00johns/AllTheRepos/commit/2669d50b6405a84a6d9a6b5f5109750df2041f96",
      ),
    ).toBe("/repos/ivy00johns/AllTheRepos/commits/2669d50b6405a84a6d9a6b5f5109750df2041f96");
  });

  test("treats a badge URL as the workflow it draws", () => {
    // The README links both the badge image and the page behind it; both are
    // the same workflow, and the workflow API is the one that answers for a
    // private repository.
    const expected = "/repos/ivy00johns/AllTheRepos/actions/workflows/ci.yml";
    expect(
      links.githubApiPath(
        "https://github.com/ivy00johns/AllTheRepos/actions/workflows/ci.yml",
      ),
    ).toBe(expected);
    expect(
      links.githubApiPath(
        "https://github.com/ivy00johns/AllTheRepos/actions/workflows/ci.yml/badge.svg",
      ),
    ).toBe(expected);
  });

  test("leaves a release *asset* to plain HTTP, so a deleted asset is not hidden", () => {
    // Mapping `releases/download/<tag>/<file>` to the tag endpoint would report
    // a file that is gone as present, because the release still exists.
    expect(
      links.githubApiPath(
        "https://github.com/ivy00johns/alltherepos-releases/releases/download/v0.1.4/AllTheRepos-0.1.4-arm64.dmg",
      ),
    ).toBeNull();
  });

  test("declines anything that is not a GitHub repository URL", () => {
    expect(links.githubApiPath("https://gitlab.com/owner/repo")).toBeNull();
    expect(links.githubApiPath("https://github.com/onlyanowner")).toBeNull();
    expect(links.githubApiPath("https://github.com/owner/repo/issues/1")).toBeNull();
  });
});

describe("verdictFor", () => {
  test("anything in the 2xx/3xx range resolved", () => {
    for (const status of [200, 204, 301]) {
      expect(links.verdictFor({ via: "http", status }).state, String(status)).toBe(
        "ok",
      );
    }
  });

  test("404 and 410 are dead, over the API and over the web", () => {
    expect(links.verdictFor({ via: "http", status: 404 })).toMatchObject({
      state: "dead",
    });
    expect(links.verdictFor({ via: "http", status: 410 })).toMatchObject({
      state: "dead",
    });
    expect(links.verdictFor({ via: "api", status: 404 })).toMatchObject({
      state: "dead",
    });
  });

  test("a rate limit, a bot wall, a bad gateway and a timeout are not verdicts", () => {
    // 403 is what a bot wall answers, 429 is a rate limit, 500/503 is a bad
    // afternoon, and an exception is a host that never answered. None of them
    // is evidence that a page was deleted, and a gate that fails on them gets
    // switched off.
    for (const status of [403, 429, 500, 503]) {
      expect(links.verdictFor({ via: "http", status }).state, String(status)).toBe(
        "unverified",
      );
      expect(links.verdictFor({ via: "api", status }).state, String(status)).toBe(
        "unverified",
      );
    }
    expect(
      links.verdictFor({ via: "http", status: 0, error: "timed out after 15s" }),
    ).toMatchObject({ state: "unverified", reason: "timed out after 15s" });
  });

  test("a 401 is a credential problem, not a dead link", () => {
    expect(links.verdictFor({ via: "api", status: 401 }).state).toBe("unverified");
  });
});

describe("exitCodeFor", () => {
  test("1 when anything is dead, whatever else is wrong", () => {
    expect(links.exitCodeFor([{ state: "ok" }, { state: "dead" }])).toBe(1);
    expect(links.exitCodeFor([{ state: "unverified" }, { state: "dead" }])).toBe(1);
  });

  test("0 when the links were judged, warnings and skips included", () => {
    expect(links.exitCodeFor([{ state: "ok" }, { state: "unverified" }])).toBe(0);
    expect(links.exitCodeFor([{ state: "ok" }, { state: "skipped" }])).toBe(0);
  });

  test("2 when nothing could be judged at all — a broken check, not a clean repo", () => {
    expect(links.exitCodeFor([{ state: "unverified" }])).toBe(2);
    expect(links.exitCodeFor([{ state: "unverified" }, { state: "skipped" }])).toBe(
      2,
    );
  });

  test("0 for an empty run — there is nothing to be wrong about", () => {
    expect(links.exitCodeFor([])).toBe(0);
    expect(links.exitCodeFor([{ state: "skipped" }])).toBe(0);
  });

  test("1 when a relative path inside the repo is broken, whatever the web did", () => {
    expect(
      links.exitCodeFor([{ state: "ok" }], [{ state: "dead" }]),
    ).toBe(1);
  });

  test("a file that exists cannot vouch for a web that was never reached", () => {
    // Exit 2 means "the check could not run", and resolving a path in the
    // working tree says nothing about whether the network worked.
    expect(
      links.exitCodeFor([{ state: "unverified" }], [{ state: "ok" }]),
    ).toBe(2);
  });
});

describe("checkLink", () => {
  test("sends nothing at all for a skipped link", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200 }));
    const result = await links.checkLink(at("http://localhost:11434"), {
      fetchImpl,
      token: null,
    });

    expect(result.state).toBe("skipped");
    expect(calls).toEqual([]);
  });

  test("reports a 404 on a public repository as dead — the v0.1.1 case", async () => {
    // The release was deleted, so the tag URL 404s. The repository itself is
    // visible, which is what makes the 404 a verdict rather than a shrug.
    const { fetchImpl, calls } = stubFetch((url) =>
      url.startsWith("https://api.github.com/repos/") &&
      !url.includes("/releases/")
        ? { status: 200 }
        : { status: 404 },
    );

    const result = await links.checkLink(
      at(
        "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.1",
      ),
      { fetchImpl, token: null },
    );

    expect(result.state).toBe("dead");
    expect(result.reason).toBe("HTTP 404");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/ivy00johns/alltherepos-releases/releases/tags/v0.1.1",
      "https://api.github.com/repos/ivy00johns/alltherepos-releases",
    ]);
  });

  test("refuses to call a private repository's 404 dead without a credential", async () => {
    // Anonymous readers get 404 for a private repository *and* for a deleted
    // page, so the second request asks whether the repository is visible at all.
    const { fetchImpl } = stubFetch(() => ({ status: 404 }));
    const result = await links.checkLink(
      at("https://github.com/ivy00johns/AllTheRepos/compare/v0.1.4...HEAD"),
      { fetchImpl, token: null },
    );

    expect(result.state).toBe("unverified");
    expect(result.reason).toContain("no credential");
  });

  test("judges that same link with a credential, in one request", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200 }));
    const result = await links.checkLink(
      at("https://github.com/ivy00johns/AllTheRepos/compare/v0.1.4...HEAD"),
      { fetchImpl, token: "t" },
    );

    expect(result.state).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe("Bearer t");
  });

  test("never sends the GitHub credential to a non-GitHub host", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200 }));
    await links.checkLink(at("https://semver.org/spec/v2.0.0.html"), {
      fetchImpl,
      token: "t",
    });

    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].headers.accept).toBeUndefined();
  });

  test("retries a URL whose host refuses HEAD with a GET", async () => {
    const { fetchImpl, calls } = stubFetch((_url, init) =>
      init.method === "HEAD" ? { status: 405 } : { status: 200 },
    );
    const result = await links.checkLink(at("https://semver.org/"), {
      fetchImpl,
      token: null,
    });

    expect(result.state).toBe("ok");
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  test("calls a timeout unverified rather than dead", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const { fetchImpl } = stubFetch(() => ({ error: timeout }));
    const result = await links.checkLink(at("https://slow.test/"), {
      fetchImpl,
      token: null,
      timeoutMs: 15000,
    });

    expect(result.state).toBe("unverified");
    expect(result.reason).toBe("timed out after 15s");
  });
});

describe("checkLinks", () => {
  test("fetches a repeated URL once and remembers every place it appears", async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200 }));
    const results = await links.checkLinks(
      [
        at("https://buymeacoffee.com/john00ivyz", "README.md", 3),
        at("https://buymeacoffee.com/john00ivyz", "README.md", 9),
      ],
      { fetchImpl, token: null },
    );

    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0].places).toEqual([
      { file: "README.md", line: 3 },
      { file: "README.md", line: 9 },
    ]);
  });
});

describe("pendingReleaseUrl", () => {
  const BUILDER = `appId: com.acme.fixture
publish:
  provider: github
  owner: acme
  repo: fixture-releases
  releaseType: release
`;

  test("builds the release page of the version being released", () => {
    const root = fixture({
      "package.json": JSON.stringify({ version: "1.2.3" }),
      "electron-builder.yml": BUILDER,
    });

    expect(links.pendingReleaseUrl(root)).toBe(
      "https://github.com/acme/fixture-releases/releases/tag/v1.2.3",
    );
  });

  test("excuses nothing when the checkout has no version or no publish config", () => {
    expect(
      links.pendingReleaseUrl(fixture({ "package.json": '{"version":"1.2.3"}' })),
    ).toBeNull();
    expect(links.pendingReleaseUrl(fixture({"README.md": "nothing"}))).toBeNull();
  });
});

// --- the CLI, against a temporary checkout --------------------------------

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

/**
 * A throwaway tree for tests that need real files to resolve against.
 *
 * Deliberately not registered with `dirs`: the caller owns its lifetime, so a
 * tree created for a whole `describe` is not swept by the first `afterEach`.
 */
function tree(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-tree");
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return dir;
}

function fixture(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-links");
  dirs.push(dir);
  for (const [name, markdown] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, markdown);
  }
  return dir;
}

describe("run", () => {
  const good = "[docs](https://keepachangelog.com/en/1.1.0/) and <https://semver.org/spec/v2.0.0.html>";

  test("exits 0 and reports how much it resolved", async () => {
    const root = fixture({ "README.md": good, "docs/PLAN.md": good });
    const { fetchImpl } = stubFetch(() => ({ status: 200 }));
    const lines: string[] = [];

    const code = await links.run({
      root,
      files: ["README.md", "docs/PLAN.md"],
      fetchImpl,
      token: null,
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("2 external links and 0 relative paths");
    expect(lines.join("\n")).toContain("2 external resolved");
  });

  test("exits 1 and names the file, line and status of a dead link", async () => {
    const root = fixture({
      "README.md": good,
      "CHANGELOG.md": "[0.1.1]: https://releases.test/releases/tag/v0.1.1",
    });
    const { fetchImpl } = stubFetch((url) =>
      url.includes("v0.1.1") ? { status: 404 } : { status: 200 },
    );
    const errors: string[] = [];

    const code = await links.run({
      root,
      files: ["README.md", "CHANGELOG.md"],
      fetchImpl,
      token: null,
      log: () => {},
      error: (line: string) => errors.push(line),
    });

    expect(code).toBe(1);
    const output = errors.join("\n");
    expect(output).toContain("✗ https://releases.test/releases/tag/v0.1.1");
    expect(output).toContain("CHANGELOG.md:1 — HTTP 404");
    expect(output).toContain("1 dead link(s)");
  });

  test("exits 1 for a broken relative link, with no request made at all", async () => {
    const root = fixture({
      "README.md": "[the plan](./docs/PLAN.md)\n",
      "docs/PLAN.md": "[gone](./GONE.md)\n",
    });
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200 }));
    const errors: string[] = [];

    const code = await links.run({
      root,
      files: ["README.md", "docs/PLAN.md"],
      fetchImpl,
      token: null,
      log: () => {},
      error: (line: string) => errors.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    const output = errors.join("\n");
    expect(output).toContain("✗ ./GONE.md");
    expect(output).toContain("docs/PLAN.md:1 — no such file or directory");
  });

  test("collects the repository's own relative paths through git", () => {
    const repo = path.resolve(__dirname, "..", "..", "..");
    const found = links.collectLocalLinks(repo);

    expect(found.length).toBeGreaterThan(20);
    expect(found.some((link) => link.target.includes("docs/"))).toBe(true);
  });

  test("exits 2 when every request failed, so a broken check is not a clean repo", async () => {
    const root = fixture({ "README.md": good });
    const { fetchImpl } = stubFetch(() => ({
      error: Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        name: "FetchError",
      }),
    }));
    const errors: string[] = [];

    const code = await links.run({
      root,
      files: ["README.md"],
      fetchImpl,
      token: null,
      log: () => {},
      error: (line: string) => errors.push(line),
    });

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("nothing could be checked");
  });

  test("passes a checkout whose changelog links the version being released", async () => {
    // This is the state CI sees on the bump commit, and the reason the check
    // does not go red on every release: v1.2.3 is in package.json and its
    // release page does not exist yet.
    const root = fixture({
      "package.json": '{"version":"1.2.3"}',
      "electron-builder.yml":
        "publish:\n  provider: github\n  owner: acme\n  repo: fixture-releases\n",
      "CHANGELOG.md":
        "# Changelog\n\n[1.2.3]: https://github.com/acme/fixture-releases/releases/tag/v1.2.3\n",
    });
    const { fetchImpl, calls } = stubFetch(() => ({ status: 404 }));
    const lines: string[] = [];

    const code = await links.run({
      root,
      files: ["CHANGELOG.md"],
      fetchImpl,
      token: null,
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    const output = lines.join("\n");
    expect(output).toContain("skipped https://github.com/acme/fixture-releases/releases/tag/v1.2.3");
    expect(output).toContain("the version being released");
  });

  test("reads the repository's own tracked Markdown through git", async () => {
    // The one thing the temp-dir fixtures above cannot cover: that the file
    // list comes from `git ls-files`, so the check sees exactly what ships and
    // what a runner checks out.
    const repo = path.resolve(__dirname, "..", "..", "..");
    const found = links.collectLinks(repo);

    expect(found.length).toBeGreaterThan(20);
    expect(found.some((link) => link.file === "CHANGELOG.md")).toBe(true);
    expect(found.every((link) => !link.file.includes("node_modules"))).toBe(true);
  });
});

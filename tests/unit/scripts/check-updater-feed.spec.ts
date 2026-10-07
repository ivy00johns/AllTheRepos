/**
 * Unit test for `scripts/check-updater-feed.mjs`.
 *
 * This is the read the shipped app performs and nothing else in the repository
 * performs: `release:verify` inspects the manifest with a credential at the
 * moment of publishing, while an install asks anonymously through
 * `releases/latest`, weeks later, and refuses the archive unless the sha512 in
 * the manifest matches the bytes it downloaded. The drift between those two
 * reads is what this covers, and it is drift nothing else would notice.
 *
 * Three properties are asserted here rather than left to the drill:
 *
 *   1. **Every request is anonymous.** A token would make the check pass on the
 *      runner and fail for everyone who installs the app — which is the failure
 *      being guarded, so it is asserted with a token deliberately set in the
 *      environment.
 *   2. **The digest is checked against real bytes**, not against the manifest's
 *      own claim: the archive is fetched and hashed, and different bytes have to
 *      fail.
 *   3. **A file that could not be downloaded is a failure, not a skip.** The
 *      manifest exists to point at that file; a check that never read it has
 *      proved nothing about it, and a silent pass there is how a feed rots.
 *
 * The network is injected, so no test touches GitHub. The real read is proven
 * on demand by the `feed` job in `.github/workflows/release.yml`.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

const MANIFEST_URL = "https://example.test/downloads/latest-mac.yml";
const ARCHIVE_URL = "https://example.test/downloads/AllTheRepos-0.2.0-arm64-mac.zip";
const DMG_URL = "https://example.test/downloads/AllTheRepos-0.2.0-arm64.dmg";

/** The bytes the fixture manifest promises, and that digest, worked out once. */
const ARCHIVE = Buffer.from("alltherepos-update-archive");
const ARCHIVE_SHA512 =
  "4JYouEY1gT6TjwPNrwmmN4Txmki812wqkHp+F81Z0/2IZ7hsk1M2kSpCJylqolP/Dp0kfPIuwAlW7HPHHOsu5Q==";
// The same length as ARCHIVE on purpose: the size check then has nothing to
// say, so the only thing that can fail below is the digest itself.
const OTHER_ARCHIVE = Buffer.from("alltherepos-update-archivZ");

/**
 * A manifest with the shape electron-builder writes.
 *
 * The top-level `sha512` is deliberately *not* the archive's: it belongs to the
 * `path` line, and a parser that reads it as the file's digest would be
 * comparing the right digest against the wrong file. The happy path below fails
 * if that happens, which is the point of it being different here.
 */
const MANIFEST = [
  "version: 0.2.0",
  "files:",
  "  - url: AllTheRepos-0.2.0-arm64-mac.zip",
  `    sha512: ${ARCHIVE_SHA512}`,
  `    size: ${ARCHIVE.length}`,
  "path: AllTheRepos-0.2.0-arm64-mac.zip",
  "sha512: not-the-archive-digest==",
  "releaseDate: '2026-10-06T20:08:30.749Z'",
  "",
].join("\n");

interface Archive {
  status: number;
  bytes: Buffer | null;
}

interface Audit {
  failures: string[];
  warnings: string[];
  notes: string[];
}

interface FeedModule {
  anonymousHeaders(): Record<string, string>;
  latestReleaseUrl(repo: string): string;
  manifestAsset(release: unknown): { name?: string } | null;
  manifestDownload(manifest: unknown): {
    url: string | null;
    sha512: string | null;
    size: number | null;
  };
  sha512Base64(bytes: Buffer): string;
  auditFeed(input: {
    release: unknown;
    manifest: unknown;
    archive?: Archive | null;
  }): Audit;
  runFeedCheck(options: {
    repo: string;
    fetchImpl: unknown;
    log: (line: string) => void;
    error: (line: string) => void;
  }): Promise<number>;
}

let feed: FeedModule;

beforeAll(async () => {
  feed = (await import(
    pathToFileURL(path.join(SCRIPTS, "check-updater-feed.mjs")).href
  )) as FeedModule;
});

/** A release that passes every check; each test breaks exactly one thing. */
function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.0",
    draft: false,
    prerelease: false,
    assets: [
      { name: "AllTheRepos-0.2.0-arm64.dmg", size: 125, browser_download_url: DMG_URL },
      {
        name: "AllTheRepos-0.2.0-arm64-mac.zip",
        size: ARCHIVE.length,
        browser_download_url: ARCHIVE_URL,
      },
      {
        name: "latest-mac.yml",
        size: MANIFEST.length,
        browser_download_url: MANIFEST_URL,
      },
    ],
    ...overrides,
  };
}

/** The manifest above, as the parser hands it to `auditFeed`. */
const PARSED_MANIFEST = {
  version: "0.2.0",
  path: "AllTheRepos-0.2.0-arm64-mac.zip",
  files: [
    {
      url: "AllTheRepos-0.2.0-arm64-mac.zip",
      size: ARCHIVE.length,
      sha512: ARCHIVE_SHA512,
    },
  ],
};

function audit(
  releaseOverrides: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
) {
  return feed.auditFeed({
    release: release(releaseOverrides),
    manifest: PARSED_MANIFEST,
    archive: { status: 200, bytes: ARCHIVE },
    ...input,
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * A `fetch` that answers from a fixture and records every call, headers
 * included — which is how the anonymity guarantee is asserted.
 */
function fetcher(
  routes: {
    latest?: unknown;
    latestStatus?: number;
    manifestText?: string;
    manifestStatus?: number;
    archive?: Buffer;
    archiveStatus?: number;
  } = {},
) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const impl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });

    const respond = (status: number, body: unknown) => ({
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      arrayBuffer: async () =>
        toArrayBuffer(
          Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? "")),
        ),
    });

    if (url.endsWith("/releases/latest")) {
      return respond(routes.latestStatus ?? 200, routes.latest ?? release());
    }
    if (url === ARCHIVE_URL) {
      return respond(routes.archiveStatus ?? 200, routes.archive ?? ARCHIVE);
    }
    if (url === MANIFEST_URL) {
      return respond(routes.manifestStatus ?? 200, routes.manifestText ?? MANIFEST);
    }
    return respond(404, null);
  };

  return { calls, impl };
}

function run(
  routes: Parameters<typeof fetcher>[0] = {},
  options: Record<string, unknown> = {},
) {
  const { calls, impl } = fetcher(routes);
  const lines: string[] = [];
  const failed: string[] = [];
  const result = feed
    .runFeedCheck({
      repo: "acme/alltherepos-releases",
      fetchImpl: impl,
      log: (line: string) => lines.push(line),
      error: (line: string) => failed.push(line),
      ...options,
    })
    .then((status: number) => ({
      status,
      calls,
      output: [...lines, ...failed].join("\n"),
    }));
  return result;
}

describe("auditFeed", () => {
  test("a complete, coherent feed passes with nothing to report", () => {
    const result = audit();

    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.notes.join("\n")).toContain("release v0.2.0");
    expect(result.notes.join("\n")).toContain(
      `AllTheRepos-0.2.0-arm64-mac.zip (${ARCHIVE.length} bytes)`,
    );
    expect(result.notes.join("\n")).toContain("sha512 of the download matches");
  });

  test("the zip's own digest is compared, not the manifest's top-level one", () => {
    // The fixture's top-level `sha512` is a different string, so a digest that
    // is read from there can never match the bytes it points at.
    expect(feed.sha512Base64(ARCHIVE)).toBe(ARCHIVE_SHA512);
    expect(audit().failures).toEqual([]);
  });

  test("bytes that do not match the promised digest are a failure", () => {
    const result = audit({}, { archive: { status: 200, bytes: OTHER_ARCHIVE } });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain(feed.sha512Base64(OTHER_ARCHIVE));
    expect(result.failures[0]).toContain(ARCHIVE_SHA512);
    expect(result.failures[0]).toContain("refuse it");
  });

  test("a manifest naming a file the release does not carry is a failure", () => {
    const result = audit({ assets: [] });

    expect(result.failures.join("\n")).toContain("is not attached to the release");
  });

  test("a manifest with no sha512 is a failure — there is nothing to verify", () => {
    const result = audit(
      {},
      {
        manifest: {
          ...PARSED_MANIFEST,
          files: [{ ...PARSED_MANIFEST.files[0], sha512: null }],
        },
      },
    );

    expect(result.failures.join("\n")).toContain("carries no sha512");
  });

  test("a declared size the download does not have is a failure", () => {
    const result = audit(
      {},
      {
        manifest: {
          ...PARSED_MANIFEST,
          files: [{ ...PARSED_MANIFEST.files[0], size: 999 }],
        },
      },
    );

    expect(result.failures.join("\n")).toContain("declares 999 bytes");
  });

  test("a manifest whose version is not the release's is a failure", () => {
    const result = audit({}, { manifest: { ...PARSED_MANIFEST, version: "0.1.0" } });

    expect(result.failures.join("\n")).toContain("says version 0.1.0");
  });

  test("a draft or a pre-release answered by /latest is a failure", () => {
    // `releases/latest` excludes both, so either means the read did not come
    // from where the updater looks — and nobody would ever be offered it.
    expect(audit({ draft: true }).failures.join("\n")).toContain("answered with a draft");
    expect(audit({ prerelease: true }).failures.join("\n")).toContain(
      "answered with a pre-release",
    );
  });

  test("no manifest attached is a failure, and says so plainly", () => {
    expect(audit({}, { manifest: null }).failures.join("\n")).toContain(
      "no latest-mac.yml is attached to v0.2.0",
    );
    // A release with no tag is a state we have never seen, but the message must
    // not read "attached to null" if it happens.
    expect(
      audit({ tag_name: undefined }, { manifest: null }).failures.join("\n"),
    ).toContain("attached to the latest release");
  });

  test("an archive that answers an error is a failure, not a skip", () => {
    // The whole reason the manifest is read is to download this file. A check
    // that could not fetch it has proved nothing — so it must not pass quietly.
    const result = audit({}, { archive: { status: 500, bytes: null } });

    expect(result.failures.join("\n")).toContain("could not be downloaded (HTTP 500)");
  });

  test("an archive that was never attempted is a failure too", () => {
    expect(audit({}, { archive: null }).failures.join("\n")).toContain(
      "never attempted",
    );
  });
});

describe("anonymousHeaders", () => {
  test("carries no credential of any kind", () => {
    const headers = feed.anonymousHeaders();
    const names = Object.keys(headers).map((name) => name.toLowerCase());

    expect(names).not.toContain("authorization");
    expect(names).not.toContain("token");

    const values = Object.values(headers).join(" ");
    expect(values).not.toMatch(/token|bearer|ghp_/i);
  });
});

describe("runFeedCheck", () => {
  test("reads the feed the way the app does, and reports what it found", async () => {
    const { status, calls, output } = await run();

    expect(status).toBe(0);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/acme/alltherepos-releases/releases/latest",
    );
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/acme/alltherepos-releases/releases/latest",
      MANIFEST_URL,
      ARCHIVE_URL,
    ]);
    expect(output).toContain("OK — an anonymous update check resolves");
  });

  test("sends no credential even when the environment holds one", async () => {
    // The failure this exists to catch: a check that passes because the machine
    // running it is authenticated, while every install sees nothing.
    const previous = process.env.GH_TOKEN;
    process.env.GH_TOKEN = "ghp_a_token_that_must_not_be_used";
    try {
      const { status, calls } = await run();

      expect(status).toBe(0);
      expect(calls).toHaveLength(3);
      for (const call of calls) {
        const names = Object.keys(call.headers).map((name) => name.toLowerCase());
        expect(names, call.url).not.toContain("authorization");
        expect(Object.values(call.headers).join(" "), call.url).not.toContain(
          "ghp_a_token_that_must_not_be_used",
        );
      }
    } finally {
      if (previous === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = previous;
    }
  });

  test("a repo an anonymous reader sees nothing in fails, naming both causes", async () => {
    // GitHub answers 404 for "no releases" and for "not public" alike, and both
    // look identical to an install, so the message has to say so rather than
    // pick one.
    const { status, output } = await run({ latestStatus: 404 });

    expect(status).toBe(1);
    expect(output).toContain("nothing an anonymous reader can see");
    expect(output).toContain("not public");
    expect(output).toContain("drafts and pre-releases");
  });

  test("a rate-limited read is 'could not run', not a broken feed", async () => {
    const { status, output } = await run({ latestStatus: 403 });

    expect(status).toBe(2);
    expect(output).toContain("says nothing about the feed");
  });

  test("a rate-limited manifest download is 'could not run' too", async () => {
    const { status } = await run({ manifestStatus: 429 });
    expect(status).toBe(2);
  });

  test("a missing manifest fails, and so does a broken archive download", async () => {
    expect((await run({ manifestStatus: 404 })).status).toBe(1);
    expect((await run({ archiveStatus: 500 })).status).toBe(1);
    expect(
      (await run({ archive: OTHER_ARCHIVE })).output,
    ).toContain("refuse it");
  });

  test("a network that never answers is 'could not run', not a verdict", async () => {
    const { status, output } = await run({}, {
      fetchImpl: async () => {
        throw new Error("ENOTFOUND api.github.com");
      },
    });

    expect(status).toBe(2);
    expect(output).toContain("could not reach GitHub");
  });

  test("refuses to guess which repo to read, as a fault and not as a rate limit", async () => {
    const { status, output } = await run({}, { repo: "" });

    // 3, not 2: the workflow reports 2 and fails on 3. Being handed no repo is
    // this checker being broken — nobody else will notice that if it passes.
    expect(status).toBe(3);
    expect(output).toContain("no repo to check");
  });

  test("keeps the two kinds of could-not-run apart", async () => {
    // The distinction the workflow's tolerance depends on: an environment that
    // refuses (2) is somebody else's problem and must not paint the run red, a
    // checker that cannot be used as asked (3) is ours and must.
    expect((await run({ latestStatus: 403 })).status).toBe(2);
    expect((await run({}, { repo: "" })).status).toBe(3);
  });
});

describe("reading the repo to check", () => {
  test("falls back to the publish block when nothing is passed", () => {
    // The default is `readReleasesRepo`, the same source `app-update.yml` is
    // generated from — pinned to the app's constants by
    // tests/unit/main/services/updater-feed.spec.ts, which is what makes reading
    // it dynamically safe rather than a second copy to keep in step.
    const source = fs.readFileSync(
      path.join(SCRIPTS, "check-updater-feed.mjs"),
      "utf8",
    );

    expect(source).toContain('import { readReleasesRepo } from "./release-config.mjs"');
    expect(source).toContain("readReleasesRepo(ROOT)");
    // One parser for latest-mac.yml, and it is the tested one.
    expect(source).toContain('import { MANIFEST_ASSET, parseManifest } from "./verify-release.mjs"');
    expect(source).not.toMatch(/function parseManifest/);
  });
});

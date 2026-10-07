/**
 * Unit test for `scripts/refuse-github.cjs` — the mock that makes GitHub answer
 * the way it does when an anonymous address has spent its hourly allowance.
 *
 * Two of these assertions are load-bearing beyond the obvious, and both of them
 * are about what happens to everything *else* in the process it is loaded into:
 *
 *   - **Its lines go to stderr.** `--require` puts this file into every Node
 *     process in the tree, including the short-lived ones other tools use for
 *     command substitution, and `binding.gyp` resolves an include directory with
 *     `<!@(node -p "require('node-addon-api').include")`. A marker on stdout
 *     becomes part of that path: the rebuild failed with `'napi.h' file not
 *     found`, which reads like a broken dependency and was really this file
 *     talking. It was found by loading the mock and running the rebuild.
 *   - **Requiring it installs it**, which is the entire contract `--require`
 *     depends on — and the reason this spec captures `globalThis.fetch` *before*
 *     the import and puts it back afterwards. Vitest runs the whole suite in one
 *     forked process (`singleFork`), so a mock left installed here would follow
 *     every later test file around.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOCK = path.join(ROOT, "scripts", "refuse-github.cjs");

interface Installed {
  (input: unknown, init?: unknown): Promise<unknown>;
  [key: symbol]: unknown;
}

interface RefusalModule {
  GITHUB_HOST: RegExp;
  INSTALLED: symbol;
  MARKER: string;
  OFF: string;
  REFUSAL_BODY: string;
  REFUSED: string;
  SWITCH: string;
  install(
    target?: { fetch?: unknown },
    options?: { refuse?: boolean },
  ): Installed;
  isGithubRead(url: string): boolean;
  readUrl(input: unknown): string;
  refusal(): Response;
}

let mock: RefusalModule;
let rescued: typeof globalThis.fetch;

beforeAll(async () => {
  rescued = globalThis.fetch;
  mock = (await import(pathToFileURL(MOCK).href)) as unknown as RefusalModule;
});

afterAll(() => {
  globalThis.fetch = rescued;
});

/** A `fetch` standing in for the platform's, so a test can watch it be bypassed. */
function passthrough() {
  return vi.fn(async () => new Response("the real answer", { status: 200 }));
}

describe("what counts as a read of GitHub", () => {
  test("the API, the site, and the asset hosts it serves files from", () => {
    for (const url of [
      "https://api.github.com/repos/ivy00johns/alltherepos-releases/releases/latest",
      "https://github.com/ivy00johns/alltherepos-releases/releases/download/v0.1.7/a.dmg",
      "https://objects.githubusercontent.com/some/path",
      "https://raw.githubusercontent.com/o/r/main/f",
    ]) {
      expect(mock.isGithubRead(url), url).toBe(true);
    }
  });

  test("and nothing else — a host that merely mentions GitHub is not one", () => {
    // `notgithub.com` ends with the string this is looking for, and it is not
    // GitHub. The rule is the *hostname*, anchored, rather than a `includes`.
    for (const url of [
      "https://example.com/x",
      "https://notgithub.com/x",
      "https://github.com.evil.test/x",
      "not a url at all",
    ]) {
      expect(mock.isGithubRead(url), url).toBe(false);
    }
  });
});

describe("the refusal itself", () => {
  test("is the 403 GitHub sends when the allowance is gone", async () => {
    const response = mock.refusal();

    expect(response.status).toBe(403);
    // Not decoration: it is the header a person reads in a captured run to see
    // that this was an allowance and not a permissions problem.
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(await response.json()).toMatchObject({
      message: expect.stringMatching(/rate limit exceeded/i),
    });
  });

  test("and the body is the one the mock hands out", () => {
    expect(JSON.parse(mock.REFUSAL_BODY)).toHaveProperty("message");
  });
});

describe("installing it", () => {
  test("refuses GitHub, and hands everything else to the real fetch", async () => {
    const real = passthrough();
    const installed = mock.install({ fetch: real });

    const refused = (await installed(
      "https://api.github.com/repos/o/r/releases/latest",
    )) as Response;
    expect(refused.status).toBe(403);
    expect(real).not.toHaveBeenCalled();

    // The whole point of mocking GitHub's *answer* rather than the network: a
    // request to anywhere else still goes out.
    const init = { headers: { accept: "text/plain" } };
    const allowed = (await installed("https://example.com/thing", init)) as Response;
    expect(allowed.status).toBe(200);
    expect(real).toHaveBeenCalledTimes(1);
    expect(real).toHaveBeenCalledWith("https://example.com/thing", init);
  });

  test("a Request-shaped first argument is read too, not passed through", async () => {
    const real = passthrough();
    const installed = mock.install({ fetch: real });

    const refused = (await installed({
      url: "https://github.com/o/r/releases/download/v1/a.zip",
    })) as Response;
    expect(refused.status).toBe(403);
    expect(real).not.toHaveBeenCalled();
  });

  test("with the switch thrown it installs, and refuses nothing", async () => {
    // The drill's whole scenario, and the reason it can be told apart from a mock
    // that failed to load: this one still says it installed — it just stops having
    // an opinion about GitHub, which is what lets the check's own failure path be
    // exercised instead of awaited.
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const real = passthrough();
      const installed = mock.install({ fetch: real }, { refuse: false });

      const response = (await installed(
        "https://api.github.com/repos/o/r/releases/latest",
      )) as Response;

      expect(err).toHaveBeenCalledWith(mock.MARKER);
      expect(response.status).toBe(200);
      expect(real).toHaveBeenCalledTimes(1);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  test("and the environment is where the drill throws it", async () => {
    // One variable, set on the child's environment, for the whole run — which is
    // the only way a drill can throw a switch inside a Playwright worker.
    vi.stubEnv(mock.SWITCH, mock.OFF);
    try {
      const real = passthrough();
      const installed = mock.install({ fetch: real });

      const response = (await installed(
        "https://github.com/o/r/releases/download/v1/a.zip",
      )) as Response;

      expect(response.status).toBe(200);
      expect(real).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("wrapping twice is a no-op, so the inner fetch is not wrapped twice", () => {
    const target = { fetch: passthrough() };

    const once = mock.install(target);
    const twice = mock.install(target);

    expect(twice).toBe(once);
  });

  test("says so on stderr, and never on stdout", async () => {
    // See the header: stdout is a channel other programs parse, and one of them
    // is what builds the native modules this suite runs on.
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const installed = mock.install({ fetch: passthrough() });

      expect(err).toHaveBeenCalledWith(mock.MARKER);

      await installed("https://api.github.com/repos/o/r/releases/latest");
      expect(err).toHaveBeenCalledWith(
        `${mock.REFUSED}https://api.github.com/repos/o/r/releases/latest`,
      );

      expect(out).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  test("requiring the file is enough — that is what `--require` relies on", () => {
    expect((globalThis.fetch as unknown as Installed)[mock.INSTALLED]).toBe(true);
  });
});

describe("the URL it reads out of fetch's first argument", () => {
  test("a string, a URL object, or anything with a `url`", () => {
    expect(mock.readUrl("https://github.com/x")).toBe("https://github.com/x");
    expect(mock.readUrl(new URL("https://github.com/x"))).toBe("https://github.com/x");
    expect(mock.readUrl({ url: "https://github.com/x" })).toBe("https://github.com/x");
  });
});

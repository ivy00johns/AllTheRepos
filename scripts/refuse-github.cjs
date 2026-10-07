/**
 * refuse-github.cjs — make GitHub decline to answer, on purpose, for one run.
 *
 * The packaged update check (`tests/e2e/packaged-update-check.spec.ts`) has a
 * branch for the one answer that is not a verdict on anything: `403`/`429`,
 * which is GitHub refusing an anonymous read rather than reporting on a release.
 * It is the branch that turned two real release runs red, and for a long time
 * the only way to exercise it was to exhaust a rate limit and hope.
 *
 * So this makes the refusal happen instead. Loaded with `--require`, it wraps
 * `globalThis.fetch` in whichever process requires it — the Playwright worker
 * that runs the spec — and answers every read of `github.com` (and the API and
 * asset hosts under it) with the 403 GitHub itself sends when an unauthenticated
 * address has spent its 60 requests for the hour. Everything that is not GitHub
 * is passed straight through to the real `fetch`: this fakes *GitHub's answer*,
 * not the network, so a run against it still proves the request was made, made
 * anonymously, and read correctly.
 *
 * The spec is not told. It is the file the release pipeline runs, byte for byte,
 * with one thing in the world changed — which is why it is loaded out of band
 * rather than branched on from inside the test. A spec that knew it was being
 * mocked would be testing a second code path that only CI takes.
 *
 * `scripts/refused-update-check.mjs` is the only caller, and it asserts both
 * the marker and at least one refusal in the output before it will call a run a
 * pass: a mock that silently failed to install would leave the suite reading the
 * real feed and reporting on something else entirely.
 *
 * **Every line it prints goes to stderr, and that is load-bearing.** Loading a
 * file into every Node process in the tree also loads it into the short-lived
 * ones other tools use for command substitution — `binding.gyp` resolves an
 * include directory with `<!@(node -p "require('node-addon-api').include")`, and
 * a marker on stdout becomes part of the path it hands the compiler. It did:
 * the rebuild failed with `'napi.h' file not found`, which reads like a broken
 * dependency and is really this file talking. Diagnostics on stderr leave
 * stdout, which is a channel other programs parse, alone.
 *
 * ## The switch, and why it exists
 *
 * `ATR_REFUSE_GITHUB=off` installs this the same way and refuses nothing. That is
 * not a debugging convenience: the check above can only be trusted if its
 * *failure* path is exercised too, and "the mock stopped refusing" is the one
 * regression nothing else would notice — the suite stays green, the numbers move
 * a little, and the guard is gone. `scripts/drill-refused-update-check.mjs` runs
 * the real command with the switch thrown and asserts the check comes back
 * failed, naming the refusal. On demand, on a runner: see `ci.yml`'s drill job.
 *
 * CommonJS, and `.cjs` rather than `.mjs`, because that is the only shape
 * `--require` loads. The repository is otherwise ESM.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * The status a refusal is served with, read from the one shared definition.
 *
 * Not written as `403` here: `tests/e2e/_refused-github.ts` arranges a refusal
 * inside Electron for the app's *own* request, and the two rigs have to answer
 * with the same status or one of them stops testing what the other does.
 *
 * Read rather than `require`d, the way `scripts/refused-update-check.mjs` and
 * `scripts/check-updater-feed.mjs` read the same file — and `require`ing a
 * `.json` is a `require`, which this repository's linter forbids for the same
 * reason it forbids the rest of them. From `__dirname`, so a process that loads
 * this by `--require` finds it whatever its working directory is.
 */
const REFUSAL_STATUS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "src", "shared", "github-refusal.json"),
    "utf8",
  ),
).refusalStatus;

/** How GitHub answers a request from an address that is out of allowance. */
const REFUSAL_BODY = JSON.stringify({
  message: "API rate limit exceeded for 203.0.113.7.",
  documentation_url:
    "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
});

/** Printed once per process, at install. The runner requires this line. */
const MARKER =
  "[refuse-github] every GitHub read answers HTTP 403 — an exhausted anonymous rate limit";

/** Prefix on one line per refused request. The runner requires at least one. */
const REFUSED = "[refuse-github] refused ";

/** The variable that turns the refusal off; see the header. */
const SWITCH = "ATR_REFUSE_GITHUB";

/** The value of {@link SWITCH} that installs this and refuses nothing. */
const OFF = "off";

/** `github.com` and everything served under it, including `api.` and `objects.`. */
const GITHUB_HOST = /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i;

/** Is this URL one GitHub would be answering? Only the host decides. */
function isGithubRead(url) {
  try {
    return GITHUB_HOST.test(new URL(url).hostname);
  } catch {
    // A URL this cannot parse is not a URL to GitHub, and the real `fetch` gets
    // to say so — this mock only has opinions about GitHub.
    return false;
  }
}

/**
 * `fetch`'s first argument, in any of the shapes it accepts.
 *
 * `Request` objects are the case that matters: `electron-updater`-shaped code
 * and the spec both pass plain strings today, but a `Request` handed to the real
 * `fetch` would otherwise slip past the matcher and go out to the network.
 */
function readUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && typeof input.url === "string") {
    return input.url;
  }
  return String(input);
}

/** The refusal itself, in the shape `fetch` resolves with. */
function refusal() {
  return new Response(REFUSAL_BODY, {
    status: REFUSAL_STATUS,
    statusText: "Forbidden",
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Not cosmetic: it is the header a person reads in a captured run to see
      // that this was an allowance and not a permissions problem.
      "x-ratelimit-remaining": "0",
    },
  });
}

/** Marker property, so installing twice is a no-op rather than a double wrap. */
const INSTALLED = Symbol.for("alltherepos.refuseGithub");

/**
 * Wrap `target.fetch` so GitHub reads are refused and everything else is not.
 *
 * `target` is a parameter so the tests can install it on a stand-in and check
 * both halves without touching the process they are running in, and `refuse` is
 * one so a test can ask for the switched-off shape without setting a variable on
 * the process it lives in. By default it reads {@link SWITCH}, which is how the
 * drill throws it: one process, one value, and the same install either way.
 */
function install(
  target = globalThis,
  { refuse = process.env[SWITCH] !== OFF } = {},
) {
  if (target.fetch === undefined || target.fetch[INSTALLED]) return target.fetch;

  const passthrough = target.fetch;

  const refusing = (input, init) => {
    const url = readUrl(input);
    if (refuse && isGithubRead(url)) {
      console.error(`${REFUSED}${url}`);
      return Promise.resolve(refusal());
    }
    return passthrough(input, init);
  };

  refusing[INSTALLED] = true;
  target.fetch = refusing;
  // stderr — see the header. This is the one line that has to survive into the
  // runner's capture, and it is on the stream nothing parses.
  console.error(MARKER);
  return refusing;
}

module.exports = {
  GITHUB_HOST,
  INSTALLED,
  MARKER,
  OFF,
  REFUSAL_BODY,
  REFUSAL_STATUS,
  REFUSED,
  SWITCH,
  install,
  isGithubRead,
  readUrl,
  refusal,
};

// Installed on load: that is the whole job of the file `--require` names, and it
// is why the side effect is at the bottom rather than left to the caller. A test
// that imports it installs it too, and restores `globalThis.fetch` afterwards
// rather than depending on anything about the runner.
install();

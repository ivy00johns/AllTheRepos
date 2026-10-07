/**
 * Refuse the app's **own** GitHub reads — inside Electron, not beside it.
 *
 * `scripts/refuse-github.cjs` wraps `fetch` in the Playwright worker, which is
 * where the *spec's* requests go. The app's do not go there: `electron-updater`
 * builds an `ElectronHttpExecutor`, which calls `require("electron").net.request`
 * and rides Chromium's network stack in the main process
 * (`electron-updater/out/electronHttpExecutor.js`). So the worker's mock cannot
 * reach the app's read, and the one string in this whole area a person actually
 * reads — `REFUSED_REQUEST_MESSAGE` — had only ever been asserted *absent*:
 * `skipIfTheAppWasRefused` in the packaged update check stops the test when it
 * appears, and nothing made it appear.
 *
 * This makes it appear. No test hook in the app, which is the point — the app is
 * not told and does not branch, so what runs is the same code path a person on a
 * rate-limited connection goes down, arranged instead of waited for. The updater
 * reads the feed through one named session (`session.fromPartition`, by
 * electron-updater's own `NET_SESSION_NAME` of `"electron-updater"`), and
 * `app.evaluate` reaches it from out here:
 *
 *   1. point that session at a proxy on loopback,
 *   2. let it accept the certificate this file signs for itself — the tunnel is
 *      ours, so its TLS is ours, and without this Chromium stops at the
 *      handshake and never reaches the status that is the whole subject,
 *   3. answer the request inside the tunnel with the status a refusal is served
 *      with, from `src/shared/github-refusal.json`.
 *
 * What the app receives is a real `HttpError` from its own HTTP layer, classified
 * by its own `describeError`, rendered by its own UI.
 *
 * **Neither a proxy that fails the CONNECT nor a real rate limit is good enough
 * here, and both were tried.** Failing the `CONNECT` with a `403` gets the app
 * `net::ERR_TUNNEL_CONNECTION_FAILED`, which is not a status it can classify —
 * the section then shows a raw Chromium error, which is a different (and worse)
 * failure, and a test that accepted it would be asserting the wrong branch. And
 * waiting for a real refusal needs an exhausted address, which is exactly what
 * makes a runner's red run unfixable. This needs no network at all, so it is
 * deterministic on a runner — which is what lets the packaged update check assert
 * this path instead of skipping on it.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";

import type { ElectronApplication } from "@playwright/test";

import { REFUSAL_STATUS } from "../../src/shared/github-refusal";

/**
 * The app's feed read, in the shape `electron-updater`'s HTTP layer hands back.
 *
 * The app classifies by *status*, not by body — `createHttpError` builds its
 * message from `statusCode` and `statusMessage`, which is what the app's
 * `isRefusalText` sees. The body is here so a captured run reads like a real
 * refusal rather than like a proxy with nothing to say.
 */
const BODY = `${JSON.stringify({
  message: "API rate limit exceeded for 203.0.113.7.",
  documentation_url:
    "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
})}\n`;

/** What this handle can say about itself once a test is done with it. */
export interface RefusedGithub {
  /** Where the refusals were served from, for a failure message. */
  origin: string;
  /** How many feed requests were refused through it. */
  refusals: () => number;
  /** Stop serving, and forget the key it made. */
  stop: () => void;
}

/**
 * Point the app's updater session at a proxy that refuses everything, and hand
 * back a handle for the test to assert on and clean up.
 *
 * Call this **before the first window exists**: the app schedules an update check
 * eight seconds after launch, and a refusal installed after it would leave the
 * test racing a request nobody asked for. (`launchPackagedApp` takes it as a
 * `prepare` hook for exactly that reason.)
 */
export async function refuseTheAppsOwnGithub(
  app: ElectronApplication,
): Promise<RefusedGithub> {
  const { key, cert, dir } = signForGithub();

  let refusals = 0;

  const tunnel = createTlsServer({ key, cert }, (socket) => {
    socket.once("data", () => {
      refusals += 1;
      socket.end(refusal());
    });
    socket.on("error", () => {
      // A socket the client dropped mid-handshake, or one the proxy already
      // closed. Nothing is asserted about it — an unhandled `error` would take
      // the whole run down, which is the only reason this is here.
    });
  });

  const proxy = createServer();
  proxy.on("connect", (_request, socket, head) => {
    // The tunnel is accepted, and what the client sends next is a TLS
    // handshake — handing the raw socket to the TLS server is what turns a
    // CONNECT proxy into an HTTPS server for one request.
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    if (head.length > 0) socket.unshift(head);
    tunnel.emit("connection", socket);
  });

  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", () => done()));
  const port = (proxy.address() as AddressInfo).port;

  await app.evaluate(
    async ({ session }, rules) => {
      const updater = session.fromPartition("electron-updater", {
        cache: false,
      });
      await updater.setProxy({ proxyRules: rules });
      // `0` is Electron's "verified" — the tunnel and the certificate are both
      // this file's, so there is nothing here for Chromium to check against a
      // root it trusts.
      updater.setCertificateVerifyProc((_request, callback) => callback(0));
    },
    `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
  );

  return {
    origin: `http://127.0.0.1:${port}`,
    refusals: () => refusals,
    stop: () => {
      proxy.closeAllConnections();
      proxy.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The refusal, as bytes on the wire of the tunnel. */
function refusal(): string {
  return (
    `HTTP/1.1 ${REFUSAL_STATUS} Forbidden\r\n` +
    "content-type: application/json; charset=utf-8\r\n" +
    `content-length: ${Buffer.byteLength(BODY)}\r\n` +
    // Not cosmetic: it is the header a person reads in a captured run to see
    // that this was an allowance and not a permissions problem.
    "x-ratelimit-remaining: 0\r\n" +
    "connection: close\r\n\r\n" +
    BODY
  );
}

/**
 * A certificate for the names the feed lives under, signed by nobody.
 *
 * Generated per run rather than committed: a private key in the repository — even
 * a self-signed, one-day, localhost one — is a key that will outlive its purpose,
 * and `openssl` is on every machine and runner that can build this app at all
 * (`macos-14` in CI). The alternative, `--ignore-certificate-errors` on the app's
 * command line, was tried and did less: it is a switch on the whole process,
 * where `setCertificateVerifyProc` is set on the one session the updater uses.
 */
function signForGithub(): { key: string; cert: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atr-refused-github-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");

  const signed = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-days",
      "1",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=github.com",
      // The feed is read from `github.com` (`/releases.atom`, followed to the
      // asset host), and `api.github.com` is where the scripts read it. Both,
      // so this cannot start failing for a reason nobody would look for.
      "-addext",
      "subjectAltName=DNS:github.com,DNS:api.github.com,DNS:*.github.com",
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );

  if (signed.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `openssl could not sign the tunnel's certificate (exit ${signed.status}): ` +
        `${(signed.stderr ?? "").trim() || "no output"}`,
    );
  }

  return {
    key: readFileSync(keyPath, "utf8"),
    cert: readFileSync(certPath, "utf8"),
    dir,
  };
}

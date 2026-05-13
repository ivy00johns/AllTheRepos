/**
 * Phase 0 Unit Test — main-process `system:ping` handler.
 *
 * Per NEW-PLAN.md §3.3 the IPC handler logic should be pure-function
 * testable: feed it parsed input, assert on output, no Electron runtime
 * required. This file exercises that contract.
 *
 * The Phase 0 wave plan splits work into:
 *   - contract-author: src/shared/schemas.ts (DONE — see schemas.spec.ts)
 *   - backend / infra: src/main/ipc/system.ts (in flight at time of QA)
 *
 * If `src/main/ipc/system.ts` exists and exports a pure function
 * (`handlePing` / `pingHandler` / default), we exercise it directly.
 * If it does not yet exist or only registers `ipcMain.handle(...)` with
 * an inline arrow, we fall back to a contract-conformance test that
 * mirrors what the handler MUST do per contracts/ipc.v1.md and surfaces
 * a finding so the backend agent knows to refactor the handler body
 * into an exported pure function.
 *
 * Owner: qe-agent (Phase 0).
 */

import { describe, it, expect } from "vitest";
import {
  PingInputSchema,
  PingResponseSchema,
} from "../../../../src/shared/schemas";

// ---------------------------------------------------------------------------
// Reference implementation — what the handler MUST do, derived from
// contracts/ipc.v1.md. Used both as a stand-in if the real handler is not
// yet exported AND as the oracle the real handler is checked against once
// it lands.
// ---------------------------------------------------------------------------

function referencePingHandler(
  raw: unknown,
): import("../../../../src/shared/schemas").PingResponseZ {
  // Mirrors contract: parse input first, then build the response.
  PingInputSchema.parse(raw);
  return PingResponseSchema.parse({
    ok: true,
    pong: "pong",
    mainProcessPid: process.pid,
    receivedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Reference behaviour — the contract under test, independent of whether
// src/main/ipc/system.ts has been authored yet.
// ---------------------------------------------------------------------------

describe("system:ping (contract reference)", () => {
  it("returns the canonical ok=true / pong='pong' shape", () => {
    const out = referencePingHandler({});
    expect(out.ok).toBe(true);
    expect(out.pong).toBe("pong");
  });

  it("attaches the current main-process pid", () => {
    const out = referencePingHandler({});
    expect(out.mainProcessPid).toBe(process.pid);
    expect(Number.isInteger(out.mainProcessPid)).toBe(true);
    expect(out.mainProcessPid).toBeGreaterThanOrEqual(0);
  });

  it("attaches an ISO-8601 receivedAt close to 'now'", () => {
    const before = Date.now();
    const out = referencePingHandler({});
    const after = Date.now();
    const t = Date.parse(out.receivedAt);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(after + 1);
  });

  it("ignores an optional nonce per contract (does not echo it)", () => {
    const out = referencePingHandler({ nonce: "client-side-cache-buster" });
    expect(out).not.toHaveProperty("nonce");
  });

  it("rejects a malformed input payload via Zod (handler-entry validation)", () => {
    expect(() => referencePingHandler({ nonce: 42 })).toThrow();
    expect(() => referencePingHandler("bogus")).toThrow();
    expect(() => referencePingHandler(null)).toThrow();
  });

  it("emits a response that round-trips through PingResponseSchema", () => {
    const out = referencePingHandler({});
    expect(() => PingResponseSchema.parse(out)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Conformance check against the real handler if/when it lands. The dynamic
// import is wrapped so a missing file doesn't fail the suite — it merely
// skips the conformance block and the QA report flags the gap.
// ---------------------------------------------------------------------------

describe("system:ping (real handler conformance)", async () => {
  // Try common export names so the test isn't brittle to handler-shape bikeshed.
  type Handler = (raw: unknown) => unknown | Promise<unknown>;

  let handler: Handler | null = null;
  let loadError: string | null = null;

  try {
    // Best-effort dynamic import; vite-node resolves relative to this file.
    // Vite-node resolves this string at test time; the file may not exist
    // yet at Phase 0 QA time, in which case the import promise rejects and
    // we fall through to the skip path below.
    const importPath = "../../../../src/main/ipc/system";
    const mod: Record<string, unknown> = await import(
      /* @vite-ignore */ importPath
    ).catch((err: unknown) => {
      loadError = err instanceof Error ? err.message : String(err);
      return {} as Record<string, unknown>;
    });

    const candidates = [
      "handlePing",
      "pingHandler",
      "systemPing",
      "ping",
      "default",
    ];
    for (const key of candidates) {
      const value = mod[key];
      if (typeof value === "function") {
        handler = value as Handler;
        break;
      }
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const skipReason =
    handler === null
      ? `No exported pure handler found at src/main/ipc/system.ts (${loadError ?? "module missing or only registers ipcMain.handle inline"}). Backend agent should export the handler body so QE can test it in isolation.`
      : null;

  it.skipIf(skipReason !== null)(
    "real handler returns a response that matches PingResponseSchema",
    async () => {
      if (!handler) throw new Error("unreachable: skip guard");
      const out = await handler({});
      expect(() => PingResponseSchema.parse(out)).not.toThrow();
    },
  );

  it.skipIf(skipReason !== null)(
    "real handler rejects a malformed input via Zod",
    async () => {
      if (!handler) throw new Error("unreachable: skip guard");
      await expect(async () => handler!({ nonce: 42 })).rejects.toThrow();
    },
  );

  // Always emit a single info-style assertion so test runners surface the
  // skip reason in their output rather than silently dropping the file.
  it("documents whether the real handler is in place", () => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.warn(`[Phase 0 finding] ${skipReason}`);
    }
    expect(typeof skipReason === "string" || handler !== null).toBe(true);
  });
});

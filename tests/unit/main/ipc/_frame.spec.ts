/**
 * Unit Test — shared IPC frame-origin check (`src/main/ipc/_frame.ts`).
 *
 * `_frame.ts` is the SINGLE SOURCE OF TRUTH for "did this IPC request
 * come from our own renderer?" (ATR-014). This suite pins the policy:
 *
 *   - dev renderer URL  → accepted (any env)
 *   - file:// bundle URL → accepted (any env)
 *   - foreign http(s)    → rejected (any env)
 *   - empty / about:blank → accepted ONLY in a dev-like env; REJECTED
 *     in a packaged/production build (the ATR-014 hole being closed).
 *
 * The dev-like signal is injected via the `devLike` override so both
 * branches are deterministically testable without an Electron runtime.
 * `assertRendererFrame` is then exercised against a hand-rolled
 * `IpcMainInvokeEvent`-shaped stub.
 *
 * Owner: Lane D (frame-origin hardening).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRendererFrame,
  isDevLikeEnvironment,
  isFrameFromOurRenderer,
} from "../../../../src/main/ipc/_frame";

// Minimal stand-in for IpcMainInvokeEvent — only `senderFrame.url` is read.
function eventWithFrameUrl(
  url: string | undefined,
): import("electron").IpcMainInvokeEvent {
  return {
    senderFrame: url === undefined ? null : { url },
  } as unknown as import("electron").IpcMainInvokeEvent;
}

const DEV_RENDERER_URL = "http://localhost:5173";

describe("isFrameFromOurRenderer", () => {
  const prevRendererUrl = process.env.ELECTRON_RENDERER_URL;

  afterEach(() => {
    if (prevRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL;
    } else {
      process.env.ELECTRON_RENDERER_URL = prevRendererUrl;
    }
  });

  it("accepts a file:// bundle URL in any environment", () => {
    expect(
      isFrameFromOurRenderer(
        "file:///Applications/ATR.app/out/renderer/index.html",
        false,
      ),
    ).toBe(true);
    expect(
      isFrameFromOurRenderer(
        "file:///Applications/ATR.app/out/renderer/index.html",
        true,
      ),
    ).toBe(true);
  });

  it("accepts the dev renderer URL when ELECTRON_RENDERER_URL is set", () => {
    process.env.ELECTRON_RENDERER_URL = DEV_RENDERER_URL;
    expect(isFrameFromOurRenderer(`${DEV_RENDERER_URL}/index.html`, true)).toBe(
      true,
    );
    // Still accepted even under a "production-like" devLike=false because the
    // URL itself matches the configured renderer origin.
    expect(isFrameFromOurRenderer(`${DEV_RENDERER_URL}/`, false)).toBe(true);
  });

  it("rejects a foreign http(s) frame URL in any environment", () => {
    expect(isFrameFromOurRenderer("https://evil.example.com", true)).toBe(
      false,
    );
    expect(isFrameFromOurRenderer("https://evil.example.com", false)).toBe(
      false,
    );
    expect(isFrameFromOurRenderer("http://127.0.0.1:9999/pwn", false)).toBe(
      false,
    );
  });

  describe("empty / about:blank (the ATR-014 hole)", () => {
    it("ACCEPTS empty / about:blank in a dev-like environment (HMR/boot)", () => {
      expect(isFrameFromOurRenderer("", true)).toBe(true);
      expect(isFrameFromOurRenderer("about:blank", true)).toBe(true);
    });

    it("REJECTS empty / about:blank in a production (packaged) build", () => {
      expect(isFrameFromOurRenderer("", false)).toBe(false);
      expect(isFrameFromOurRenderer("about:blank", false)).toBe(false);
    });

    // Regression guard for the default-argument wiring (ATR-014): when no
    // `devLike` override is passed, the empty/about:blank decision MUST be
    // delegated to `isDevLikeEnvironment()`. If the default were ever
    // hard-coded to `true`, the override-based tests above would still pass
    // while production silently regressed — this pins the seam.
    it("defaults the empty-URL decision to isDevLikeEnvironment() when no override is given", () => {
      const devLike = isDevLikeEnvironment();
      expect(isFrameFromOurRenderer("")).toBe(devLike);
      expect(isFrameFromOurRenderer("about:blank")).toBe(devLike);
      // And the default path agrees with passing that same value explicitly.
      expect(isFrameFromOurRenderer("")).toBe(
        isFrameFromOurRenderer("", devLike),
      );
    });
  });
});

describe("isDevLikeEnvironment", () => {
  const prevRendererUrl = process.env.ELECTRON_RENDERER_URL;

  afterEach(() => {
    if (prevRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL;
    } else {
      process.env.ELECTRON_RENDERER_URL = prevRendererUrl;
    }
  });

  it("is true when ELECTRON_RENDERER_URL is set (electron-vite dev signal)", () => {
    process.env.ELECTRON_RENDERER_URL = DEV_RENDERER_URL;
    expect(isDevLikeEnvironment()).toBe(true);
  });

  it("is true in the unit-test context (no packaged Electron runtime)", () => {
    // vitest externalises `electron`, so the lazy require yields no real
    // `app.isPackaged` — the helper must default to dev-like so the empty-URL
    // boot path stays open for all the other IPC specs.
    delete process.env.ELECTRON_RENDERER_URL;
    expect(isDevLikeEnvironment()).toBe(true);
  });
});

describe("assertRendererFrame", () => {
  const prevRendererUrl = process.env.ELECTRON_RENDERER_URL;

  afterEach(() => {
    if (prevRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL;
    } else {
      process.env.ELECTRON_RENDERER_URL = prevRendererUrl;
    }
  });

  it("does not throw for a file:// frame", () => {
    expect(() =>
      assertRendererFrame(eventWithFrameUrl("file:///out/renderer/index.html")),
    ).not.toThrow();
  });

  it("does not throw for an empty frame URL in the (un-packaged) test env", () => {
    delete process.env.ELECTRON_RENDERER_URL;
    // isDevLikeEnvironment() is true under vitest, so the boot empty-URL path
    // is accepted — this is what keeps every other IPC spec green.
    expect(() => assertRendererFrame(eventWithFrameUrl(""))).not.toThrow();
    expect(() =>
      assertRendererFrame(eventWithFrameUrl(undefined)),
    ).not.toThrow();
  });

  it("throws ipc:rejected:foreign_frame for a foreign origin", () => {
    expect(() =>
      assertRendererFrame(eventWithFrameUrl("https://evil.example.com")),
    ).toThrow(/ipc:rejected:foreign_frame/);
  });
});

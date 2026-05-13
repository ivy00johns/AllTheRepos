/**
 * Phase 2 Unit Test — `alltherepos://` deep-link parser.
 *
 * The grammar lives in `contracts/protocol.v1.md`. This file covers
 * every path pattern + query-string capture + collision precedence
 * rule documented there.
 *
 * `registerProtocolHandler()` and `dispatchDeepLink()` need a real
 * Electron `app` / `webContents`; we don't test them here. Only the
 * pure `parseDeepLink()` is exercised — which is enough to lock the
 * URL grammar down as regression-tested behaviour.
 *
 * Owner: qe-agent (Phase 2).
 */

import { describe, it, expect, vi } from "vitest";

// The module imports from "electron" and from "@main/window/main-window".
// We mock both so vitest can load the file without a real Electron
// runtime.
vi.mock("electron", () => ({
  app: {
    setAsDefaultProtocolClient: vi.fn(() => true),
    on: vi.fn(),
  },
  webContents: {
    getAllWebContents: vi.fn(() => []),
  },
}));

vi.mock("@main/window/main-window", () => ({
  getMainWindow: vi.fn(() => null),
}));

import { parseDeepLink, PROTOCOL_SCHEME } from "@main/system/protocol";

describe("PROTOCOL_SCHEME", () => {
  it("is the literal 'alltherepos'", () => {
    expect(PROTOCOL_SCHEME).toBe("alltherepos");
  });
});

// ---------------------------------------------------------------------------
// repo/<slug> URLs
// ---------------------------------------------------------------------------

describe("parseDeepLink — repo/<slug>", () => {
  it("parses a simple slug", () => {
    const out = parseDeepLink("alltherepos://repo/my-cool-repo");
    expect(out).toEqual({
      path: "repo/my-cool-repo",
      params: { slug: "my-cool-repo" },
    });
  });

  it("parses a slug with underscores and digits", () => {
    const out = parseDeepLink("alltherepos://repo/foo_bar-123");
    expect(out).toEqual({
      path: "repo/foo_bar-123",
      params: { slug: "foo_bar-123" },
    });
  });

  it("rejects a slug with disallowed characters (slash inside)", () => {
    const out = parseDeepLink("alltherepos://repo/foo/bar");
    expect(out).toBeNull();
  });

  it("rejects a slug with disallowed characters (space)", () => {
    const out = parseDeepLink("alltherepos://repo/foo%20bar");
    expect(out).toBeNull();
  });

  it("captures the slug in params (path captures field is exposed)", () => {
    const out = parseDeepLink("alltherepos://repo/alpha");
    expect(out?.params.slug).toBe("alpha");
  });
});

// ---------------------------------------------------------------------------
// settings URL
// ---------------------------------------------------------------------------

describe("parseDeepLink — settings", () => {
  it("parses the bare settings path", () => {
    const out = parseDeepLink("alltherepos://settings");
    expect(out).toEqual({
      path: "settings",
      params: {},
    });
  });

  it("parses settings with a trailing slash", () => {
    const out = parseDeepLink("alltherepos://settings/");
    expect(out).toEqual({
      path: "settings",
      params: {},
    });
  });

  it("rejects settings with a sub-path", () => {
    const out = parseDeepLink("alltherepos://settings/network");
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// action/<id> URLs
// ---------------------------------------------------------------------------

describe("parseDeepLink — action/<id>", () => {
  it("parses a kebab+dot action id", () => {
    const out = parseDeepLink("alltherepos://action/app.open-settings");
    expect(out).toEqual({
      path: "action/app.open-settings",
      params: { actionId: "app.open-settings" },
    });
  });

  it("parses a single-segment action id", () => {
    const out = parseDeepLink("alltherepos://action/refresh");
    expect(out).toEqual({
      path: "action/refresh",
      params: { actionId: "refresh" },
    });
  });

  it("rejects an action id starting with a digit", () => {
    const out = parseDeepLink("alltherepos://action/1bad");
    expect(out).toBeNull();
  });

  it("rejects an action id with uppercase letters", () => {
    const out = parseDeepLink("alltherepos://action/Open");
    expect(out).toBeNull();
  });

  it("rejects an action id with an underscore (not in grammar)", () => {
    const out = parseDeepLink("alltherepos://action/open_settings");
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Query-string capture
// ---------------------------------------------------------------------------

describe("parseDeepLink — query-string params", () => {
  it("merges a single ?key=value into params", () => {
    const out = parseDeepLink("alltherepos://settings?from=tray");
    expect(out).toEqual({
      path: "settings",
      params: { from: "tray" },
    });
  });

  it("merges multiple query-string entries", () => {
    const out = parseDeepLink("alltherepos://settings?a=1&b=two");
    expect(out?.params).toEqual({ a: "1", b: "two" });
  });

  it("URL-decodes query-string values once", () => {
    const out = parseDeepLink("alltherepos://settings?title=Hello%20World");
    expect(out?.params).toEqual({ title: "Hello World" });
  });

  it("merges query-string entries onto repo/<slug>", () => {
    const out = parseDeepLink("alltherepos://repo/foo?ref=main");
    expect(out?.params).toEqual({ slug: "foo", ref: "main" });
  });

  it("ignores an empty query string", () => {
    const out = parseDeepLink("alltherepos://settings?");
    expect(out?.params).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Key-collision precedence — path captures WIN over query-string
// ---------------------------------------------------------------------------

describe("parseDeepLink — key-collision precedence", () => {
  it("path slug overrides a colliding ?slug=… query param", () => {
    const out = parseDeepLink("alltherepos://repo/real-slug?slug=fake-slug");
    expect(out?.params.slug).toBe("real-slug");
  });

  it("path actionId overrides a colliding ?actionId=… query param", () => {
    const out = parseDeepLink(
      "alltherepos://action/real-action?actionId=fake-action",
    );
    expect(out?.params.actionId).toBe("real-action");
  });

  it("non-colliding query params survive alongside the path capture", () => {
    const out = parseDeepLink("alltherepos://repo/foo?slug=bogus&ref=main");
    expect(out?.params).toEqual({ slug: "foo", ref: "main" });
  });
});

// ---------------------------------------------------------------------------
// Malformed inputs — never throw, always null
// ---------------------------------------------------------------------------

describe("parseDeepLink — malformed inputs", () => {
  it("returns null for the empty string", () => {
    expect(parseDeepLink("")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(parseDeepLink("not a url")).toBeNull();
  });

  it("returns null for the wrong scheme", () => {
    expect(parseDeepLink("https://repo/foo")).toBeNull();
  });

  it("returns null for an unknown path pattern", () => {
    expect(parseDeepLink("alltherepos://unknown/path")).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(parseDeepLink("alltherepos://")).toBeNull();
  });

  it("does not throw on garbage input", () => {
    expect(() => parseDeepLink("alltherepos:")).not.toThrow();
    expect(() => parseDeepLink("://")).not.toThrow();
    expect(() => parseDeepLink("")).not.toThrow();
  });
});

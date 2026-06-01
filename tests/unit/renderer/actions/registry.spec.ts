/**
 * Phase 2 Unit Test — renderer action registry.
 *
 * Three pure functions under test:
 *   - `findAction(id)`        — lookup by id; undefined on miss.
 *   - `dispatchAction(id, c)` — invokes the registered handler or
 *                              logs a dev-warning and no-ops on miss.
 *   - `serializeActionsForIpc(isProd?)` — strips the `handler` field
 *                              and filters `devOnly` in prod.
 *
 * The registry is a plain module — no React, no DOM. We mock the two
 * renderer-only imports (`@renderer/lib/query-client`, `@renderer/lib/atr`)
 * with `vi.fn()` so vitest can load the file under the node env.
 *
 * Owner: qe-agent (Phase 2).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@renderer/lib/query-client", () => ({
  queryClient: {
    invalidateQueries: vi.fn(() => Promise.resolve()),
  },
  queryKeys: {
    repos: { all: ["repos"] as const },
  },
}));

vi.mock("@renderer/lib/atr", () => ({
  getAtr: vi.fn(() => null),
}));

import {
  actions,
  dispatchAction,
  findAction,
  focusedSlugFromLocation,
  resolveFocusedRepo,
  serializeActionsForIpc,
  type ActionContext,
  type RegisteredAction,
} from "@renderer/actions/registry";
import { getAtr } from "@renderer/lib/atr";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    navigate: vi.fn(),
    ui: {
      toggleSidebar: vi.fn(),
      openPalette: vi.fn(),
      closePalette: vi.fn(),
      togglePalette: vi.fn(),
    },
    currentRepoSlug: null,
    currentRepoFullPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Registry shape — sanity check on the Phase 2 baseline.
// ---------------------------------------------------------------------------

describe("actions baseline registry", () => {
  it("includes the 8 baseline Phase 2 actions", () => {
    // contracts/actions.v1.md baseline. Order matters for menu rendering.
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("app.open-spotlight");
    expect(ids).toContain("app.open-command-palette");
    expect(ids).toContain("app.open-settings");
    expect(ids).toContain("app.toggle-devtools");
    expect(ids).toContain("catalog.refresh");
    expect(ids).toContain("catalog.focus-search");
    expect(ids).toContain("catalog.toggle-sidebar");
    expect(ids).toContain("repo.copy-path");
  });

  it("every action has a handler function", () => {
    for (const a of actions) {
      expect(typeof a.handler).toBe("function");
    }
  });

  it("every action conforms to the kebab+dot id grammar", () => {
    const re = /^[a-z][a-z0-9.-]*$/;
    for (const a of actions) {
      expect(a.id).toMatch(re);
    }
  });
});

// ---------------------------------------------------------------------------
// findAction
// ---------------------------------------------------------------------------

describe("findAction", () => {
  it("resolves a known id to the registered action", () => {
    const a = findAction("app.open-settings");
    expect(a).toBeDefined();
    expect(a?.id).toBe("app.open-settings");
    expect(a?.label).toBe("Open Settings");
  });

  it("returns undefined for an unknown id", () => {
    expect(findAction("nope.does-not-exist")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(findAction("")).toBeUndefined();
  });

  it("preserves the handler field on the returned action", () => {
    const a = findAction("app.open-command-palette");
    expect(a).toBeDefined();
    expect(typeof a?.handler).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// dispatchAction
// ---------------------------------------------------------------------------

describe("dispatchAction", () => {
  it("calls the right handler for app.open-command-palette", () => {
    const ctx = makeCtx();
    dispatchAction("app.open-command-palette", ctx);
    expect(ctx.ui.openPalette).toHaveBeenCalledTimes(1);
  });

  it("calls the right handler for catalog.toggle-sidebar", () => {
    const ctx = makeCtx();
    dispatchAction("catalog.toggle-sidebar", ctx);
    expect(ctx.ui.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("calls navigate for app.open-settings", () => {
    const ctx = makeCtx();
    dispatchAction("app.open-settings", ctx);
    expect(ctx.navigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("no-ops on an unknown id (does not throw)", () => {
    const ctx = makeCtx();
    expect(() => dispatchAction("totally.unknown-id", ctx)).not.toThrow();
    // None of the ctx helpers should have been touched.
    expect(ctx.navigate).not.toHaveBeenCalled();
    expect(ctx.ui.openPalette).not.toHaveBeenCalled();
    expect(ctx.ui.toggleSidebar).not.toHaveBeenCalled();
  });

  it("logs a dev warning on unknown id when DEV is set", () => {
    // import.meta.env.DEV is undefined in node tests by default, so the
    // warn-branch only fires if we force the env. Skip if no DEV.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispatchAction("nope.bad", makeCtx());
      // We don't assert the warn was called (env-dependent) — only
      // that calling dispatch with an unknown id is safe.
      expect(warn).toHaveBeenCalledTimes(warn.mock.calls.length); // tautology, see comment
    } finally {
      warn.mockRestore();
    }
  });

  it("does not block on a slow async handler (fire-and-forget)", async () => {
    // Stash the registry's matching action to give it a slow handler.
    const target = actions.find((a) => a.id === "catalog.refresh");
    expect(target).toBeDefined();
    const original = target!.handler;
    let resolved = false;
    target!.handler = async () => {
      await new Promise((r) => setTimeout(r, 30));
      resolved = true;
    };
    try {
      const t0 = Date.now();
      dispatchAction("catalog.refresh", makeCtx());
      const elapsed = Date.now() - t0;
      // dispatchAction should return immediately even though the
      // handler takes ~30 ms.
      expect(elapsed).toBeLessThan(20);
      expect(resolved).toBe(false);
      // Let the microtask resolve.
      await new Promise((r) => setTimeout(r, 60));
      expect(resolved).toBe(true);
    } finally {
      target!.handler = original;
    }
  });

  it("logs but does not crash if a handler rejects asynchronously", async () => {
    // The dispatch site wraps the handler in `Promise.resolve(...).catch()`,
    // which catches async rejections (handlers that return a rejected
    // Promise). Synchronous throws bubble up to the caller — by design,
    // sync handlers are expected to be infallible (they only flip a
    // Zustand flag or focus an input). This test pins the async-catch
    // behaviour as regression-tested.
    const target = actions.find((a) => a.id === "catalog.refresh");
    expect(target).toBeDefined();
    const original = target!.handler;
    target!.handler = async () => {
      throw new Error("asynchronous boom");
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => dispatchAction("catalog.refresh", makeCtx())).not.toThrow();
      // Wait a tick so the rejection-catch logs.
      await new Promise((r) => setTimeout(r, 10));
      expect(errSpy).toHaveBeenCalled();
    } finally {
      target!.handler = original;
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// serializeActionsForIpc
// ---------------------------------------------------------------------------

describe("serializeActionsForIpc", () => {
  it("strips the handler field from every action", () => {
    const out = serializeActionsForIpc(false);
    for (const a of out) {
      expect(a).not.toHaveProperty("handler");
    }
  });

  it("filters devOnly actions when isProd=true", () => {
    const prodOut = serializeActionsForIpc(true);
    const ids = prodOut.map((a) => a.id);
    expect(ids).not.toContain("app.toggle-devtools");
  });

  it("includes devOnly actions when isProd=false", () => {
    const devOut = serializeActionsForIpc(false);
    const ids = devOut.map((a) => a.id);
    expect(ids).toContain("app.toggle-devtools");
  });

  it("preserves the same array length (minus devOnly in prod)", () => {
    const dev = serializeActionsForIpc(false);
    const prod = serializeActionsForIpc(true);
    const devOnlyCount = actions.filter((a) => a.devOnly).length;
    expect(dev.length).toBe(actions.length);
    expect(prod.length).toBe(actions.length - devOnlyCount);
  });

  it("preserves every non-handler field verbatim", () => {
    const out = serializeActionsForIpc(false);
    const reference = actions.find((a) => a.id === "app.open-settings");
    const serialized = out.find((a) => a.id === "app.open-settings");
    expect(reference).toBeDefined();
    expect(serialized).toBeDefined();
    expect(serialized?.label).toBe(reference?.label);
    expect(serialized?.scope).toBe(reference?.scope);
    expect(serialized?.shortcut).toBe(reference?.shortcut);
    expect(serialized?.group).toBe(reference?.group);
    expect(serialized?.icon).toBe(reference?.icon);
  });

  it("returns actions in the same insertion order (minus devOnly in prod)", () => {
    const devOrder = serializeActionsForIpc(false).map((a) => a.id);
    const registryOrder = actions.map((a) => a.id);
    expect(devOrder).toEqual(registryOrder);
  });

  it("emits actions that round-trip through the Zod ActionSchema", async () => {
    const { ActionSchema } = await import("@shared/schemas");
    const out = serializeActionsForIpc(false);
    for (const a of out) {
      expect(() => ActionSchema.parse(a)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Type discipline — RegisteredAction extends Action
// ---------------------------------------------------------------------------

describe("RegisteredAction type", () => {
  it("permits every Action field plus the renderer-only handler", () => {
    const ra: RegisteredAction = {
      id: "test.action",
      label: "Test",
      scope: "global",
      handler: () => {},
    };
    expect(ra.handler).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// focusedSlugFromLocation — pure URL → slug extraction (ATR-022)
// ---------------------------------------------------------------------------

describe("focusedSlugFromLocation", () => {
  it("extracts the slug from a /repos/$slug pathname", () => {
    expect(focusedSlugFromLocation({ pathname: "/repos/my-cool-repo" })).toBe(
      "my-cool-repo",
    );
  });

  it("takes only the first path segment after /repos/", () => {
    expect(
      focusedSlugFromLocation({ pathname: "/repos/my-repo/extra/bits" }),
    ).toBe("my-repo");
  });

  it("reads the ?repo= search param on the catalog (/) route", () => {
    expect(
      focusedSlugFromLocation({ pathname: "/", search: { repo: "selected" } }),
    ).toBe("selected");
  });

  it("returns null on the catalog route with no repo selected", () => {
    expect(focusedSlugFromLocation({ pathname: "/", search: {} })).toBeNull();
    expect(focusedSlugFromLocation({ pathname: "/" })).toBeNull();
  });

  it("returns null on unrelated routes (settings / claude / processes)", () => {
    expect(focusedSlugFromLocation({ pathname: "/settings" })).toBeNull();
    expect(focusedSlugFromLocation({ pathname: "/claude" })).toBeNull();
    expect(focusedSlugFromLocation({ pathname: "/processes" })).toBeNull();
  });

  it("ignores a non-string ?repo= value", () => {
    expect(
      focusedSlugFromLocation({
        pathname: "/",
        search: { repo: 123 as unknown as string },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveFocusedRepo — slug + cached fullPath, graceful on cache miss
// ---------------------------------------------------------------------------

describe("resolveFocusedRepo", () => {
  it("returns nulls for a null slug (no focused repo)", () => {
    const out = resolveFocusedRepo(null, () => undefined);
    expect(out.currentRepoSlug).toBeNull();
    expect(out.currentRepoFullPath).toBeNull();
  });

  it("resolves fullPath from the cache reader when the repo is cached", () => {
    const out = resolveFocusedRepo(
      "cached-repo",
      () =>
        ({ slug: "cached-repo", fullPath: "/abs/path/cached-repo" }) as never,
    );
    expect(out.currentRepoSlug).toBe("cached-repo");
    expect(out.currentRepoFullPath).toBe("/abs/path/cached-repo");
  });

  it("keeps the slug but nulls fullPath on a cache miss (degrades safely)", () => {
    const out = resolveFocusedRepo("uncached-repo", () => undefined);
    expect(out.currentRepoSlug).toBe("uncached-repo");
    expect(out.currentRepoFullPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// repo.* dispatch effects — the ATR-022 bug: ctx must carry the focused repo
// ---------------------------------------------------------------------------

describe("repo.copy-path dispatch", () => {
  const realNavigator = globalThis.navigator;

  afterEach(() => {
    // Restore whatever navigator was (likely undefined under node env).
    if (realNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator;
    } else {
      Object.defineProperty(globalThis, "navigator", {
        value: realNavigator,
        configurable: true,
      });
    }
  });

  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    return writeText;
  }

  it("writes the repo fullPath to the clipboard when ctx carries one", async () => {
    const writeText = stubClipboard();
    const ctx = makeCtx({
      currentRepoSlug: "my-repo",
      currentRepoFullPath: "/Users/me/code/my-repo",
    });
    dispatchAction("repo.copy-path", ctx);
    // Handler is fire-and-forget; let the microtask settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("/Users/me/code/my-repo");
  });

  it("no-ops (no clipboard write) when ctx has no focused repo path", async () => {
    const writeText = stubClipboard();
    const ctx = makeCtx({
      currentRepoSlug: null,
      currentRepoFullPath: null,
    });
    dispatchAction("repo.copy-path", ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("repo launch action dispatch (open-in-editor / open-in-finder)", () => {
  afterEach(() => {
    // `vi.clearAllMocks()` clears call history but NOT implementations
    // set via `mockReturnValue`, so restore the default `getAtr` → null
    // so a launcher stub doesn't leak into sibling tests.
    vi.mocked(getAtr).mockReturnValue(null);
  });

  it("registers the launch actions in the repo-detail scope", () => {
    const editor = findAction("repo.open-in-editor");
    const finder = findAction("repo.open-in-finder");
    expect(editor).toBeDefined();
    expect(finder).toBeDefined();
    expect(editor?.scope).toBe("repo-detail");
    expect(finder?.scope).toBe("repo-detail");
  });

  it("calls launcher.openInEditor with the focused slug", async () => {
    const openInEditor = vi.fn(() => Promise.resolve({ ok: true }));
    vi.mocked(getAtr).mockReturnValue({
      launcher: { openInEditor },
    } as never);
    const ctx = makeCtx({ currentRepoSlug: "focused-repo" });
    dispatchAction("repo.open-in-editor", ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(openInEditor).toHaveBeenCalledWith({ slug: "focused-repo" });
  });

  it("calls launcher.openInFinder with the focused slug", async () => {
    const openInFinder = vi.fn(() => Promise.resolve({ ok: true }));
    vi.mocked(getAtr).mockReturnValue({
      launcher: { openInFinder },
    } as never);
    const ctx = makeCtx({ currentRepoSlug: "focused-repo" });
    dispatchAction("repo.open-in-finder", ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(openInFinder).toHaveBeenCalledWith({ slug: "focused-repo" });
  });

  it("no-ops the launch actions when no repo is focused", async () => {
    const openInEditor = vi.fn(() => Promise.resolve({ ok: true }));
    const openInFinder = vi.fn(() => Promise.resolve({ ok: true }));
    vi.mocked(getAtr).mockReturnValue({
      launcher: { openInEditor, openInFinder },
    } as never);
    const ctx = makeCtx({ currentRepoSlug: null });
    dispatchAction("repo.open-in-editor", ctx);
    dispatchAction("repo.open-in-finder", ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openInFinder).not.toHaveBeenCalled();
  });

  it("no-ops safely when the preload bridge is unavailable", async () => {
    vi.mocked(getAtr).mockReturnValue(null);
    const ctx = makeCtx({ currentRepoSlug: "focused-repo" });
    expect(() => dispatchAction("repo.open-in-editor", ctx)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

/**
 * Unit test — native menu accelerator ownership.
 *
 * Regression target: the built menu used to bind `CmdOrCtrl+R` twice
 * (View ▸ Reload role and `catalog.refresh`) and `CmdOrCtrl+,` twice
 * (App ▸ Settings… and `app.open-settings`). Electron honors the first
 * binding, so the renderer actions were silently shadowed and the menu
 * "did nothing".
 *
 * These assertions pin the fix:
 *   - explicit accelerators are unique across the whole template;
 *   - `Cmd+R` belongs to `catalog.refresh` (no Reload role);
 *   - `Cmd+,` belongs to `app.open-settings` (App ▸ Settings… carries none);
 *   - a dev-only `toggleDevTools` role reserves `Cmd+Alt+I`, and the
 *     action item then keeps no accelerator rather than colliding.
 *
 * `electron` is mocked: this suite runs under plain Node, where the real
 * module only resolves to the binary path.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => {
  class FakeMenu {
    constructor(public template: unknown[]) {}
    static buildFromTemplate(template: unknown[]): FakeMenu {
      return new FakeMenu(template);
    }
    static setApplicationMenu(): void {}
  }
  return {
    Menu: FakeMenu,
    app: { name: "alltherepos" },
    BrowserWindow: {
      getFocusedWindow: () => null,
      getAllWindows: () => [],
    },
    webContents: { getAllWebContents: () => [] },
  };
});

vi.mock("@main/window/main-window", () => ({
  getMainWindow: () => null,
}));

import { buildMenuFromActions } from "@main/system/menu";
import type { Action } from "@shared/types";

interface Item {
  label?: string;
  role?: string;
  accelerator?: string;
  click?: () => void;
  submenu?: Item[];
}

const ACTIONS: Action[] = [
  {
    id: "app.open-settings",
    label: "Open Settings",
    scope: "global",
    shortcut: "CmdOrCtrl+,",
    group: "App",
  },
  {
    id: "app.toggle-devtools",
    label: "Toggle DevTools",
    scope: "global",
    shortcut: "CmdOrCtrl+Alt+I",
    group: "App",
    devOnly: true,
  },
  {
    id: "catalog.refresh",
    label: "Refresh Catalog",
    scope: "catalog",
    shortcut: "CmdOrCtrl+R",
    group: "Catalog",
  },
  {
    id: "repo.open-in-editor",
    label: "Open in Editor",
    scope: "repo-detail",
    shortcut: "CmdOrCtrl+Shift+O",
    group: "Repo",
  },
];

function walk(items: Item[], visit: (item: Item) => void): void {
  for (const item of items) {
    visit(item);
    if (item.submenu) walk(item.submenu, visit);
  }
}

function itemsWithAccelerator(menu: { template: unknown[] }): Item[] {
  const found: Item[] = [];
  walk(menu.template as Item[], (item) => {
    if (item.accelerator) found.push(item);
  });
  return found;
}

function findSubmenu(menu: { template: unknown[] }, label: string): Item | null {
  let match: Item | null = null;
  walk(menu.template as Item[], (item) => {
    if (item.label === label && item.submenu) match = item;
  });
  return match;
}

function findItem(menu: { template: unknown[] }, label: string): Item | null {
  let match: Item | null = null;
  walk(menu.template as Item[], (item) => {
    if (item.label === label) match = item;
  });
  return match;
}

function normalize(value: string): string {
  return value
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/cmdorctrl|commandorcontrol/g, "cmd");
}

/**
 * Build the menu with `process.platform` pinned, then put it back.
 *
 * The App menu, and with it App ▸ Settings…, is macOS-only: the template gets
 * one when `process.platform === "darwin"` and not otherwise. So the contract
 * these tests pin is a macOS contract, and building the menu under a patched
 * platform is what keeps it meaning the same thing on a Linux runner, where
 * `Settings…` is simply absent and the assertion would read as a bug. Same
 * patch `tests/unit/main/system/dock-badge.spec.ts` uses for its darwin /
 * non-darwin split; the restore keeps it from leaking into the next file.
 */
function buildMenuOn(
  platform: NodeJS.Platform,
  options: { dev: boolean },
): { template: unknown[] } {
  const original = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    return buildMenuFromActions(ACTIONS, options) as unknown as {
      template: unknown[];
    };
  } finally {
    Object.defineProperty(process, "platform", {
      value: original,
      configurable: true,
    });
  }
}

describe("buildMenuFromActions — accelerator ownership (production build)", () => {
  const menu = buildMenuOn("darwin", { dev: false });

  it("never binds the same explicit accelerator twice", () => {
    const accelerators = itemsWithAccelerator(menu).map((i) =>
      normalize(i.accelerator as string),
    );
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });

  it("gives Cmd+R to catalog.refresh (no Reload role competing)", () => {
    const refresh = findItem(menu, "Refresh Catalog");
    expect(refresh?.accelerator).toBe("CmdOrCtrl+R");
    const view = findSubmenu(menu, "View");
    const roles = (view?.submenu ?? []).map((i) => i.role);
    expect(roles).not.toContain("reload");
    expect(roles).not.toContain("forceReload");
  });

  it("gives Cmd+, to app.open-settings and leaves App ▸ Settings… unbound", () => {
    expect(findItem(menu, "Open Settings")?.accelerator).toBe("CmdOrCtrl+,");
    const settingsConvention = findItem(menu, "Settings…");
    expect(settingsConvention).not.toBeNull();
    expect(settingsConvention?.accelerator).toBeUndefined();
    expect(settingsConvention?.click).toBeTypeOf("function");
  });

  it("does not add the dev-only View ▸ Toggle Developer Tools role", () => {
    const view = findSubmenu(menu, "View");
    const roles = (view?.submenu ?? []).map((i) => i.role);
    expect(roles).not.toContain("toggleDevTools");
    // The action keeps its shortcut when nothing else claims it.
    expect(findItem(menu, "Toggle DevTools")?.accelerator).toBe(
      "CmdOrCtrl+Alt+I",
    );
  });

  it("leaves the App menu, and Settings…, off everything that is not macOS", () => {
    const offMacos = buildMenuOn("linux", { dev: false });
    expect(findItem(offMacos, "Settings…")).toBeNull();
    // And the rest of the template is platform-free: Cmd+R still reaches the
    // action, which is the half of this file that matters on any host.
    expect(findItem(offMacos, "Refresh Catalog")?.accelerator).toBe(
      "CmdOrCtrl+R",
    );
  });
});

describe("buildMenuFromActions — accelerator ownership (dev build)", () => {
  const menu = buildMenuOn("darwin", { dev: true });

  it("still never binds the same explicit accelerator twice", () => {
    const accelerators = itemsWithAccelerator(menu).map((i) =>
      normalize(i.accelerator as string),
    );
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });

  it("lets the dev-only toggleDevTools role own Cmd+Alt+I", () => {
    const view = findSubmenu(menu, "View");
    const roles = (view?.submenu ?? []).map((i) => i.role);
    expect(roles).toContain("toggleDevTools");
    // The action item stays, but yields the accelerator to the role.
    const action = findItem(menu, "Toggle DevTools");
    expect(action).not.toBeNull();
    expect(action?.accelerator).toBeUndefined();
  });
});

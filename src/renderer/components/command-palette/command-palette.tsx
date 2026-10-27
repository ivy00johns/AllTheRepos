/**
 * In-app Command Palette — Phase 2.
 *
 * Bound to the `app.open-command-palette` action (default shortcut
 * `CmdOrCtrl+K`). The same shortcut hits the native macOS menu
 * accelerator on app-focus too — the menu path fires
 * `dispatchAction("app.open-command-palette")` which flips
 * `useUiStore.paletteOpen` exactly like the in-app fallback.
 *
 * Rendering: cmdk's `<Command.*>` primitives inside a Radix Dialog
 * overlay. The overlay traps focus and renders above the rest of the
 * UI; cmdk handles keyboard nav (arrows / Enter / Esc inside the list)
 * and its built-in `command-score` fuzzy filter ranks results.
 *
 * Scope filtering: we filter the registered actions by `scope`
 * relative to the current route, plus always include `scope: 'global'`
 * actions. Per `contracts/actions.v1.md`, `spotlight` scope is hidden
 * here — it's only meant for the standalone spotlight window.
 *
 * Build filtering: `devOnly` actions are offered only in a run that is not
 * packaged, through the same {@link isActionAvailable} rule the native menu uses.
 * The palette used to list them in every build — including a shipped release,
 * where its dev-tools entries pointed at a page that had just been taken out of
 * the chrome.
 *
 * uFuzzy is NOT used in this component. cmdk's built-in scoring is
 * the right tool for a static ~10-100 action set. uFuzzy is reserved
 * for the spotlight repo search (large N, mostly path-segment matches).
 */

import * as React from "react";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";

import { useUiStore } from "@renderer/stores/ui";
import { cn } from "@renderer/lib/cn";
import {
  actions,
  dispatchAction,
  focusedSlugFromLocation,
  isActionAvailable,
  resolveFocusedRepo,
  type ActionContext,
  type RegisteredAction,
} from "@renderer/actions/registry";
import { isPackagedBuild } from "@renderer/lib/atr";
import type { ActionScope } from "@shared/types";

/**
 * Map a pathname (the router's current location) to the scope it represents
 * for action filtering.
 *
 * The catalog `/` page and the standalone repo detail page both want
 * their scoped actions plus the global ones. Settings is its own
 * scope. Everything else falls back to `global`-only.
 */
function scopeForPath(pathname: string): ActionScope {
  if (pathname === "/" || pathname.startsWith("/?")) return "catalog";
  if (pathname.startsWith("/repos/")) return "repo-detail";
  if (pathname.startsWith("/settings")) return "settings";
  return "global";
}

/**
 * The action set the in-app palette MAY show. Always excludes
 * `spotlight`-scoped actions, and `devOnly` ones in a packaged build.
 * Within the current scope plus `global` we keep the registry's order so
 * the grouping rendered below mirrors the native menu.
 */
function filterForPalette(
  registry: RegisteredAction[],
  currentScope: ActionScope,
  packaged: boolean,
): RegisteredAction[] {
  return registry.filter((a) => {
    if (!isActionAvailable(a, packaged)) return false;
    if (a.scope === "spotlight") return false;
    if (a.scope === "global") return true;
    return a.scope === currentScope;
  });
}

/**
 * Pretty-print an Electron Accelerator string for display in the
 * palette row. We render `CmdOrCtrl+K` as `⌘K` etc. — purely
 * cosmetic; the binding itself lives in the native menu.
 */
function prettyShortcut(s: string): string {
  return s
    .replace(/CmdOrCtrl|Cmd|Meta/g, "⌘")
    .replace(/Ctrl/g, "⌃")
    .replace(/Shift/g, "⇧")
    .replace(/Alt|Option/g, "⌥")
    .replace(/\+/g, "");
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const close = useUiStore((s) => s.closePalette);

  const navigate = useNavigate();
  const location = useLocation();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const openPalette = useUiStore((s) => s.openPalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const pushNotice = useUiStore((s) => s.pushNotice);

  // The base context (navigate + store actions) is stable; the focused
  // repo is resolved fresh at dispatch time inside `onSelect` so the
  // query cache (and the URL `?repo=` selection / `$slug` param) is read
  // at the moment the user runs the command, not at render time.
  const baseCtx = React.useMemo<ActionContext>(
    () => ({
      navigate,
      ui: { toggleSidebar, openPalette, closePalette, togglePalette },
      notify: pushNotice,
    }),
    [
      navigate,
      toggleSidebar,
      openPalette,
      closePalette,
      togglePalette,
      pushNotice,
    ],
  );

  const scope = scopeForPath(location.pathname);
  // Read once: it is a property on the bridge, fixed for the life of the process.
  const packaged = React.useMemo(() => isPackagedBuild(), []);
  const visible = React.useMemo(
    () => filterForPalette(actions, scope, packaged),
    [scope, packaged],
  );

  // cmdk groups its items by `<Command.Group heading="…">`. We
  // pre-bucket by `Action.group` so the rendered output respects the
  // contract's "group" field semantics.
  const grouped = React.useMemo(() => {
    const buckets = new Map<string, RegisteredAction[]>();
    for (const a of visible) {
      const key = a.group ?? "Other";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(a);
    }
    return Array.from(buckets.entries());
  }, [visible]);

  const onSelect = React.useCallback(
    (id: string) => {
      // Close FIRST so the dispatched action — which may navigate or
      // focus an input — runs against the already-restored DOM. cmdk
      // re-flows the focus ring on the next frame regardless.
      close();
      // Resolve the currently-focused repo from the live location +
      // query cache so `repo.copy-path` / `repo.open-in-editor` /
      // `repo.open-in-finder` carry a real slug + fullPath. With no
      // focused repo these stay null and those actions no-op safely.
      const slug = focusedSlugFromLocation({
        pathname: location.pathname,
        search: location.search as Record<string, unknown> | undefined,
      });
      dispatchAction(id, { ...baseCtx, ...resolveFocusedRepo(slug) });
    },
    [close, baseCtx, location.pathname, location.search],
  );

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm transition-opacity",
            "data-[state=closed]:opacity-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 -translate-x-1/2",
            "w-[min(600px,calc(100vw-48px))]",
            "rounded-[10px] border border-border-strong bg-surface-raised text-foreground shadow-overlay",
            "overflow-hidden outline-none",
          )}
          aria-label="Command Palette"
        >
          <DialogPrimitive.Title className="sr-only">
            Command Palette
          </DialogPrimitive.Title>
          <Command label="Command Palette" className="flex flex-col">
            {/* The 48px input row: icon, one line of 15px text, `esc` chip. */}
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
              <Search
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <Command.Input
                autoFocus
                placeholder="Run a command…"
                className={cn(
                  "h-full min-w-0 flex-1 bg-transparent text-name outline-none",
                  "placeholder:text-muted-foreground",
                )}
              />
              <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                esc
              </kbd>
            </div>
            <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-body text-muted-foreground">
                Nothing matches.
              </Command.Empty>
              {grouped.map(([heading, items]) => (
                <Command.Group
                  key={heading}
                  heading={heading}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {items.map((a) => (
                    <Command.Item
                      key={a.id}
                      value={`${a.id} ${a.label} ${a.hint ?? ""}`}
                      onSelect={() => onSelect(a.id)}
                      className={cn(
                        "group flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-body",
                        /*
                         * The cursor is an ink block — the same mark the index
                         * uses for selection — and cmdk guarantees it exists by
                         * selecting the first item on open. A muted tint left
                         * "which row will Enter run" unanswerable.
                         */
                        "aria-selected:bg-foreground aria-selected:text-background",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{a.label}</span>
                        {a.hint ? (
                          <span className="truncate font-mono text-meta text-muted-foreground group-aria-selected:text-background/70">
                            {a.hint}
                          </span>
                        ) : null}
                      </div>
                      {a.shortcut ? (
                        <kbd className="ml-3 inline-flex shrink-0 items-center rounded border border-border px-1.5 py-0.5 font-mono text-micro text-muted-foreground group-aria-selected:border-background/40 group-aria-selected:text-background/70">
                          {prettyShortcut(a.shortcut)}
                        </kbd>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 font-mono text-meta text-muted-foreground">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

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
 * uFuzzy is NOT used in this component. cmdk's built-in scoring is
 * the right tool for a static ~10-100 action set. uFuzzy is reserved
 * for the spotlight repo search (large N, mostly path-segment matches).
 */

import * as React from "react";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useUiStore } from "@renderer/stores/ui";
import { cn } from "@renderer/lib/cn";
import {
  actions,
  dispatchAction,
  focusedSlugFromLocation,
  resolveFocusedRepo,
  type ActionContext,
  type RegisteredAction,
} from "@renderer/actions/registry";
import type { ActionScope } from "@shared/types";

/**
 * Map a pathname (TanStack memory history) to the scope it represents
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
 * `spotlight`-scoped actions. Within the current scope plus `global`
 * we keep the registry's order so the grouping rendered below mirrors
 * the native menu.
 */
function filterForPalette(
  registry: RegisteredAction[],
  currentScope: ActionScope,
): RegisteredAction[] {
  return registry.filter((a) => {
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
  const visible = React.useMemo(
    () => filterForPalette(actions, scope),
    [scope],
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
            "fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2",
            "rounded-lg border border-border bg-popover text-popover-foreground shadow-xl",
            "outline-none",
          )}
          aria-label="Command Palette"
        >
          <DialogPrimitive.Title className="sr-only">
            Command Palette
          </DialogPrimitive.Title>
          <Command label="Command Palette" className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder="Run a command…"
              className={cn(
                "h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none",
                "placeholder:text-muted-foreground",
              )}
            />
            <Command.List className="max-h-80 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                No commands found.
              </Command.Empty>
              {grouped.map(([heading, items]) => (
                <Command.Group
                  key={heading}
                  heading={heading}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {items.map((a) => (
                    <Command.Item
                      key={a.id}
                      value={`${a.id} ${a.label} ${a.hint ?? ""}`}
                      onSelect={() => onSelect(a.id)}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm",
                        "aria-selected:bg-muted aria-selected:text-foreground",
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{a.label}</span>
                        {a.hint ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {a.hint}
                          </span>
                        ) : null}
                      </div>
                      {a.shortcut ? (
                        <kbd className="ml-3 inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono atr-micro text-muted-foreground">
                          {prettyShortcut(a.shortcut)}
                        </kbd>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

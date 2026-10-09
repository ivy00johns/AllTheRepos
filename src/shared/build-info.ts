/**
 * The one fact the renderer needs about the build it is running in: **is this a
 * packaged build, or a checkout?**
 *
 * It exists because "am I the app that ships?" was being answered by two
 * different things, and both were wrong in different directions.
 *
 *   - The renderer's action registry read `import.meta.env.DEV`. That is a
 *     *build-mode* flag: `electron-vite build` clears it, so the E2E suite (which
 *     launches the built-but-unpackaged bundle) and `electron-vite preview` both
 *     looked like a release — and a dev-only action vanished from the command
 *     palette in a run where the developer could not reach it any other way
 *     either.
 *   - Nothing else in the renderer could tell at all. `contextIsolation` and
 *     `sandbox: true` mean the renderer has no `app`, and the preload runs in the
 *     same sandbox, so the truth — `app.isPackaged` — is only ever known in main.
 *
 * So main states it, once per window, and the preload reads it off `process.argv`
 * (Electron's `webPreferences.additionalArguments` is documented for exactly this:
 * small facts that have to be there before the first paint). No IPC round trip,
 * which matters because this decides whether a menu item is offered at all —
 * a value that arrives asynchronously would show a dev-only action for a frame and
 * then take it away.
 *
 * Absent is deliberately **not** packaged: a window that never got the flag is a
 * harness (a plain browser tab during QE, a future window nobody wired), where the
 * page a dev-only action opens is unreachable anyway. The bundle that ships always
 * has it, because the same build creates the window and parses the argument.
 */

/** The `--atr-packaged=<0|1>` argument main appends to a window's argv. */
export const PACKAGED_ARGV_PREFIX = "--atr-packaged=";

/** Render the argument main appends. The only place the wire format is written. */
export function encodePackagedFlag(packaged: boolean): string {
  return `${PACKAGED_ARGV_PREFIX}${packaged ? "1" : "0"}`;
}

/**
 * Read the flag back out of an argv. `null` when it is absent or unreadable
 * (a truncated argument, a value somebody hand-wrote), so the caller decides what
 * an unknown answer means instead of this function inventing one.
 */
export function parsePackagedFlag(argv: readonly string[]): boolean | null {
  const flag = argv.find((arg) => arg.startsWith(PACKAGED_ARGV_PREFIX));
  if (flag === undefined) return null;

  const value = flag.slice(PACKAGED_ARGV_PREFIX.length);
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

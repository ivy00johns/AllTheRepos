/**
 * Point this run at a platform the host is not.
 *
 * Loaded only by `vitest.other-platform.config.ts`, which
 * `scripts/check-unit-platform.mjs` runs so that a spec whose assertions depend
 * on the machine it happens to be on fails here rather than on a runner after a
 * push.
 *
 * The platform arrives in `ATR_UNIT_PLATFORM`, and a run without it throws
 * instead of quietly repeating the ordinary suite: a setup file that silently
 * did nothing would leave this config passing for the reason the gate exists to
 * catch, which is worse than not having the run at all.
 *
 * `configurable: true` on purpose. The menu and dock-badge specs pin
 * `process.platform` themselves, and they have to be able to define it and put
 * the original back; a non-configurable definition here would make the gate
 * fail the specs that are already doing this correctly.
 */

const target = process.env.ATR_UNIT_PLATFORM;

if (typeof target !== "string" || target.length === 0) {
  throw new Error(
    "ATR_UNIT_PLATFORM is not set. This setup file is loaded by " +
      "vitest.other-platform.config.ts, which needs a platform to point the " +
      "suite at; scripts/check-unit-platform.mjs sets it. Nothing is checked " +
      "by running this config without one.",
  );
}

Object.defineProperty(process, "platform", {
  value: target,
  configurable: true,
});

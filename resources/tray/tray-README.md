# Tray icon assets

This directory holds the macOS menu-bar (tray) icon used by
`src/main/system/tray.ts`.

## Files

| Filename               | Size  | Required | Purpose                              |
| ---------------------- | ----- | -------- | ------------------------------------ |
| `tray-Template.png`    | 22×22 | YES      | @1x asset loaded by `nativeImage`.   |
| `tray-Template@2x.png` | 44×44 | YES      | Retina/HiDPI variant. macOS auto-    |
|                        |       |          | picks via the `@2x` filename suffix. |

## Visual spec

- **Black-on-transparent.** macOS auto-inverts a `*Template.png` asset
  in dark mode / when the menu bar is dark, so the source art MUST be
  pure black (or near-black) with full transparency outside the glyph.
- 22×22 (or 44×44 @2x) is the canonical menu-bar size on modern macOS.
- Stroke weight: target ~2 device pixels at @1x so the glyph reads at
  small sizes.
- No drop shadows, no color — color renders incorrectly on macOS Big
  Sur+ menu bars (light-mode shows the inverted-black version).

## Current state

The `tray-Template.png` in this directory is a **1×1 transparent
placeholder** committed so the Electron build doesn't fail to load
the tray icon. The real icon is a design task — replace this file
(and add `tray-Template@2x.png`) with the final 22×22 / 44×44 assets
before shipping.

## File-naming convention

Electron's `nativeImage.createFromPath` reads the `@2x` suffix
automatically — passing the path to `tray-Template.png` will cause
macOS to source `tray-Template@2x.png` on Retina displays. Do NOT
rename the suffix; keep `@2x`, not `@2`, not `_2x`.

## See also

- `src/main/system/tray.ts` — loader + click handler.
- Electron docs: <https://www.electronjs.org/docs/latest/api/native-image#template-image-macos>

# Renderer fonts

Drop the following `.woff2` files into this directory. They are
referenced by `@font-face` declarations in
`src/renderer/styles/globals.css` and shipped by Vite as static
assets at renderer build time.

## Required files

- `IBMPlexSans-Regular.woff2` (weight 400)
- `IBMPlexSans-Medium.woff2` (weight 500)
- `IBMPlexSans-SemiBold.woff2` (weight 600)
- `IBMPlexSans-Bold.woff2` (weight 700)
- `JetBrainsMono-Regular.woff2` (weight 400)
- `JetBrainsMono-Medium.woff2` (weight 500)

## Why local?

The main-process CSP (NEW-PLAN.md §3.4) only allows `font-src 'self'
data:` — Google Fonts and other CDNs are explicitly blocked. The
legacy Next.js app uses `@import url("https://fonts.googleapis.com/...")`
in `app/globals.css`; that does NOT work inside the Electron renderer
and must not be copied over.

## Sources

- IBM Plex Sans — https://github.com/IBM/plex (OFL-1.1)
- JetBrains Mono — https://github.com/JetBrains/JetBrainsMono (OFL-1.1)

Until the `.woff2` files are committed the renderer falls back to
`system-ui` / `ui-monospace` via the `@theme` stack — visually close
enough for Phase 0 ping/pong work.

---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "\"Which repo was that?\" — answered in one window, on your own machine"
destination: embed
aspect: 1920x1080
language: en
audience: "developers with hundreds of local repos — README hero and landing-page visitors"
length: 135s
angle: show-it-as-is feature walkthrough
voice: kokoro:am_michael
---

## Intent

A 2:42 feature walkthrough of AllTheRepos for the README hero and the landing
page. Not a promo with invented screens: it features **the app's own captured
screens** as the video's assets, driven beat by beat through the real UI by
Playwright. The narrative arc is the README's own positioning — "which repo was
that?" — answered in one window, on your machine. Ten beats, one idea each, each
showing a real screen.

Voice: **local, machine-generated** (`hyperframes tts`, Kokoro-82M on CPU) — the
same treatment the scheduling demo used, with no cloud account in the loop.

Tone: a developer talking to a developer. Dry, unhurried, a little wry. The
screens carry the energy; the voice carries the meaning.

## Assets

- assets/captures/02-catalog.webm … 10-close.webm — one recorded clip per beat of the real app (2560×1600, from `scripts/make-demo-video.mjs`). Beat 1 has no clip by design: it is type over a dark frame.
- assets/brand/icon.png — the app icon; the close's logo sting.
- assets/brand/fonts/ — IBM Plex Sans + JetBrains Mono, bundled in-repo so the render needs no webfont fetch.
- design-system/alltherepos/MASTER.md — the brand spec (`#0F172A` canvas, `#22C55E` accent, JetBrains Mono headings, IBM Plex Sans body).

## Customizations

- Captions burned into every cut; the piece has to read muted.
- Music bed under the narration, ducked so the voice always wins.
- The `⌘K` palette is spoken about nowhere and shown at the close; no install
  claim beyond "alpha on macOS".

## Notes

- **Honesty:** the app is alpha, macOS/Apple-silicon only, ad-hoc signed and not
  notarised. The close says "alpha on macOS" and stops there; first-launch steps
  belong to the DMG's `READ-ME-FIRST.txt`, not the voiceover.
- The capture profile is throwaway and the guard refuses any clip showing a repo
  outside the demo library — this repository is private and the video is not.
- The spoken lines are locked in `SCRIPT.md` (`VO_MODE: verbatim`); the voice is
  re-recordable for free, so a re-read costs nothing but a re-render.
- 1:1 social cut is a later, sequential reframe off the 16:9 master; the clips
  were recorded at 2560×1600 so the square cut has real pixels to crop into.

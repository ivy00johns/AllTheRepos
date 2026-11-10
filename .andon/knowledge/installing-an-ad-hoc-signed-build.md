---
title: Installing an ad-hoc signed build
tags: [installing-an-ad-hoc-signed-build]
paths: [scripts/first-launch.mjs, ci.yml, src/shared/adhoc-notice.ts, src/shared, tsconfig.json, tsconfig.web.json]
updated: 2026-11-10
---

Imported from `docs/RELEASING.md:752` by Andon (import docs/RELEASING.md:752 379fd2568bca36cf); the original stays there.

This is the **no-certificate fallback** — what `pnpm electron:dist` produces, and
what a CI release produces when its run printed the `::warning::` about not being
installable. To tell which kind of build you are holding:

```bash
codesign -dvvv /Applications/AllTheRepos.app 2>&1 | grep -E 'Authority|Signature='
```

`Authority=Developer ID Application: …` is a signed, notarised build that updates
itself. `Signature=adhoc` is this section. The app says the same thing in words on
its Settings page, because that is where somebody will actually look.

The DMG is ad-hoc signed, which is enough for macOS to _run_ it locally
but not enough for Gatekeeper to trust a copy that was downloaded.

- **Built on this machine:** open it normally — no quarantine flag, no
  warning.

- **Downloaded from GitHub:** macOS refuses the first launch, and the
  right-click → **Open** shortcut does **not** get you past it any more.
  That was a Finder contextual-menu override, and Apple removed it in
  macOS 15 — this page documented it for several releases, so if that is the
  habit you are reaching for, that is why it stopped working. The procedure
  that works now, and the one Apple's own *Safely open apps on your Mac*
  describes, is:


  1. Try to open the app and let macOS refuse it — *"Apple could not verify
     'AllTheRepos' is free of malware."*

  2. Open **System Settings → Privacy & Security**.

  3. Scroll to **Security**, and click **Open Anyway** beside the line naming
     AllTheRepos.

  4. The warning appears once more, with an **Open** button. Confirm it.

  macOS records that as an exception for this app, so every later launch is an
  ordinary double-click. The same four steps ship **inside the DMG** as
  `READ-ME-FIRST.txt`, which is the only surface a person can read before
  macOS blocks the app: once the launch has been refused there is nothing
  running that could explain anything. The app then repeats it once you are
  inside — a one-time notice at the top of the window, dismissed with **Got
  it** and remembered in the settings file as `adHocNoticeDismissed`, so it
  never appears again. A notarised build shows none of this.

  Or skip the dialogs and clear the flag that triggers the check:


  ```bash
  xattr -dr com.apple.quarantine /Applications/AllTheRepos.app
  ```

The words above are not written here a second time. The procedure lives in
`scripts/first-launch.mjs`, the only place in the repository that knows it, and
four surfaces render from there: `READ-ME-FIRST.txt` inside the DMG
(`--print read-me`), the paragraph the release notes carry (`--print
release-note`), the `::warning::` a certificate-less CI run prints (`--print
warning`), and the one-time notice the app shows once somebody is inside it
(`--print notice`). Each used to be its own hand-written copy of the same
sentences, which is how all of them spent several releases advising a right-click
→ **Open** override Apple had removed in macOS 15 — and the copy that was missed
is the one a person reads while stuck at a launch macOS refused. `pnpm
first-launch:check` fails if a rendered file on disk has drifted from what the
source renders (`pnpm first-launch:write` is the repair), and also if any page a
person can read still offers that shortcut. It runs in `ci.yml` on every push and
pull request.

The notice is the one of the four the renderer imports rather than one the
workflow runs, so it travels as a generated TypeScript module,
`src/shared/adhoc-notice.ts`, holding the heading and the body the component
renders. It is generated rather than imported directly because
`scripts/first-launch.mjs` reads `node:fs` to compare the DMG's copy of the
instructions, and a Chromium bundle cannot load that — and it lives in
`src/shared/` because that is the one directory both `tsconfig.json` and
`tsconfig.web.json` include, so a generated file nobody typechecks cannot
happen. `first-launch:check` compares it byte for byte like the DMG's file, which
is what stops the sentences quietly moving back into the component the next time
somebody edits it.

Ad-hoc signing (`identity: "-"`) is deliberate and not the same as no
signing. Apple Silicon refuses to execute an arm64 binary with no
signature at all; `identity: null` skips signing entirely and leaves a
bundle that fails `codesign --verify`.

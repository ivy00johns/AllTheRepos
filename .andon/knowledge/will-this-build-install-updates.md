---
title: Will this build install updates?
tags: [will-this-build-install-updates]
paths: [src/main/services/signing.ts, scripts/notarize.mjs]
updated: 2026-11-10
---

Imported from `docs/RELEASING.md:625` by Andon (import docs/RELEASING.md:625 2b127eb58a5b6914); the original stays there.

`src/main/services/signing.ts` asks that about the *running* bundle, once, at
first use:

- `codesign -dvvv` — is this bundle signed by a **Developer ID Application**
  authority? (`scripts/notarize.mjs` classifies the same output the same way,
  because the two decisions have to agree about what "Developer ID signed"
  means; a unit test drives both with the same fixtures and fails if they ever
  drift.)

- `spctl --assess --type execute` — would *this machine's* Gatekeeper run it?
  That additionally requires the notarisation ticket, stapled to the bundle or
  available from Apple.

Both, or the answer is no. A Developer-ID signed bundle with no ticket passes the
first and fails the second, and it is the second that decides whether an update
can actually be applied. The answer travels in every `UpdateStatus` as
`canInstall` and `signature`, and it is what the UI explains when it offers a
download instead of an install.

That is the whole gate. Nothing else in the app changes behaviour between the
two builds: it checks on the same schedule, against the same feed, and reports
the same way.

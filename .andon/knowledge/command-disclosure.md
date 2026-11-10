---
title: Command Disclosure
tags: [command-disclosure]
paths: []
updated: 2026-11-10
---

Imported from `docs/COMMAND-DISCLOSURE.md:1` by Andon (import docs/COMMAND-DISCLOSURE.md:1 bb123e592c48055e); the original stays there.

**AllTheRepos v0.1.0 — alpha**

This document is a complete, source-traced inventory of every external
command, filesystem write, and network request the application can make.
It exists because an alpha tool that touches a developer's entire
codebase collection has to be auditable before it is trusted.

Each entry cites the file and line where the call is made, so nothing
here has to be taken on faith. If you find behaviour not listed below,
that is a bug — please report it.

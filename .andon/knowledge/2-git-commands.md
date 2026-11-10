---
title: "2. Git commands"
tags: ["2-git-commands"]
paths: []
updated: 2026-11-10
---

Imported from `docs/COMMAND-DISCLOSURE.md:32` by Andon (import docs/COMMAND-DISCLOSURE.md:32 40b5d097ce66b6bc); the original stays there.

All git access goes through `simple-git`. The complete set of methods
invoked anywhere in the application is:

| Method | Underlying command | Writes? | Used by |
| --- | --- | --- | --- |
| `git.status()` | `git status` | No | `services/git.ts:55`, `git-sync.ts:199`, `metadata.ts:255` |
| `git.branch()` / `git.branchLocal()` | `git branch` | No | `metadata.ts:261`, `git.ts:97` |
| `git.log({maxCount:1})` | `git log -1` | No | `metadata.ts:273` |
| `git.raw(["log","-1","--pretty=…",<branch>])` | `git log -1` | No | `git.ts:112` |
| `git.getRemotes()` | `git remote -v` | No | `metadata.ts:242`, `git-sync.ts:212` |
| `git.remote(["get-url","origin"])` | `git remote get-url origin` | No | `launcher.ts:684` |
| `git.fetch(["--prune"])` | `git fetch --prune` | Refs only | `git-sync.ts:221` |
| `git.pull(["--ff-only"])` | `git pull --ff-only` | **Yes** | `git-sync.ts:256` |

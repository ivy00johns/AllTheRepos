---
title: Commands that are *not* present anywhere in the codebase
tags: [commands-that-are-not-present-anywhere-i]
paths: [src/main]
updated: 2026-11-10
---

Imported from `docs/COMMAND-DISCLOSURE.md:48` by Andon (import docs/COMMAND-DISCLOSURE.md:48 0916554b8431f4be); the original stays there.

`push` · `commit` · `add` · `rm` · `reset` · `checkout` · `switch` ·
`restore` · `clean` · `merge` · `rebase` · `cherry-pick` · `stash` ·
`clone` · `branch -D` · `tag` · `remote set-url` · `gc` · `prune` ·
`filter-branch` · `reflog expire` · `worktree`

You can verify this yourself:

```sh
grep -arn "git\.[a-zA-Z]*(" src/main --include="*.ts"
```

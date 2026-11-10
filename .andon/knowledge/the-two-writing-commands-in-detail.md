---
title: The two writing commands, in detail
tags: [the-two-writing-commands-in-detail]
paths: []
updated: 2026-11-10
---

Imported from `docs/COMMAND-DISCLOSURE.md:61` by Andon (import docs/COMMAND-DISCLOSURE.md:61 a526f7308b5c37e1); the original stays there.

**`git fetch --prune`** updates remote-tracking refs and removes
remote-tracking branches whose upstream is gone. It does not touch your
working tree, your local branches, or your commits.

**`git pull --ff-only`** is the only command that can change files in
your working tree, and it is heavily gated. Before it runs,
`git-sync.ts:217-253` refuses in every one of these cases:

- the working tree is dirty → outcome `dirty`, skipped

- the branch is ahead *and* behind (diverged history) → outcome `diverged`, skipped

- the branch has no upstream → outcome `no-upstream`, skipped

- the repo has no remotes → outcome `no-remote`, skipped

- the branch is not behind → outcome `already-current`, skipped

`--ff-only` means git itself refuses anything that is not a
fast-forward — no merge commit is ever created, and no conflict
resolution is ever attempted. A fast-forward can only add commits that
already exist on the remote; it cannot discard local work, because the
presence of local work is what `dirty` and `diverged` block on.

**Limitation to be aware of:** a fast-forward pull is not covered by the
app's own undo. The sync result reports how many commits were received,
but not the SHA you were on beforehand. Reversing a pull means
`git reflog` to find the old SHA, then `git reset --hard <sha>` in a
terminal.

**Pull is never automatic.** `gitSyncService.pull` has exactly one caller
in the whole codebase — the `git:pull` IPC handler at `ipc/git.ts:93`,
reached only by pressing Pull. Nothing on a timer, at startup, or in the
background can invoke it.

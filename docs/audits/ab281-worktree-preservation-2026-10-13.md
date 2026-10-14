# AB#281 — completed launch worktree retirement

AB#281 moved New → Active before changes under AB#118. The owner explicitly
requested retirement of old worktrees and authorized subsequent release work,
commits, pushes and PRs. The primary checkout was clean and fast-forwarded to
`893211697132ede9b56bd651d47bb07fa1ce977c` before new work branches were published.

Nine unused checkouts were retired: #382, #383, #384, #385, #386, #387, #388,
#389 and #390. Each matched the merged PR's exact source branch/head, was an
ancestor of current main, had no tracked or untracked changes and had no active
processes using its path. Both ordinary status and the complete ignored-file
inventory were checked again immediately before retirement. No force, reset,
branch deletion, session termination or content/provider mutation was used.

All **10,568 private/source/operational files**, **5,293,992,766 bytes**, were
preserved under ignored `temp/retired-worktrees-20261013-overnight/`, with a
branch-derived subdirectory per checkout. File SHA-256, mode and nanosecond
mtime were verified against every copy before the original files were removed.
Mode-0600 `retirement.json` manifests map original/preserved paths; the enclosing
archive is mode 0700. Only inventoried reproducible dependencies, builds and test
caches were discarded. Historical approvals, recovery receipts and private source
content were preserved byte for byte. Existing earlier preservation archives remain.

Open #391/#392 checkouts were retained. Two older #255 checkouts were also retained
because their local HEAD differs from the merged PR head: one local merge is included
in current main, the other is not proven integrated. Neither was reset or deleted.
The open article-publication helper's historical #389 CI-log references were rebased
to the preserved archive, with its original helper copied first. Immutable receipts
and approved operation packets were not rewritten. New operations must use new
input plans if another path binding changes.

Repository-local same-name branch/push defaults and the registered worktree list
were verified. New release work remains in separate published branches under
`temp/worktrees/`. The VS Code GUI was not inspected. If removed checkouts remain
visible, use **Developer: Reload Window**, then **Source Control: Focus on
Repositories View**. Reopen an explicitly closed live checkout using **Git: Open
Repository...**; retain `git.detectWorktrees` and `scm.alwaysShowRepositories`.

This is operational preservation evidence, not an exercised Production rollback or
owner handoff. AB#281 remains Active pending this evidence PR's review/merge;
AB#118 still needs its actual recovery exercise and accepted transfer.

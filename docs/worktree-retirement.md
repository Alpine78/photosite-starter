# Retiring a completed worktree

Moved verbatim from `AGENTS.md` (AB#381). `AGENTS.md` requires following it before any
worktree is retired.

Removing its directory does not delete its branch. Retire only a checkout the
user has authorized you to clean up, after inspecting it:

1. Fetch `origin`, confirm the PR is **merged**, and compare its final source
   branch and head SHA with the checkout's branch and `git rev-parse HEAD`.
   Preserve checkouts another session or dev server still uses; never unlock one.
2. Inspect `git status --short --untracked-files=all` and
   `git ls-files --others --ignored --exclude-standard`. The second check is
   mandatory: ordinary removal does not protect ignored `.env.local`, private
   imports, local data, dependencies or test artifacts. Preserve or explicitly
   authorize disposal of every local file before removing the directory.
3. For an ordinary merge, verify `git merge-base --is-ancestor HEAD origin/main`
   in that checkout. A squash merge cannot be proved by this ancestry check;
   require separate evidence that the exact reviewed patch was integrated, or
   leave the worktree for the owner. A merged PR alone does not cover later local
   commits or edits.
4. From outside that checkout, run `git -C "$primary_root" worktree remove "$worktree_dir"` with both variables set to the inspected repository/path.
   Never add `--force`, reset changes or delete branch refs as part of retirement.
   `git worktree prune` cleans stale registrations, not live checkout directories.
5. Recheck `git worktree list --porcelain`. If VS Code retains the entry, run
   **Developer: Reload Window**, then **Source Control: Focus on Repositories View**.
   Check worktree detection/its limit and ignored repositories; use **Git: Open
   Repository...** to reopen an explicitly closed checkout. Report when the GUI
   has not been inspected instead of claiming its repository list is verified.

To reattach a retained branch, use `git worktree add "$worktree_dir" "$work_branch"`
under the canonical `temp/worktrees/` path. The branch must not be checked out
elsewhere. Do not create a replacement branch or change its same-name upstream.

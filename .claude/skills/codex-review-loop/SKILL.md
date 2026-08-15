---
name: codex-review-loop
description: Automates the implement-review-fix cycle against the OpenAI Codex CLI as an independent second reviewer, replacing manual copy-paste between Claude Code and Codex. Use when the user asks to "loop with Codex", "get a second opinion", "run it past Codex until it's happy", or wants an automated dual-review cycle before opening a PR.
argument-hint: "[base-branch-or---uncommitted] [max-iterations]"
---

# /codex-review-loop

Runs `codex review` (OpenAI's Codex CLI, non-interactive) against the current
change, fixes what it finds, and re-reviews — repeating until Codex reports no
findings or a round limit is hit. This automates the exact manual cycle of
"send the diff to Codex, read its findings, fix them, ask again" instead of a
human relaying messages between two tools.

## Why a second tool, not another Claude self-review

`/code-review` is Claude reviewing Claude's own work — useful, but it shares
whatever blind spots produced the code in the first place. Codex is a
genuinely different model with a different sandbox and different training, so
it catches a different distribution of mistakes. That independence is the
entire point of this skill; do not "simplify" it into a second Claude-only
pass.

## Prerequisites (check these first, every run)

1. **Codex CLI is installed and authenticated.**
   ```bash
   codex --version
   codex doctor   # look for "✓ auth   auth is configured"
   ```
   If `codex` is not found, install it: `npm install -g @openai/codex`. If
   auth is not configured, stop and tell the user — do not attempt to log in
   on their behalf.

2. **If this repository gates review on an Azure Boards work item**
   (`AGENTS.md`'s "Azure Boards work item gate" — true for photosite-starter),
   Codex's default sandbox blocks the `az boards` call in three independent
   ways, found by testing each in turn — all three are required together,
   and each was verified insufficient alone:

   - **Filesystem**: the Azure CLI unconditionally writes a session-cache
     file (`~/.azure/az.sess`) on every invocation, even for a read-only
     command. Codex's default sandbox is read-only outside the repo
     workspace, so this write is rejected with a `PermissionError` — which
     looks like an auth failure but is not one. Fix: run in `workspace-write`
     mode with `~/.azure` added as an extra writable root.
   - **Network**: `workspace-write` mode still blocks outbound network by
     default, so `dev.azure.com` fails DNS resolution even once the
     filesystem write succeeds. Fix: explicitly enable network access.
   - **Credential**: `AZURE_DEVOPS_EXT_PAT` reaches Codex's exec'd shell
     correctly (verified: `echo ${#AZURE_DEVOPS_EXT_PAT}` reported the
     documented 84-character length) but this az-cli/azure-devops-extension
     version (2.89.0 / 1.0.6 at the time of testing) did not honor it as
     Microsoft's docs describe — `az boards` still asked for `az login`/`az
     devops login`. What works is a **one-time interactive**
     `az devops login --organization https://dev.azure.com/<org>` run by the
     user in their own terminal, which persists a token under `~/.azure` that
     Codex's sandbox can then read once the filesystem/network fixes above
     are in place. If this ever needs redoing (token rotation, a new
     machine), that step needs a human — do not attempt to script an
     interactive login.

   The combined, verified-working invocation:
   ```bash
   codex review --base <branch> \
     -c sandbox_mode="workspace-write" \
     -c sandbox_workspace_write.network_access=true \
     -c 'sandbox_workspace_write.writable_roots=["'"$HOME"'/.azure"]'
   ```
   If a round still comes back saying the work item couldn't be read after
   all three are in place, report it plainly and stop — do not paper over the
   gate by stripping the work-item context from the prompt, since that
   defeats a rule the project owner deliberately wants enforced.

3. Confirm there is something to review: a diff against the base branch, or
   uncommitted changes. `codex review` costs real time and usage per call, so
   do not run it against an empty diff.

## The loop

Default base branch is `main`; default round limit is 5. Both are
overridable via `$ARGUMENTS` (`[base-branch-or---uncommitted] [max-iterations]`).

For each round, up to the limit:

1. **Run the review**, in the background since it can take several minutes,
   with the sandbox overrides prerequisite 2 established (needed whenever
   this repo's Azure Boards gate applies — harmless to include even when it
   doesn't):
   ```bash
   codex review --base <branch> \
     -c sandbox_mode="workspace-write" \
     -c sandbox_workspace_write.network_access=true \
     -c 'sandbox_workspace_write.writable_roots=["'"$HOME"'/.azure"]'
   # or --uncommitted instead of --base <branch> for working-tree changes
   ```
   Do not add flags from `codex exec --help` that `review` does not have —
   `review` has its own, smaller flag set (`--base`, `--uncommitted`,
   `--commit`, `--title`, `--enable`, `--disable`, `-c`). It has no `--json`
   or `-o`; its answer is prose on stdout, read directly.

2. **Read the response as a report, not a command list.** Codex's own
   findings deserve the same scrutiny this project's `/code-review` skill
   already gives its own: verify each one against the actual code before
   acting on it. A finding that misreads the code is a finding to explain and
   skip, not one to blindly satisfy. (This is not hypothetical — a fix applied
   during this skill's own development introduced a reference-resolution bug
   that only surfaced once the extended validator was actually exercised in
   tests; catching that took running the test suite, not just re-reading the
   diff.)

3. **If there are real findings:** first check whether this same spot has
   already had a Claude-authored fix attempt earlier in this loop (see
   "When a spot needs a second correction" below). If not, fix them,
   respecting this repository's own conventions and Definition of Done. Then
   run the project's own gates before spending another round on Codex:
   ```bash
   npm run lint && npm test && npm run build
   ```
   A round that doesn't even pass the project's own gates is not ready for
   another expensive review call.

4. **If Codex reports no findings**, or the round limit is reached, stop.

### When a spot needs a second correction

Keep a running note of which file/function each round's fix touched. A
finding landing in a *fresh* spot is the normal case — fix it per step 3.
But when a round's finding lands in a file/function **Claude already
modified earlier in this same loop** — Codex pointing at the same mechanism
twice, meaning the first correction didn't actually close the gap — do not
attempt a third Claude-authored pass at it. Hand that specific spot to Codex
instead:

1. Ask Codex to fix it directly and non-interactively, with write access:
   ```bash
   codex exec -s workspace-write \
     -c sandbox_workspace_write.network_access=true \
     -c 'sandbox_workspace_write.writable_roots=["'"$HOME"'/.azure"]' \
     "Fix exactly this finding: <finding text, file, and line>. Make the
      minimal change; do not touch unrelated code."
   ```
   (`approval: never` is this environment's default for `exec`, so it edits
   without pausing for a human — that is expected, not a bypass.)
2. **Review what Codex actually wrote** the same way any other diff gets
   reviewed here — read the change, don't trust the tool's own summary of
   it. Apply corrections if Codex's fix is wrong, incomplete, or violates a
   project convention it had no way to know unprompted.
3. Run the project's gates, then resume the normal loop from step 1 —
   Codex's own fix still gets reviewed by Codex again next round like
   everything else, so a bad self-fix is still caught.

This only swaps who *writes* the fix for one recurring spot; the review
discipline in step 2 above and the gates in step 3 above still apply
unchanged. It exists because a spot that resists one correction from the
reviewee is exactly the case an independent second opinion is for.

## Ending the loop

- **Clean pass:** summarize what changed across all rounds, run the full
  verification suite one more time, and stop. Do not keep looping past a
  clean review "just to be sure" — that just burns usage.
- **Round limit reached with findings still open:** report the remaining
  findings and why each is still open (disagreement, needs a human decision,
  genuinely hard to fix) rather than silently giving up.
- **Codex blocked** (auth, work-item gate, network): report the exact
  blocker and stop; do not retry in a hot loop.
- **Never commit.** This repository's `AGENTS.md` forbids the agent from
  running `git commit` under any circumstances, in any workflow, including
  this one. Leave the working tree ready and suggest a commit message, the
  same as any other change.

---
name: claude-review-loop
description: Run a Codex implementation through a one-time Claude plan review and a bounded Claude diff review/fix loop. Use when the user asks Codex to loop with Claude, check a plan with Claude first, get Claude's second opinion, or have Claude review the finished change before a PR; do not activate for ordinary implementation without a requested dual-agent workflow.
---

# Claude review loop for Codex

Use Claude Code as an independent second reviewer around Codex's own work:

1. Codex drafts the implementation plan.
2. Claude reviews that plan exactly once before implementation.
3. Codex implements, self-reviews, and runs the project gates.
4. Claude reviews the finished change.
5. Codex fixes verified findings and repeats the Claude review until clean or the
   round limit is reached.

The default post-implementation loop limit is five Claude review/fix rounds. Each Claude
diff review starts one round; the Codex- or Claude-authored corrections it produces belong
to that same round. The user may choose another limit or base branch. The plan review is
separate and does not consume a post-implementation round.

If the skill is invoked only after a change already exists, do not manufacture a
retroactive plan review. Start with Codex's self-review and the post-implementation loop.

## Why Claude is external to the self-review

Codex must carefully review its own plan, implementation, and every correction. Claude is
additional evidence from a different tool and model, not a substitute for that work and
not an unquestioned verdict. Verify every finding against the authoritative requirements
and code before acting on it.

## Prerequisites

Before the first Claude call:

```bash
command -v claude
claude --version
claude auth status
```

`claude auth status` exits successfully when the user is logged in. If the executable or
authentication is missing, stop and report the blocker. Do not install, update, or log in
to Claude Code on the user's behalf.

Before review, confirm the base branch and that there is a committed or uncommitted diff
to inspect. Default the base to `main`; do not spend a review round on an empty change.

If an Azure Boards item scopes the work, Codex must first read its description, acceptance
criteria, discussion, and relevant relations under `AGENTS.md`. The plan sent to Claude
contains that authoritative context. During final diff review Claude loads the repository
instructions and must independently obey their work-item gate. If its subprocess cannot
reach or authenticate to Azure Boards, request only the permissions needed for that call;
if it still cannot read the item, stop instead of weakening the gate.

## Phase 1: one-time plan review

1. Draft a plan proportional to the task. Include the verified requirements, affected
   boundaries, tests, documentation, and the complete relevant Azure Boards context when
   an item governs the work.
2. Send the plan to Claude once in a non-persistent, tool-free invocation. `--bare` keeps
   Claude from loading `CLAUDE.md`, hooks, skills, plugins, MCP servers, or memory for this
   phase; the self-contained plan is the only authority it needs. `--tools ""` and
   `dontAsk` prevent independent repository or network work.

   ```bash
   claude --bare -p \
     --permission-mode dontAsk \
     --tools "" \
     --no-session-persistence \
     "Review the implementation plan provided on stdin. Flag concrete risks, missing edge cases, acceptance-criteria gaps, or a materially simpler approach. Do not edit files. Treat the included work-item context as complete and authoritative; do not try to fetch any ticket yourself." <<'EOF'
   <plan text, including authoritative ticket context when applicable>
   EOF
   ```

   Supplying the plan on stdin avoids shell expansion or quoting damage from Markdown,
   backticks, and code snippets.
3. Treat Claude's response as a report. Check every concern against the work item, code,
   ADRs, and official documentation as applicable.
4. Revise the plan for verified concerns. If that materially changes scope or user-visible
   behavior, ask the user before implementing. Do not send the revised plan back to Claude;
   the plan phase is bounded at one substantive review.
5. Tell the user briefly what Claude flagged and how the plan changed, then proceed unless
   a material decision requires their answer.

If the Claude command fails, stop before implementation. If the command completes but
does not substantively review the plan, one corrected retry is allowed when the prompt or
missing context can be fixed. A second non-answer is a blocker; do not silently skip the
plan review.

## Phase 2: Codex implementation and self-review

Implement the reviewed plan under the repository rules. Before asking Claude to review:

- inspect the complete diff, including staged and unstaged changes;
- fix Codex's own findings;
- run focused tests and the applicable Definition of Done gates; and
- confirm documentation and Azure Boards state are accurate.

Repeat this Codex-authored self-review and gate pass after every correction in the loop.
Do not send obviously broken or unreviewed work to Claude.

## Phase 3: Claude review loop

Maintain a small finding ledger for the loop. Identify a finding by its concrete root
cause and code location or mechanism—not merely by a broad label such as "validation" or
"accessibility." Record the first round, disposition, and whether Codex already attempted
a correction.

For each round, up to the configured limit:

1. Invoke Claude in non-persistent `plan` mode. This loads the repository's `CLAUDE.md`
   and therefore `AGENTS.md`, while preventing file edits. Tell it to inspect both the
   base-branch diff and staged or unstaged working-tree changes. Include concise prior-round
   dispositions so a rejected false positive is not presented as new evidence.

   ```bash
   claude -p \
     --permission-mode plan \
     --no-session-persistence \
     "Review the current implementation against the repository instructions and authoritative work item. Inspect the diff from the configured base branch plus all staged and unstaged changes. Report only concrete correctness, security, accessibility, regression, or requirement gaps, ordered by severity, with file and line references, impact, and the smallest appropriate fix. Do not edit files. If there are no findings, say so explicitly." <<'EOF'
   Base branch: main
   Work item: <id or none>
   Prior-round findings and dispositions: <none on round 1>
   EOF
   ```

2. Verify each finding. A false positive or deliberate documented trade-off is explained
   and recorded, not "fixed" merely to satisfy the reviewer.
3. For a verified finding that has not previously had a Codex correction attempt, Codex
   makes the smallest appropriate fix, self-reviews the resulting diff, and runs the
   applicable gates.
4. For a verified finding that returns after Codex already tried to correct that same root
   cause and location, Codex must not attempt another fix. Follow **Recurring findings**
   below and give that exact correction to Claude.
5. Start the next Claude review round only after the working tree is internally reviewed
   and the applicable gates pass. Stop immediately on a clean review. Do not run extra
   reassurance rounds after Claude reports no findings.

A failed or non-substantive Claude review is not a clean pass. Make at most one corrected
retry when there is a concrete invocation or context error; otherwise report the blocker
and stop. Never hot-loop an unavailable reviewer.

## Recurring findings: Claude writes the correction

When the same verified root cause and location returns after a Codex-authored fix, delegate
that specific correction to Claude. This is the user's explicit handoff rule: Codex reviews
the result but does not take a second attempt at the recurring mechanism.

Run Claude with local edit tools only—no Bash, MCP, deployment, messaging, or other external
side effects:

```bash
claude -p \
  --permission-mode acceptEdits \
  --tools "Read,Grep,Glob,Edit,Write" \
  --disallowedTools "mcp__*" \
  --no-session-persistence \
  "Fix exactly the recurring finding described on stdin. Follow CLAUDE.md and AGENTS.md. Make the smallest local code or test change that resolves the root cause. Do not touch unrelated files and do not commit." <<'EOF'
Finding: <exact finding, file, line, and observed failure>
Prior Codex fix: <what changed and why it was insufficient>
Required behavior: <authoritative requirement>
EOF
```

After Claude returns:

1. Read the actual diff; do not trust Claude's summary.
2. Reject or repair unrelated collateral, but do not take over the recurring correction
   itself. If Claude made no meaningful edit or cannot resolve it, report the finding as
   open instead of silently switching it back to Codex.
3. Run Codex's self-review and the applicable project gates.
4. Resume the normal Claude review loop. A later recurrence of the same verified problem
   remains Claude-owned and the overall five-round default still bounds the loop.

## Ending the loop

- **Clean review:** summarize the plan feedback, Codex self-review, every Claude review
  round, each Codex-authored fix, each Claude-authored recurring fix, and the final gate
  results.
- **Round limit reached:** stop after the configured maximum and list every remaining
  finding with its disposition and why it remains open.
- **Blocked:** report the exact missing CLI, authentication, permissions, work-item access,
  command failure, or gate failure. Do not claim a clean review.
- **Never commit:** `AGENTS.md` forbids Codex and the delegated Claude subprocess from
  committing. Leave the working tree for the user and suggest a conventional commit
  message and, when applicable, PR text.

## CLI compatibility

These invocations use Claude Code's documented headless `-p`, authentication status,
permission modes, tool restrictions, stdin input, and non-persistent sessions. Before
changing the command shapes, verify them with the installed `claude --help` and the current
official Claude Code CLI reference.

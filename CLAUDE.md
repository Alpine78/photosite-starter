# CLAUDE.md

All project instructions live in @AGENTS.md — a single canonical file shared by all
AI coding agents (Claude Code, Codex, etc.). Edit AGENTS.md, not this file.

## Claude Code specific: recommended skills

- `find-docs` (Context7) — before writing code against version-sensitive APIs
  (Next.js 16, Tailwind v4, Sanity)
- `/code-review` (bundled) — review the diff before opening a PR (part of Definition of Done)
- `/architecture` (project skill, `.claude/skills/`) — the ADR template. When to write
  one and where it goes is a project rule, not a Claude rule: see "Documentation" in
  AGENTS.md and `docs/adr/README.md`
- `verify` — confirm a change works in the running app, not just in the build
- `/security-review` (project skill) — required when client gallery / access token
  features land

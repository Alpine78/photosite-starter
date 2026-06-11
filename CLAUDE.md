# CLAUDE.md

All project instructions live in @AGENTS.md — a single canonical file shared by all
AI coding agents (Claude Code, Codex, etc.). Edit AGENTS.md, not this file.

## Claude Code specific: recommended skills

- `find-docs` (Context7) — before writing code against version-sensitive APIs
  (Next.js 16, Tailwind v4, Sanity)
- `/code-review` (bundled) — review the diff before opening a PR (part of Definition of Done)
- `/architecture` (project skill, `.claude/skills/`) — write an ADR for significant
  technical decisions (e.g., lightbox library choice); store ADRs in `docs/adr/`
- `verify` — confirm a change works in the running app, not just in the build
- `/security-review` (project skill) — required when client gallery / access token
  features land

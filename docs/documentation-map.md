# Documentation map

Moved verbatim from `AGENTS.md` "Documentation" (AB#381) so it loads only when needed.
`AGENTS.md` requires reading it before finishing any change; it is the complete set —
there is no other documentation to hunt for.

| File                                 | Audience                                                           | Update it when                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                          | humans evaluating or cloning the project                           | scope, structure, setup, or MVP progress changes                                                                                                            |
| `AGENTS.md`                          | all AI agents (canonical)                                          | project-level working rules or conventions change                                                                                                           |
| `docs/feature-status.md`             | maintainers and agents seeking implementation history             | a feature's implementation status changes; verify against code and Azure Boards                                                                              |
| `CLAUDE.md`                          | Claude Code only                                                   | a Claude-specific skill or workflow changes — it imports this file, so put shared rules here                                                                |
| `docs/adr/`                          | future maintainers                                                 | a hard-to-reverse technical decision is made (see below)                                                                                                    |
| `docs/adr/0040-client-gallery-cleanup-credential-options.md` | owner deciding the AB#395 credential boundary | the accepted cleanup credential policy or supporting capability evidence changes; policy acceptance grants no runtime activation |
| `docs/architecture/`                 | anyone forming a mental model of the system                        | a system boundary, layer, external dependency, or the deploy flow changes — edit the `.d2` source and re-run `npm run diagrams`, never the `.svg`           |
| `docs/theme-contract.md`             | whoever restyles a clone or builds a theme preset (AB#37)          | a semantic design token is added, renamed, or revalued, the light/dark mechanism changes, or a surface moves in or out of the "stays explicit" list         |
| `docs/gallery-presentation.md`       | whoever authors gallery layout defaults or restyles the gallery grid (AB#157) | the placement rule, a responsive threshold, the caption-access mechanism, or the layout/caption inheritance model changes                                   |
| `docs/bilingual-page-coverage.md` | maintainers implementing AB#255 | page-family language coverage or remaining ownership changes; source evidence is distinct from live CMS completeness |
| `docs/article-reading-position.md` | owner refining AB#20 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `docs/asset-inventory.md`            | licensing audit                                                    | any third-party asset, font, or shipped dependency is added or removed                                                                                      |
| `docs/contact-data-flow.md`          | the site owner, a visitor who asks, and the AB#117 launch review   | the contact form's fields, delivery path, processors, logs, or retention change                                                                             |
| `docs/private-gallery-data-flow.md`  | the site owner, a customer who asks, and the AB#117 launch review  | a private gallery's stored data, the access link or cookie, its processors, logs, or retention change                                                       |
| `docs/client-gallery-retention.md` | owner and maintainer of unlisted client galleries | expiry defaults, cleanup requirements, enrollment, implementation status or deletion limits change (AB#392) |
| `docs/proof-selection-data-flow.md` | the site owner, a customer who asks, and the AB#117 launch review  | a proof gallery's stored records, the selection key, the reminder address, processors, logs, retention or the deletion procedure change                     |
| `docs/poll-data-flow.md`             | the site owner, a visitor who asks, and the AB#117 launch review   | a poll's stored data, the poll-specific voting cookie, the write credential, logs, or retention change                                                              |
| `docs/search-data-flow.md`           | the site owner, a visitor who asks, and the AB#117 launch review   | the site search's query transport, what is searched, logs, caches, or processors change |
| `docs/article-comments-and-ratings.md` | owner refining AB#26 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `docs/sanity-setup.md`               | the site owner and whoever provisions a clone's CMS                | the Sanity connection settings, ownership/transfer story, perspective, schemas, media policy, or failure behavior change                                    |
| `docs/sanity-seeding.md`             | the site owner and whoever seeds a clone's sample or first content | the seed script's fixture content, id/idempotency contract, write-token story, verification steps, or go-live cleanup checklist change                      |
| `sanity/README.md`                   | whoever wires a clone's Studio to these schemas                    | a document type is added, or how the Studio consumes them changes                                                                                           |
| `docs/mail-recovery-evidence.md` | owner and recovery operator (AB#131/118) | mailbox, DNS or account recovery evidence requirements change |
| `docs/rollback-exercise-record.md` | owner and recovery operator (AB#118) | code/content recovery exercise or ownership evidence requirements change |
| `docs/deployment.md`                 | the site owner and whoever provisions a clone's hosting            | the Preview environment, pipeline deployment stage, environment-variable split, runtime pins, or promotion/rollback mechanism change                        |
| `docs/security-privacy-review.md`    | the site owner and future launch reviews                           | the launch security/privacy review is rerun, a finding's disposition changes, or the security response headers change (also update ADR-0011)                |
| `docs/keyword-query-benchmark.md`    | AB#55's taxonomy ADR and whoever runs the AB#65 spike              | the keyword-query benchmark fixture, harness, or matrix changes, or an owner-run live measurement is completed and its numbers/recommendation are filled in |
| `docs/review-catalog.md` | owner refining AB#27 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `docs/commercial-policy-requirements.md` | owner and qualified legal/tax reviewers (AB#49) | proposed offer, licensing boundary, sales channel, buyer classification, processors, law or review evidence changes; this is requirements, not legal advice |
| `docs/photographer-operations.md` | owner refining AB#28 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `NOTICE`, `licenses/`                | anyone receiving the product                                       | a third-party component with an attribution requirement is added                                                                                            |
| `docs/analytics-data-flow.md` | the site owner, a visitor who asks, and the AB#117 launch review | the optional analytics or Speed Insights adapter, its data, provider, route exclusion or cost posture changes (AB#371, AB#376) |
| `docs/availability-monitoring-plan.md` | the site owner setting up uptime monitoring (AB#158) | the monitor contract, the owner-run probe, provider options or the launch record change |
| `docs/backlog-agent-readiness.md` | agents and the owner planning work | the decision/agent-readiness map is reviewed; Azure Boards stays authoritative |
| `docs/cache-revalidation.md` | whoever operates or changes the published-content cache (AB#83) | the cache boundary, tags, revalidation endpoint or its authentication change |
| `docs/client-web-image-batches.md` | the owner preparing client-gallery web images (AB#325) | the local batch preparation command, its inputs or guarantees change |
| `docs/client-gallery-zip.md` | owner attaching a verified whole ZIP to a delivery draft (AB#407) | the private attachment operator, approval/evidence contract, runtime ZIP or cleanup guarantees change |
| `docs/cms-recovery-rehearsal.md` | the owner and recovery operator (AB#267) | the local CMS and original-asset recovery rehearsal command or its evidence change |
| `docs/dependency-security.md` | the maintainer triaging dependency advisories (AB#160) | the scheduled audit, Dependabot settings, triage process or an accepted exception changes |
| `docs/client-gallery-retention-planner.md` | maintainer implementing expiry cleanup (AB#394) | pure planner evidence, outcomes, limits or executor integration requirements change |
| `docs/client-gallery-cleanup.md` | owner and maintainer of scheduled delivery cleanup (AB#397–399) | enrollment/worker or read-readiness verification protocol, limits, role boundary, progress or activation evidence changes |
| `docs/audits/client-gallery-lifecycle-rehearsal-2026-10-24.md` | owner reviewing AB#401 and gallery activation | the dated synthetic rehearsal evidence, cleanup verification or finding disposition is corrected; later runs need their own dated record |
| `docs/audits/proof-notice-mail-verification-2026-10-24.md` | owner reviewing AB#403 and proof-notice activation | the dated mail-only verification evidence or finding disposition is corrected; owner-reported mailbox receipt remains distinct from provider acceptance |
| `docs/gallery-removal-impact.md` | the owner preparing a reviewed gallery removal (AB#326) | the read-only removal-impact inventory or its report contract changes |
| `docs/image-sales-discovery.md` | the owner deciding the image sales boundary (AB#95) | sales evidence, options or the decision gate change |
| `docs/jpeg-export-audit.md` | the owner verifying a JPEG export set (AB#327) | the local decode audit command or its guarantees change |
| `docs/locale-publication.md` | the owner publishing reviewed localized copy (AB#270) | the revision-bound locale publication command or its safety contract changes |
| `docs/localized-draft-action-plan.md` | the owner and Studio maintainer (AB#125) | the linked localized-draft creator, plan or Studio guards change |
| `docs/offer-validation.md` | the owner validating commercial offers (AB#45) | the validation plan, segments or recorded customer evidence change |
| `docs/production-failure-triage.md` | the owner and responder for Production failures (AB#159) | the triage runbook, alert decision or failure-trace evidence changes |
| `docs/publication-locale-census.md` | the owner auditing publication locales (AB#269) | the offline publication census command or its report changes |
| `docs/release-policy.md` | whoever tags releases or depends on compatibility (AB#46) | the release and compatibility policy changes |
| `docs/release-source-verification.md` | the owner verifying a frozen release source (AB#268) | the offline release-source identity gate or its inputs change |
| `docs/support-service-proposal.md` | the owner shaping a support offer (AB#47) | the proposed support and maintenance scope changes |
| `docs/feature-status-archive-2026-10.md` | maintainers and agents seeking older implementation history | never edited; it is a verbatim archive of an older `feature-status.md` block (AB#381) |
| `docs/documentation-map.md` | every agent and maintainer finishing a change (AB#381) | a documentation file is added, renamed, removed, or its audience or update trigger changes |
| `docs/owner-run-commands.md` | the owner and anyone running operational tooling (AB#381) | an operational or owner-run command is added, removed, or its safety contract changes |
| `docs/worktree-retirement.md` | agents and the owner retiring a finished worktree (AB#381) | the worktree retirement procedure changes |
| `.claude/skills/`, `.agents/skills/` | agents                                                             | a recurring workflow needs a skill; duplicate into both, no symlinks                                                                                        |

# ADR-0027: Optional public chat and current public knowledge

**Status:** Proposed
**Date:** 2026-10-05
**Deciders:** Project owner, pending acceptance
**Work item:** AB#127

## Context

AB#127 reserves an optional visitor assistant grounded in this site's published
content. It requires a provider boundary, privacy and synchronization decision
before implementation. AB#126's editorial provider proposal is a predecessor, not
an implemented chat service. This record is independent of accepting or deploying
that proposal. No chat UI, assistant profile schema, knowledge exporter, index,
provider credential, model or infrastructure is added here.

Boards verification on 2026-10-05 confirms AB#80, AB#81, AB#83, AB#112 and
AB#113 are Closed. AB#126 is Active; accepting this proposal does not complete it.

The existing public adapter and route/sitemap contracts determine eligibility;
Sanity's raw document shape is not a knowledge contract. Public content has stable
identity and locale, canonical routes, and effective publication/expiry rules.
The private-gallery boundary remains isolated (ADR-0014). Model memory cannot
establish what the current site offers or what a visitor may access.

## Decision

### Instructions and project-owned ports

Define project-owned `ChatAssistant` and `KnowledgeRetriever` ports. Their request,
evidence and answer types contain no Foundry, Search, CMS or model SDK types.
Foundry direct inference and Azure AI Search are the default adapters, with
deterministic and fault-injecting test adapters exercising the same contracts.
Exact generally available APIs, model/deployment and retrieval ranking strategy are
implementation-time choices verified against current official documentation.
AB#126's suggestion-only authoring API is not exposed to visitors.

Use three explicit instruction/data layers:

1. Application rules define allowed data, source requirements, privacy, refusals,
   output validation and absence of tools. The owner cannot grant additional access
   through prose. Enforcement of these boundaries occurs in application code.
2. A separately versioned, publishable owner profile supplies role, tone, supported
   topics, fallback and human handoff guidance. Validate size, links and supported
   options; use existing public contact settings for contact details. A profile
   cannot enable private retrieval, writes, unrestricted browsing or raw output.
3. Visitor input, client-supplied history and retrieved content are untrusted data.
   They never become system/developer instructions or authorization. Forged
   assistant turns in submitted history have no privileged role or evidence value.

The first version has no model tools, autonomous actions, private lookup or durable
personal memory. Profile changes have an editorial diff, a reviewed publish action,
and rollback to the previous version. Injection and escalation fixtures are required;
an instruction hierarchy alone does not guarantee model obedience.

### Knowledge projection and eligibility

Export text through a project-owned `PublicKnowledgeDocument`: stable page identity,
requested full locale, current canonical URL, public content revision, updated time,
projection version and bounded public text/chunks. Include a knowledge fingerprint
of the projection and current route. Do not substitute a raw CMS snapshot, `_rev`
alone or a template URL built from a translated label.

Eligibility requires the same published, renderable, canonical and indexable page
rules as the public route/sitemap boundary, including effective end dates and locale
availability. Deployments globally excluded from indexing do not enable public chat.
Only approved text fields enter the projection. Exclude drafts, releases, private
galleries, customer submissions, vote receipts, operational data, archive locators,
signed URLs, download credentials and CMS/provider internals. Image binaries, EXIF
and unpublished media text are unnecessary. Existing public eligibility is necessary
but the owner must also approve which public content classes enter the assistant.

Retrieved candidates are checked **before their text enters the model request**.
Batch-read an authoritative, uncached public eligibility projection for identity,
locale, current text revision/fingerprint, current canonical path and time-based
visibility. It exposes only the required public fields through a server-only port.
The implementation must demonstrate that this lookup does not reuse a stale route
or CMS cache. Do not equate Search index presence with publication authority.
On missing, mismatched, expired or unavailable eligibility, discard the candidate;
if authoritative checking fails, return the human fallback without inference.

After inference and before emitting an answer, recheck the selected sources. A
source revoked, moved or changed during generation makes the answer unavailable;
do not publish it with a replacement citation to different text. Public-to-private
change cannot retract content already sent while it was public: document the
bounded in-flight request window and provider handling instead of promising
retroactive erasure.

### Synchronization and freshness

Authenticated publish/update/unpublish/move/delete events enqueue idempotent,
revision-aware upserts or removals by stable identity and locale. A late event must
not restore an older revision. Category/path changes recalculate affected canonical
URLs even if a page document's own revision did not change. Reconciliation compares
the complete eligible public inventory and removes orphan index entries.

New or updated knowledge has a proposed p95 event-to-index target of 15 minutes.
Reconcile at least every 15 minutes; alert if a successful full reconciliation is
over 30 minutes old or the measured freshness target is breached. These values are
owner-review defaults, not measured service guarantees. Track both pipeline health
and actual lag; a successful empty webhook request does not establish freshness.
Removal safety depends on answer-time eligibility, not those lag targets.

A chunking/embedding/projection change creates a new index generation. Build and
evaluate it separately, verify the eligible inventory, then switch the configured
generation atomically and retain a rollback generation for a defined short period.
This is an application deployment requirement, not a claim about an unverified
provider alias API. Old generations have explicit deletion/retention handling.

### Answers, locales and visitor flow

Use the requested site locale for retrieval, UI and answers. A visitor's different
input language does not silently change the site locale. If local evidence is
insufficient, say so and offer human contact. Cross-language retrieval is an explicit
visitor choice labeled with the alternate language and canonical source locale;
never present it as a published translation.

Return escaped plain answer text and structured citation IDs. The server resolves
IDs only to the checked current canonical source URLs. Do not render model-authored
HTML, arbitrary Markdown links/images, or provider URLs. Unknown citation IDs,
unsupported claims or conflicting evidence cause an honest refusal/fallback.
Deterministic validation handles structure and URLs; groundedness also requires
evaluation and accountable review, not merely a passing JSON schema.

Chat opens only on visitor action and explains that it uses AI before sending text.
Provide localized controls, keyboard operation, visible focus, appropriate dialog
focus/return behavior and concise live status/error announcements. Avoid announcing
each streamed token. Respect reduced motion. Contact remains an ordinary link when
JavaScript, chat or providers are unavailable; no external script auto-loads.

### Privacy, operational limits and observability

Keep the transcript in browser memory for the open session, with bounded history
submitted per request. Do not persist it in cookies/localStorage, a server transcript
store or personal memory. Treat all submitted history as untrusted and warn the
visitor not to send sensitive data. Application logs exclude questions, answers,
prompts, retrieved passages, credentials and raw provider exceptions.

Abuse counters are separate operational data. Use short-lived keyed pseudonymous
client-address buckets from the established trusted request boundary, never raw
addresses in telemetry. Proposed bucket TTL is 15 minutes; store only counters and
expiry, with protected key rotation and deletion. Such keys are pseudonymous data,
not anonymous data. No tracking cookie or cross-site identifier is introduced.

| Proposed initial limit | Value / behavior |
| --- | --- |
| Question | 2,000 characters |
| Submitted history | 6 turns, 8,000 total characters; each turn bounded |
| Retrieved context | 6 chunks, 12,000 total characters |
| Output | 4,000 characters plus adapter token cap |
| Total request deadline | 30 seconds; no automatic generation retry in version one |
| Client request rate | 10 requests / 10 minutes, shared atomic buckets |
| Site-wide spend | Owner-configured daily maximum; disabled if absent |

All bounds are checked server-side, together with methods, payload size/type and
origin controls. Request admission reserves worst-case provider spend atomically in
a shared store before inference. Keep the reservation if usage is unknown; reconcile
known usage. Concurrent instances cannot each spend a separate daily allowance.
Select and verify the store/consistency and pricing bound before enablement; provider
budget alerts alone cannot enforce a hard cap. Add an owner kill switch, overload
fallback and rate/error messages. Additional bot challenges require evidence and a
separate privacy/accessibility decision, rather than an auto-loaded third party.

The privacy notice identifies AI interaction, controller, providers, processing
locations, purposes, operational counter retention, provider retention and human
contact. Application memory-only behavior is not provider zero retention. Foundry
deployment type and abuse monitoring need their own review. Search query diagnostics
can contain query text; review/disable such export or redact it before retention,
and disclose residual provider handling. Record processor/DPA and applicable AI
transparency review before launch.
[Foundry privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy),
[Search data/logging](https://learn.microsoft.com/en-us/azure/search/search-security-built-in)
(verified 2026-10-05).

Operational telemetry includes correlation ID, provider/model deployment, instruction
and profile version, knowledge/index generation, retrieval score/count and redacted
quality outcome, latency, usage/spend, success/refusal/error class. Hashes of short
questions or full transcripts are not a redaction strategy. Assign retention and
an accountable failure/freshness/budget alert recipient before rollout.

### Evaluation and implementation split

The project owner or designated editor maintains a versioned synthetic FI/EN fixture
dataset and expected public facts/citations. Normal CI runs deterministic projection,
eligibility, scorer and port tests without network/secrets. A protected cost-capped
live evaluation job gates model, prompt/profile, ranking and index-generation changes
before enabling them. Threshold changes require reviewed evidence, never silently
lower a gate to make a new model pass.

Required cases cover grounding, attribution, insufficient/conflicting evidence,
refusal, unpublish/delete/expiry/move during sync and inference, missed/out-of-order
events, prompt injection, forged history, multilingual fallback and provider failure.
Critical deterministic gates allow zero private-field leakage, invalid citation URLs,
revoked-source emission or tool/write action. Agree measured groundedness/refusal
thresholds and editorial rubrics before the first live rollout. No quality score
has been measured by this proposal.

After acceptance, split the story into reviewable slices without inventing new IDs:

1. Public knowledge contract, projection and authoritative eligibility tests.
2. Synchronization/reconciliation and generation lifecycle with freshness alerts.
3. Profile publication and neutral retrieval/chat ports with fault-injecting adapters.
4. Separate environment IaC, server-only provider identity/configuration, operational
   counters, budget reservation and protected evaluation pipeline.
5. Accessible visitor UI, constrained answer/citation rendering and privacy notice.
6. End-to-end and live failure/cost/freshness exercises, kill switch and owner handoff.

## Options Considered

| Option | Benefit | Cost / reason |
| --- | --- | --- |
| Neutral ports + projected index + answer-time checks (proposed) | Replaceable providers and enforceable publication boundary | Sync, authoritative lookups, evaluations and spend state |
| Send raw CMS documents to a provider-hosted agent | Less application plumbing initially | Leaks internals and adds tool/state authority without a public contract |
| Site FAQ/contact links only | Cheapest, private and deterministic | Remains the fallback; does not deliver AB#127's conversational requirement |

## Trade-off Analysis

Authoritative checks add bounded request work and can reduce availability during CMS
outages. They prevent a stale index from becoming permission to use withdrawn text.
A searchable index, instructions and citations cannot by themselves prove a correct
answer. No claim of immunity to prompt injection replaces code boundaries and evals.

## Consequences

This optional feature introduces model/search processing, operational state and cost;
it remains disabled until accepted, funded and verified. It is not a tracking tool,
sales system or private customer assistant. Existing public pages stay independently
usable. Current architecture diagrams do not gain a fictitious deployed AI boundary.

## Action Items

1. Owner accepts/revises this proposal and confirms predecessor readiness, including
   AB#126. Create implementation tasks only after that acceptance.
2. Agree content classes, provider/residency/retention, freshness and quality targets,
   numeric limits, spend cap and alert ownership; verify current GA provider APIs.
3. Implement and review the slices above, updating architecture/data-flow documents
   when boundaries actually change. No SDK or infrastructure commitment precedes
   acceptance. AB#127 stays Active; the roadmap story is not complete.

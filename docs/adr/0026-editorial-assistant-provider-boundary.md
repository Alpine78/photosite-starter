# ADR-0026: Provider-neutral editorial suggestions

**Status:** Proposed
**Date:** 2026-10-05
**Deciders:** Project owner, pending acceptance
**Work item:** AB#126

## Context

AB#126 prioritizes author-initiated translation, proofreading, clarity and tone
suggestions, with Microsoft Foundry as the default provider. The site remains a
customer-owned single-site application. AB#125's linked-draft creator and Studio
review guards exist, but its action UI and live authoring checks remain open.
[ADR-0008](0008-localized-authored-text.md) and
[ADR-0003](0003-public-content-tree-and-url-structure.md) own localized text and
content identity. A provider must not become a CMS field type or authoring authority.

This is a prerequisite proposal only. No AI port, model adapter, authoring endpoint,
evaluation gate, SDK, provider configuration or infrastructure is implemented here.
Existing application diagrams continue to describe the running system. Owner
acceptance must explicitly change this record to Accepted in a reviewed change
before a provider SDK, runtime dependency or infrastructure commitment is added.
Acceptance alone does not finish AB#126 or its AB#125 prerequisite.

## Decision

### Project-owned suggestion boundary

Define an `EditorialAssistant` port with translation, proofreading, clarity and
tone operations. Requests use project-owned content identity, source and target
locale, stable block keys, field roles, requested text and bounded operation options.
Tone options are editorial choices, not arbitrary provider system prompts. Provider
or OpenAI message/SDK types stay inside the adapter. No hosted agent or model tools
are needed for version one.

A server-mediated authoring gateway authenticates the editor and checks rights to
the specific document and operation before reading text or spending model budget.
It reads the saved source itself; client-supplied document snapshots are not authority.
The concrete Studio authentication integration and gateway hosting require their
own verified implementation plan. Do not reuse private-gallery customer capabilities
or the gallery administrator credential as CMS edit permission. If cookie-based,
enforce origin and CSRF protections. If that authorization cannot be established,
the assistant remains disabled.

Each result is a structured set of suggestions for exactly the requested text
targets, with operation, locales, source revision, stable target identity and
provider/deployment/prompt provenance. The server derives the permitted targets
from the current schema and field ownership. Unknown paths, block keys, locales or
operations are refusals. Shared media alt/caption fields cannot be changed through
a page request: report their ownership and use a separately authorized media-text
request if that scope is later implemented. No image binary, archive locator or
private-gallery asset is sent to the model.

Only explicit author acceptance applies text. Source text is never overwritten;
translation proposals address the linked target draft. Reject keeps the draft
unchanged. Existing author edits remain visible in the diff, never silently replaced.
Acceptance does not clear AB#125's localization-review markers or publish content.
Source and target locale, media/reference membership, ordering, sections, block
identity, links and inline marks remain intact. Model-proposed structural changes
or added/changed URLs fail validation. Slug/URL and canonical-placement changes are
outside first-version application; an editor handles them in ordinary authoring.

### Independent acceptance and stale proposals

Keep suggestion text and original target values in an editor-bound transient server
session, proposed lifetime 15 minutes. Do not put them in telemetry, a public dataset
or a durable suggestion history. Session-store provisioning and deletion on expiry
are implementation prerequisites; reload/expiry may require regenerating proposals.

At acceptance, read the current source and target server-side. Refuse a changed
translation source revision or changed target field/block identity, its original
value, ownership or structural context. A whole target-document revision is an
atomic write precondition, not the criterion for declaring every proposal stale:
accepting one field must not invalidate a still-unchanged sibling field. Re-read
after a revision conflict, compare that suggestion's original target value and
structure, and either submit a conditional patch on the current revision or refuse.
Bound that retry; never blindly replay a patch. The browser cannot supply or alter
the stored original value or authorize a new target.

This permits independent accept/reject without accepting changes over an author's
new text. The concrete suggestion/session wire format belongs in the implementation
slice and its race tests. Do not log before-text or a guessable hash of short text.

### Default provider and configuration

Use Foundry direct inference through a currently supported generally available
API, selected explicitly per environment. Microsoft's integration guide currently
directs new applications to the OpenAI v1-compatible route and states that the
Azure AI Inference beta SDK retired on 2026-08-26. Do not start a new integration
on that retired SDK or `/models` route.
[Microsoft integration guidance](https://learn.microsoft.com/en-us/azure/foundry/how-to/integrate-with-other-apps)
(verified 2026-10-05).

Exact model, version, endpoint variant, SDK or direct-HTTP implementation, region,
deployment type and token accounting must be reverified and recorded when the
adapter is implemented. Pin the evaluated configuration; prohibit unnoticed model
upgrades. A provider/model/prompt change requires explicit configuration and the
quality gate. No automatic cross-provider failover sends content elsewhere.

Keep execution and credentials server-only. Prefer workload identity and
least-privilege inference access where the selected host supports them. This ADR
does not claim that the current Vercel host supplies an Azure managed identity.
If supported identity cannot be established, document and review a scoped server
credential and rotation before enabling the feature. Reject browser-exposed copies
and contradictory provider configuration. A deterministic/fault-injecting adapter
is for isolated test environments and cannot be selected for production authoring.

### Privacy, cost and failure behavior

The owner must approve which text classes may leave the CMS, processors/DPA,
deployment geography and provider retention, including abuse monitoring. Model
statelessness is not a zero-retention guarantee. Global and DataZone deployments
have different processing boundaries; abuse monitoring can involve retained prompts
and human review. Review the actual deployment rather than inferring residency from
the resource's region.
[Microsoft data/privacy guidance](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)
(verified 2026-10-05).

Define hard per-operation input/output limits, editor rate limits and an atomic
site-wide spend reservation before inference. Neutral requests bound characters and
blocks; the adapter additionally enforces actual token/output limits. Reserve a
conservative maximum charge for every attempt; reconcile usage, retaining the
reservation if usage is unknown. Provider alerts are additional monitoring, not a
synchronous hard spend cap. Select the shared counter/session store and budget
values in the infrastructure slice before enablement.

Timeout, cancellation, throttling, malformed output, unauthorized access and budget
exhaustion leave all content unchanged. Bound the total deadline and attempts;
retry only transient failures within the same provider and spend reservation.
Redact provider exceptions before recording operational errors.

Telemetry contains request correlation ID, provider, deployment/model version,
prompt version, operation, latency, input/output usage or accounted units, outcome
and redacted error class. Exclude text, full prompts/responses, original-value
hashes, captions, names, credentials and provider exception bodies. Keep author
audit identity, if needed, in an access-controlled authoring audit with its own
retention decision; it is not general application telemetry.

### Evaluation and implementation gates

Use a versioned, synthetic or explicitly licensed Finnish/English editorial dataset.
The owner or designated editor owns expected facts, accepted terminology/inflected
forms and human-reviewed fluency/tone rubrics. Automated invariants include unchanged
names, numbers, dates, links, block keys, relationships and locales; they are useful
critical checks, not proof that a model never invents meaning.

Ordinary credential-free CI validates fixtures/scorers and exercises recorded
outputs plus deterministic/fault-injecting adapters through the same port contract.
A separate protected, budget-capped CI evaluation runs the live proposed model and
prompt before rollout or any model/prompt/provider change, with accountable editorial
review. Thresholds for faithfulness, grammar, clarity, terminology, tone and invented
facts must be agreed and recorded before enablement; no threshold or model quality
is claimed measured by this document.

Contract tests prove failure leaves content unchanged, reject injection/unknown
paths/changed links, enforce independent acceptance and revision races, and prevent
unauthorized inference. Import/lint/build checks prove secrets and adapters stay
server-only. Environment-specific IaC and pipeline stages must reproduce resources,
identity, secret isolation, budgets and evaluation settings without credentials in
public PR jobs. Run the normal repository gates on each implementation slice.

## Options Considered

| Option | Benefit | Cost / reason |
| --- | --- | --- |
| Neutral suggestion port + direct inference (proposed) | Replaceable model service, explicit author control, few dependencies | Requires validation, authorization, cost state and evals |
| Provider SDK throughout Studio/content model | Fast initial integration | Couples schemas/UI to SDK and obscures provider replacement |
| Hosted editorial agent | Useful for future multi-step tool tasks | Adds tools, state and authority unnecessary for text suggestions |

## Trade-off Analysis

Reviewable suggestions add an acceptance workflow, transient state and conditional
writes. They preserve content on every failed generation and keep the source of
truth with the author. A model switch still needs quality and residency review;
provider neutrality does not promise identical capabilities or costs.

## Consequences

No automatic translation publication, media mutation, conversation memory or public
chat follows from this decision. AB#127 owns its distinct visitor/retrieval boundary.
The first live adapter needs funded infrastructure and editorial evidence; an ADR
and a deterministic adapter alone cannot establish usable translation quality.

## Action Items

1. Owner accepts/revises this proposal and completes AB#125's authoring integration.
2. Implement the neutral port, allowlist/session and conditional-acceptance contract
   with deterministic and fault-injecting adapters; review Studio authorization.
3. Agree the versioned evaluation dataset and thresholds; select/reverify GA API,
   model, identity, region, processor retention and hard budgets.
4. Add environment-specific infrastructure, protected live CI eval and Foundry
   adapter; then implement the accessible diff and independent controls in Studio.
5. Verify live authoring, failure, replaceability and cost evidence before enabling.
   AB#126 stays Active until its complete acceptance criteria are met and accepted.

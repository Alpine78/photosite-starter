# AB#255 — Localized-content authoring preflight, 2026-10-12

This bounded offline continuation joins the preserved English category/service/article-copy proposals to actual authoring paths and remaining acceptance gates. It is not an import plan, CMS draft, fresh absence/revision inventory, executable writer or publication approval. AB#255 remains Active. Source baseline: `4382537` after PR #355 (CI #840) and PR #356 (CI #839). PR #356 merged externally before #355; this continuation began after both were merged.

## Retained proposal scope

| Kind | Retained local proposals | Actual authoring path / unresolved gate |
| --- | ---: | --- |
| Shared category | 1 | Manual shared-document editing must retain all Finnish values and stable identity. The existing category CLI uses createIfNotExists and cannot add English fields to the already existing category. |
| Services | 5 | Separate language documents share serviceId. Manual Studio editing or a separately reviewed exact CLI plan is required. The existing service CLI has a closed field set and cannot write coverMedia; local copy is not a complete media-enabled service document. |
| Articles | 2 | AB#125's owner-run linked-draft action preserves structure/media and tracks language review, but the second source contains a poll block and is rejected by the current planner as-is. A target-only poll substitution/removal needs separately reviewed support, or manual target authoring. Never change the FI source to bypass this guard. |

All eight proposals remain owner-pending. Both article proposals are complete only for their own article-text projection; media, canonical category, placements and the second article's language-specific poll remain dependencies. The two packets leave 16 of the original 18 missing-EN article identities without a local article-owned proposal. That is preparation coverage; the captured published missing-EN count remains 18 and is not re-measured here.

## Source-backed authoring limits

[Linked-draft planning](../../scripts/localized-draft-plan.mts) supports articles/galleries only, rejects existing target locale versions, keeps stable content identities and copies placement/media references. It reports missing target-language category and shared-media text and marks target-language review. A body containing any contentPollBlock is rejected before draft creation. [The owner command](../../scripts/create-localized-draft.mts) has no target-only poll override; creating an English poll alone cannot make this source plannable. The proposed copy packet intentionally retains the historical FI poll reference as pending evidence rather than pretending it is English.

[Service writer](../../scripts/write-sanity-services.mts) and [category writer](../../scripts/write-sanity-categories.mts) do exist, but they are closed owner-run createIfNotExists workflows, not arbitrary patch/update adapters. Their plan, identity, field, existing-state and explicit digest/write gates must be checked for any later actual use. This preflight neither invokes them nor mints a target document ID. Manual Studio editing is possible, but a documented path is not approval or publication-ready evidence.

## Identity and publication sequence

ADR-0030's approved domain map is immutable. [ADR-0031](../adr/0031-identity-migration-operational-plan.md) and the current complete AB#260 authority accept the first three implementation policies: permanent bounded aliases, legacy-writer retirement and a tested maintenance boundary. They do not approve a named isolated target, binary-copy accessibility, freeze, exact cutover, CMS write or Production deployment. New source reader implementation is not proof of configured/published alias payload, live writer guard, rehearsal or completed cutover. Check actual merged source rather than treating the ADR's historical implementation list as current deployment status.

Before saving any counterpart, obtain owner wording/slug/semantic acceptance and current source/draft/release identity/revision checks, then reconcile affected category/content/placement identities against the approved generation. Services' serviceId is outside the accepted domain rewrite, but source revisions, parent identity, existing target variants, cover/shared-media text and operational ordering still need review. New _rev observations are metadata, not newly approved writer guards. An _id rewrite would invalidate these retained joins; a matching label/slug is not a stable association key.

Recommended order after separate approval: accepted English category fields, service counterparts with their media semantics, first eligible article counterpart with reviewed references/placements, then the poll-bearing article once its target-only poll decision is implemented. Saving, publication, webhook propagation and Production verification remain separate. No automatic publication, machine translation or guessing missing media descriptions.

## Private receipt and verification

The ignored owner-only packet retains the exact earlier category/service/batch1 proposal bytes and a hash-verified batch2 copy, source-bound metadata and one eight-row authoring gate receipt. It always records writable:false, executable:false, publicationReady:false and ownerAcceptanceInferred:false. SourcePacket hashes identify inputs, not user acceptance. Earlier capture windows/revisions remain historical; no fresh CMS or draft/release absence guarantee is inferred.

Meaningful local checks cover original/copied proposal hashes, all eight kinds/ordinals and owner-pending states, invariant non-executable flags, actual source authoring paths/closed field sets and current authoritative policy/discussion. Local links, privacy and whitespace are checked. Application/Studio builds and delivery journeys are not rerun for this offline documentation-only slice. No new writer, dependency, runtime/schema/configuration change, CMS request/write, target ID, credential provisioning, deployment or activation occurs.

The owner instructed this continuation to proceed without Claude on 2026-10-12.
Codex completed the final source review; earlier plan reviews and the unsuccessful
external-review attempt remain historical evidence, not a pending release gate.

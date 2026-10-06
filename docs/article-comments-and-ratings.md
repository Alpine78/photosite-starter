# Article comments and reader-rating requirements

Refinement worksheet for AB#194 under AB#26 and Feature AB#92. Comments and
reader ratings are independent post-MVP decisions, neither implemented here.
AB#26's historical title still mentions polls; its current description excludes
that completed scope. AB#162 already provides voting and frozen historical
results ([ADR-0018](adr/0018-article-poll-voting-storage-and-dedup.md)).
Do not bring the legacy poll inventory into these new use cases.

## Comment decisions

| ID | Question to resolve | Required decision or evidence |
| --- | --- | --- |
| C1 | Is a comment system worth maintaining? | Compare no feature, an email/contact route, and an explicitly activated external service with a site-owned system. Automatic third-party embeds conflict with the existing privacy boundary. |
| C2 | Who may comment and what is collected? | Decide identity/anonymous policy, visible name, optional contact data and impersonation limits. A browser token is not proof of a person's identity. |
| C3 | Who moderates, when and with what workload? | Define pending/published/rejected states, abuse reports, escalation, cover during owner absence and removal of already-published material. |
| C4 | What interactions are required? | Decide flat comments versus replies, language handling, commenter edits/deletion and any owner notifications. Separate essential features from optional conveniences. |
| C5 | How is abuse bounded? | Choose request/body/rate bounds and spam handling only after the use case is accepted. An external spam filter adds a processor requiring its own review. |
| C6 | Who stores and receives the data? | Decide datastore, write authorization, notification delivery, operational logs and processors. Neither public Sanity content nor the poll write credential is automatic permission to store comments. |
| C7 | What are the lifecycle and visitor controls? | Define retention, erasure requests, backups, deletion of an article and how a commenter can exercise the accepted controls. No retention period or legal basis is selected. |
| C8 | What is accessible without or with JavaScript? | Define server-rendered reading, labelled submission/validation, focus and status messages, keyboard operation and refusal behavior. |

## Reader-rating decisions

| ID | Question to resolve | Required decision or evidence |
| --- | --- | --- |
| V1 | Should readers rate an article at all? | Compare no feature with a narrowly defined owner use case; decide separately from comments. |
| V2 | What is the scale and public result? | Decide whole/fractional steps, aggregate and count, minimum display threshold and correction/retraction behavior. Structured-data/search claims require separate scope. |
| V3 | Who may vote and how often? | Define anonymity, repeat-vote handling and change-of-vote semantics; explicitly accept or mitigate ballot stuffing. |
| V4 | What state is needed? | Decide datastore, atomic updates, deduplication, credentials, logs and retention. ADR-0018's per-poll receipt/cookie limits repeated voting; it does not establish personal identity or prevent a determined voter resetting browser state. |
| V5 | How is the interaction understood and operated? | Consider a labelled radio group and textual result rather than colour-only stars; decide no-JavaScript reading, submission states and keyboard behavior. |
| V6 | What is the owner cost and data review? | Decide moderation/abuse effort, processor review, deletion/retention and whether any client persistence is acceptable before choosing it. |

## Unapproved candidate slices

A comment decision/spike may precede one moderated submission and reading story,
then a separate lifecycle/abuse story. A rating decision/spike may precede one
bounded vote and results story, then a separate repeat-vote/correction story.
Each implementation story needs its own explicit criteria, data-flow review and
any required ADR. Accepting one use case does not approve the other.

This worksheet adds no login, cookie, endpoint, schema, SDK or datastore. Existing
poll behavior stays governed by AB#162 and its [data-flow record](poll-data-flow.md).

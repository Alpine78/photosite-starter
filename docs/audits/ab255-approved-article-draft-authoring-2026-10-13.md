# AB#255 — approved English article editing drafts

The owner accepted the complete 18-article FI/EN workbook and creation of English
CMS editing drafts on 2026-10-13. The subsequent decision explicitly retains
historical polls only in Finnish: omit their blocks from English drafts without
changing source articles, poll documents or votes. Neither decision authorizes
publication, acceptance of other copy packets or new album-image descriptions.
AB#255 and the linked authoring story AB#125 remain Active.

## Verified result

| Observation | Result |
| --- | --- |
| Approved article texts | 18 complete translations, bound to the accepted workbook and proposal packet hashes |
| New EN article editing drafts | 18 |
| New linked end-gallery placement drafts | 644, preserving source occurrence identities, order, visibility and media references |
| Removed EN poll blocks | 23 blocks across 16 articles; no target polls created |
| Remaining target body blocks | 1,371, preserving non-poll block identities and approved text |
| FI article and placement documents | Full raw documents and revisions match the pre-write baseline |
| Referenced poll documents and tally/receipt records | Match the pre-write baseline |
| Shared media and categories | Referenced documents/revisions match the pre-write baseline |
| Image/file assets | Counts unchanged; no upload, replacement or duplication |
| Published articles | Match the pre-write baseline; no publication |

All mutations were strict `create` operations for deterministic `drafts.` IDs,
one complete article and its placements per transaction. Every transaction was
checked against the current source and existing targets before writing; created
documents were read back and compared with their exact plans. A final read
verified the full source and published baseline. No existing document was
patched, replaced or deleted. No ambiguous write was retried.

## Draft-parent reference correction

The initial provider dry run rejected placement references to an unpublished
target parent with HTTP 409. The AB#125 planner used a strong reference to the
parent's future published ID, which does not yet exist. This branch uses Sanity's
temporary `_weak: true` reference with `_strengthenOnPublish: { type }` for the
new placement's parent only. The reference still names the future published ID;
the existing strong Studio field restores a strong reference when the placement
is published after its parent. Media references and schema strength are unchanged.
See [Sanity's reference documentation](https://www.sanity.io/docs/studio/reference-type).

The corrected 18 transactions passed the provider's `dryRun` validation before
the actual creates. [Mutation API reference](https://www.sanity.io/docs/http-reference/mutation)
documents strict-create collision refusal, `dryRun` and synchronous visibility.
Article and gallery planner regression assertions cover the temporary parent
reference and its correct target type. The general planner still rejects inherited
source-language polls; target-only omission is confined to this owner-approved
private authoring run.

## Validation and remaining work

Focused planner/HTTP/placement tests: 99 passed. Full browser-free suite: 5,764
passed. ESLint, the application production build and Studio typecheck/schema
validation/build passed. The first application build lacked worktree deployment
settings; the successful repeat used the pipeline's synthetic mock configuration.
No browser journey was needed for this pure authoring-plan correction. A logged-in
Studio check and publication remain separate work; source tests do not establish
live Studio usability.

Editing-review metadata and publication notices remain in the drafts. The missing
published EN canonical category and editor/media review still gate publication.
General album-image captions and alt texts remain deferred after MVP; existing
image text was copied as an explicitly pending editing base, with no new authored
image descriptions. Services, category copy and gallery proposals require their
own acceptance before CMS authoring.

The owner workbook, proposal text, connection binding, snapshots, draft plans,
individual transaction receipts and final verification are kept only in ignored
private local directories. The completed public-copy worktree was retired on
2026-10-13 after preserving its accepted workbook and original receipts in the
ignored local worktree-preservation archive; the authoring worktree retains the
write plans and verification. Credentials remain solely in the local ignored
credential file and process memory; they are absent from Git and receipts.

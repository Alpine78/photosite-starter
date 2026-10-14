# AB#286 — preserve story-root content in the locale census

AB#286 moved New → Active before changes under AB#255. A fresh complete Production
snapshot after accepted article publication exposed four false
`PUBLISHED_CATEGORY_MISSING` blockers. All four galleries explicitly declare
`canonicalAtStoryRoot=true` and have no canonical category. Both the existing Studio
schema and `content-tree.ts` permit this placement under ADR-0003; content needs no
mutation. The original refused census and complete snapshot stay in private evidence.

The offline census now skips category ancestry only for an explicit boolean `true`
with an absent/null category. It reports a root/category conflict when a category is
supplied, and malformed nonboolean root flags remain blockers even with a valid category.
Ordinary categorized content still requires published same-language categories and
valid ancestry. Missing flags, string `true`, malformed/missing refs, pending editor
review and duplicate identities cannot bypass their existing refusal boundaries.
Coverage, snapshot digest, language validation and non-publication/non-acceptance flags
remain unchanged. There is no application route, schema, CMS, provider or credential change.

Claude's one requested tool-free plan review was attempted with the authenticated pinned
reviewer. Its weekly limit is exhausted until **2026-10-15 07:00 Europe/Helsinki**;
no substantive plan or diff review occurred. The owner's earlier instruction made Claude
optional when unavailable; this small reversible audit fix therefore proceeds with
Codex self-review and explicit regression gates, without claiming the parent's requested
Claude review is satisfied. AB#255's complete acceptance remains open.

The fresh snapshot contains all 28 article, 32 gallery, eight service and 12 category
FI/EN identity pairs without missing published counterparts. The corrected census
is run on those exact preserved bytes, not a filtered or rewritten snapshot. Counts
establish publication coverage, not translation quality or final hosted acceptance.
AB#286 remains Active pending owner review/merge; AB#255 remains Active.

Validation: ESLint, all 6,075 offline tests and a production build with current real-CMS read configuration pass. The exact complete 17,614-document / 5,158-asset snapshot now produces hasBlockers=false with every FI/EN family count unchanged and no publication authorization. Its raw SHA-256 is c2cd3b61002c1b47af051001a9ca01723ab53087e2eaa995bbf4783415ef9f80.

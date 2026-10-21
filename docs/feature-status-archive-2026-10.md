# Feature implementation status — archived block (2026-10)

Moved verbatim from [`feature-status.md`](feature-status.md) on 2026-10-20 (AB#381) to keep the
running status file smaller. It is the contiguous block that began at the AB#331 entry
(2026-10-17) and continued with older, unheaded entries for AB#137, AB#117, AB#18, AB#132 and
others. Nothing was edited; search it together with the main file.

### AB#331 — lockfile-bound scheduled audit capture (2026-10-17)

After owner merge of AB#329, a bounded POSIX wrapper now captures root and
Studio JSON audits between exact lockfile digests and reuses the unchanged
triage projection. Current build/attempt-specific artifacts contain only safe
reports and a manifest committed last, with readiness/cancellation publication
guards; raw paired data is private and temporary. Info-only stays findings with
gate exit 0, preserving the existing low threshold. Synthetic subprocess,
filesystem, privacy and pipeline tests exercise bounds and cleanup without a
registry call. AB#331 moved New → Active before edits and awaits final review
and accepted merge. No automatic dependency fix, new service or notification
acceptance is implied; committed scheduled/live cancellation evidence and
AB#160's operational acceptance remain open.

**Saved audit summary preparation, 2026-10-06 (AB#204, Active):** an offline
npm v2 reader validates the reference graph and separates affected package entries
from unique numeric advisories. No dependency fixes or residual-risk acceptance
are implied; AB#160/186 remain open.

**AB#358 follow-up, 2026-10-18:** saved audit summaries now inspect the opened
descriptor and refuse nonregular or oversized input before reading. POSIX
nonblocking open avoids waiting for a FIFO writer; ordinary-file symlinks,
UTF-8/byte limits, redacted output and exit statuses are preserved. Actual CLI
tests use synthetic saved reports without registry calls. This correction is
Active pending review/merge; AB#160's operational acceptance remains open.

**AB#160 check, 2026-10-19 (Active):** Dependabot alerts/security updates are enabled and
PRs flow. Open alert #66 (`sprintf-js`, Studio lockfile only, no patched version) is
an owner-accepted temporary residual until 2026-11-19. **Notification delivery is not
demonstrated:** no email newer than 2024 for this repository was found, so that
acceptance criterion stays open. Recorded in the
[security review](security-privacy-review.md#dependency-alert-check-and-temporary-residual--2026-10-19-ab160).

**Merged dependency verification, 2026-10-07 (AB#186, Closed):** owner-reviewed
PR #281 merged and exact main CI #655 passed quality gates and the real protected
Preview deployment with the remediated CLI tree. AB#186 was explicitly moved
Active → Closed; the earlier candidate/audit entries below remain dated history.
[Current evidence](audits/ab137-renderer-readiness-2026-10-07.md#merged-source-and-dependency-gate).
AB#117 retains its own live launch review and is not closed by dependency remediation.

**Dependency remediation candidate, 2026-10-07 (AB#186, still Active):** full
`npm audit` moved from 25 high affected package entries to zero; production
remains zero. Narrow CLI-tree overrides lift Undici 5.28.4/5.29.0 to 6.29.0,
removing the old Busboy dependency. Since no upstream braces fix is published, a
documented, tested local `braces` fork caps parser nesting at 100. Clean
`npm ci`, `npm ls`, lint, all 4,642 unit tests, production build and the E2E
suite pass. Authenticated Preview verification remains open because the
Undici major substitution changes Vercel CLI's dependency contract. AB#186 is
still Active; no merge, deployment or owner risk acceptance occurred.
[Dated evidence and raw reports](audits/ab186-dependency-review.md#2026-10-07-remediation-candidate--full-audit-clear-ab186-remains-active).

**Dependency audit refresh, 2026-10-05 (AB#186, still Active):** the unchanged
merged lockfile now reports 25 high affected package entries across undici,
busboy and braces; production-only audit remains zero. These counts include
parents and do not establish 25 exploits. Current published versions do not
provide a verified compatible remediation for all three families. The
[dated evidence and proposed October 13 residual decision](audits/ab186-dependency-review.md#2026-10-05-audit-refresh--new-tooling-families-no-package-change)
record actual consumers and exclusions in a fresh exact-source prebuilt artifact.
No package or pipeline changes, accepted residual or public promotion are claimed.

**Dependency follow-up, 2026-10-02 (AB#186, still Active):** the merged CLI
reclassification and Azure drift fix already use one development-only,
lockfile-pinned Vercel CLI 61.0.0. The current follow-up pins Next.js and its lint
config to 16.3.8, refreshes brace-expansion within existing ranges, and updates
undici's old 5.28.4 consumer to 5.29.0. Fresh full audit: 12 → 10 affected package
entries (0 critical, 1 high, 9 moderate afterward); production-only audit: 0.
An isolated CLI 62.1.0 comparison retains the same thirteen undici advisory IDs.
[Raw reports and exposure/override evidence](audits/ab186-dependency-review.md)
record accountable ownership and the 2026-10-13 review deadline. These residuals
are proposed, with no owner acceptance or Production promotion. AB#186 remains
AB#117's predecessor, and AB#132 remains AB#18's predecessor; a successful
fixture gate alone closes neither launch decision.

The production security and privacy launch review itself (AB#117) is built: security
response headers (CSP, HSTS-adjacent, framing, MIME-sniffing, referrer, permissions —
ADR-0011, `docs/security-privacy-review.md`), a dependency-vulnerability remediation
(`npm audit fix`, 6 high-severity findings to 0), and the review document walking all
8 acceptance criteria against evidence. Two criteria were only partly closeable at the
time of that review: AC3's live Vercel/Resend account verification and AC5's live Sanity
asset-store audit both named the same AB#116 gap now closed above. `docs/security-privacy-review.md`
and `docs/contact-data-flow.md` were re-checked on 2026-08-25 against the now-live
Preview infrastructure (AB#116's closed Vercel deployment, AB#83's Preview Sanity
wiring), and each carried-forward item split rather than closed outright, in different
ways for the two accounts. Vercel: partially run, not just re-scoped — an earlier draft
wrongly claimed this session had no Vercel CLI/API access; corrected after actually
checking, since the repository-pinned CLI is already authenticated on this machine.
Team membership checked live: one member, `OWNER` role, so "limit seats" is trivially
satisfied for the environment that exists today. That check surfaced a real finding —
the team's `billing.plan` reads `"hobby"`, not the `"pro"` ADR-0004 §1 and every
deployment doc assume for Production. **This closes a Preview-account inspection, not
a Production hosting-tier decision.** The owner's decision, 2026-08-25: Hobby remains
in use for development and Preview; no decision has been made to use Hobby for
Production, and the Production tier is unresolved, to be reconsidered immediately
before AB#18. ADR-0004's original Decision (Pro) remains the authoritative Production
plan for now — this re-check does not change it and does not grant a Hobby exception
for Production. (An earlier draft of this paragraph stated the opposite — a settled
decision to keep the whole reference deployment on Hobby, matching Vercel's
non-commercial fair-use terms; that was wrong and was corrected at the owner's
direction before any of it was committed.) PhotoSite Starter as software is
unaffected either way — the starter remains the same generic, commercial-capable
template it always was, and a photographer's clone actually run as a paid business
still needs Pro or Enterprise, unchanged. Recorded as
[ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s
2026-08-25 amendment (which also records the verified Preview facts — Hobby's Runtime
Logs retention is one hour, not the one-day Pro figure this ADR states for Production;
Hobby has no RBAC at all — without rewriting the ADR's original Decision) and as
comments on AB#117 and AB#18, including a correction of the earlier overstated
framing. **That correction is not scoped to a future Production choice: the
interpretation risk applies to the current Hobby-on-Preview usage too**, since
Vercel's fair-use rule turns on the deployment's purpose, not its Preview/Production
label — "no live Production deployment yet" does not by itself settle it, given this
repository's dual purpose as a professional software portfolio. The owner accepts this
as an open risk for as long as Hobby remains in use, not proof of Vercel
Terms-of-Service compliance. Vercel Support's explicit confirmation would give
certainty for Preview too, and becomes mandatory specifically **if Hobby is later
proposed for Production** (one of two options AB#18 will choose between; not decided).
**If Pro is chosen for Production instead** — this ADR's original Decision — that half
of the analysis becomes moot for Production, though it does not retroactively resolve
whatever period this team spent on Hobby beforehand.

Sanity: this one was actually run too, not just re-scoped. Two earlier drafts of this
re-check wrongly claimed the identifiers couldn't be retrieved — first blaming a
missing credential (wrong: `preview` is public, no token needed), then blaming the
Azure Pipelines variable group (wrong system: `docs/deployment.md` puts these in the
Vercel project's Preview environment). Both were corrected by actually checking:
`.vercel/.env.preview.local`, a gitignored file already on disk from AB#83's own
provisioning work, carries the real values (project id and dataset `preview`,
public — the project id itself stays out of this repository per
`docs/sanity-setup.md`'s ownership boundary, the same as every other Sanity credential;
it is recorded against AB#83 in Azure Boards). The first live,
unauthenticated query (2026-08-25) found exactly one published document,
AB#83's own `webhook-test-1` webhook-verification artifact, and zero
published image/file assets. **A prior draft of
this same paragraph claimed adding `perspective=raw` "confirmed" no draft exists in
this dataset — wrong, retracted after checking Sanity's own access-control
documentation directly**: dataset public visibility grants unauthenticated read access
only to root-level, non-dotted document IDs; a `drafts.<id>` document is hidden from an
unauthorized client regardless of dataset visibility or perspective, so this session's
read cannot rule drafts in or out. What it could show — no published document beyond
`webhook-test-1`, no published asset — was genuinely clean, and separately, that one
document was not harmless: its null `slug` would make `sanity-services.ts` throw for
the whole services listing the moment a route read Sanity services against this
dataset. The owner deleted it on 2026-08-25; a second unauthenticated `GET` through
Sanity's non-CDN API returned a successful canary, `null` for the exact id, and zero
published root documents. The draft check is now closed: a later authenticated
raw-perspective query (2026-08-25, same day) found zero `drafts.*` documents, with the
dataset's only rows being Sanity's own internal `system.group`/`system.retention`
records rather than customer or seed content. A further evidence check also
corrected the earlier claim that AB#84's 448-document seed run had landed in an
unidentified dataset: PR #62 explicitly says its write-enabled CLI was not run against
an external dataset, and no later owner run is durably recorded. The owner accepted the
finding on 2026-08-25 and reopened AB#84, which has since **closed** on the evidence
below. That run happened the same day, against this same
Preview project and dataset: a temporary, Editor-role `SANITY_SEED_TOKEN`, minted by the
owner for this run only and revoked immediately after, drove `npm run seed:sanity -- --yes`
to write exactly 448 `seed--` documents and upload the 6 demo-photograph assets, and
all 8 of the script's built-in live-verification checks — both singletons, the
category/service/article
counts, the archive gallery's full 400-row placement window, the featured gallery's two
sections, and the cross-gallery shared-media placement — reported `PASS`. A follow-up
count confirmed no unrelated or malformed document remained: every non-`seed--`
document in the dataset was either a Sanity-internal `system.*` record or one of the
six expected image assets. AC5's audit now has a real, evidenced target — this Preview
run, recorded on AB#84. `docs/sanity-seeding.md`'s _Production handoff_ section is this run's
distillation into the exact command, inputs, verification, and rollback path the later
Production launch seed inherits. A codex-review-loop round on that handoff caught a real
gap the run's own two verification layers left open: AC3 requires _representative
repository adapter queries_ against Content Lake, and neither the offline adapter test
(which fakes the store) nor the seed script's own `--yes` step (hand-written GROQ, not
adapter code) actually is that. `src/lib/sanity-live-verification.test.ts`
(`npm run verify:sanity-live`) closes it: a third, opt-in, non-`npm test` suite that
exercises the real `src/lib/sanity-*.ts` adapters — settings, home, services,
categories/content tree, articles in every language they were actually published,
gallery sections, media projection, sibling and placement ordering, and the full curated
gallery's cursor chain page by page including the page-size boundary — against the same
live Preview dataset, using a real `SanityClient` and the existing Vitest `server-only`
stub, and all of it passed. It was Preview-only as built (a hardcoded read of
`.vercel/.env.preview.local`) and, like every other Sanity adapter test, reaches no route
or component. AB#138 (2026-08-26) closed a prerequisite gap this section's own
"unimplemented future work" once named for AB#137: `verify:sanity-live` now resolves its
target env file through `src/lib/sanity-live-verification-config.ts`, defaulting to the
same Preview file but overridable via `SANITY_LIVE_VERIFICATION_ENV_FILE`, and refuses to
assemble a hybrid target from an incomplete file plus ambient environment variables. It
remains a fixture-verification suite, not a generic health check — its assertions are
still AB#84's exact fixture values, so it only proves anything against a dataset seeded
with that same fixture, Production included. For a Production dataset carrying different,
owner-approved launch content, AB#138 also added a separate read-only content audit tool
(`npm run audit:sanity`, `scripts/audit-sanity-content.mts` and `scripts/sanity-audit.mts`,
transport in the newly split-out `scripts/sanity-read-http.mts`) that makes no assumption
about specific content: one bounded, keyset-paginated, `raw`-perspective scan over the
whole dataset, classifying every document as published, draft, or a release version by id
shape rather than a known-type allow-list (so an unexpected or obsolete document is
listed, not silently omitted), listing every document and every image/file asset
individually by id — a count alone cannot answer "is any of this actually approved
launch content?" — with each asset's dimensions, and reporting only the _presence_ of the
two fields it treats as private/internal (`archiveLocator`, `capturedAt`) — never a value,
matching the same never-log-sensitive-values posture the rest of this project's Sanity
boundary already holds. The asset-filename and private-field checks are scoped to their
real types (`sanity.imageAsset`/`sanity.fileAsset`, `media`), so a coincidentally
same-named field on an unrelated type is never misreported as one of them, while the
unfiltered per-type scan still surfaces that type either way. It fails closed on missing or ambiguous `--project`/`--dataset`/`--api-version`
configuration (flag and environment variable disagreeing is refused rather than guessed),
needs only a Viewer-role `SANITY_AUDIT_TOKEN` (verified against Sanity's own documentation:
reading drafts and releases requires authentication but no stronger role), and both new
offline suites (`scripts/sanity-audit.test.mts`,
`src/lib/sanity-live-verification-config.test.ts`) run under `npm test` against a fake
transport, reaching no live project. AB#138 is scoped entirely to this reusable tooling —
it does not itself connect to, seed, or audit any real Production dataset — and is a
recorded predecessor of AB#137, which still owns the real Production run once a real
customer-owned project, owner-approved launch content, and a temporary credential exist.
The Resend-account items
(DPA, data-residency/retention terms) are unchanged in one sense — this deployment's
own configuration still shows no Resend account wired in, and whether one exists at
all is unverified — but their sequencing is no longer
open: **owner decision, 2026-08-25, recorded as a comment on both AB#117 and AB#18:
provisioning the Resend account and completing this ownership/DPA/retention review
is AB#117's own prerequisite work, done before AB#18, not something AB#18's
production provisioning produces.** AB#117's acceptance criteria are not weakened or
deferred by this — AB#117 owns getting the account and running the review, in full;
AB#18's own scope narrows to match, wiring the _already-reviewed_ account's secrets
and sending domain into Production and verifying delivery, not provisioning or
reviewing the account itself. The account has not been provisioned yet — that is a
real third-party signup only the site owner can perform, not something this
repository's tooling does — so the item stays open, now with a decided owner rather
than an unresolved circularity.

**Launch worktree retirement, 2026-10-13 (AB#281, Active):**
[Nine exact-head merged checkouts were retired](audits/ab281-worktree-preservation-2026-10-13.md)
after preserving 10,568 private files (5,293,992,766 bytes) with verified hashes,
modes and timestamps. Open and unmatched local heads remain. Historical packets
and branch refs are retained; this cleanup proves no Production recovery.

**Mailbox recovery preparation, 2026-10-06 (AB#202, Active):** the
[blank recovery worksheet](mail-recovery-evidence.md) separates two independent
accounts, local message copies, full DNS exports and exercised recovery. Actual restore,
account/contract decisions and the alternate legacy SMTP dependency remain open in AB#131.

The recipient-mailbox item turned out not to share that blocker on
inspection: Resend is only the delivery transport into a mailbox, not what creates
one, and AB#116's own provisioning record shows the site owner already operates a
real mail service independent of this project — so confirming that mailbox's
retention practice is answerable now, without a Resend account. Do not assume either checklist is
complete because an infrastructure gap closed — read the 2026-08-25 re-check sections
in both documents before treating any of AC3 or AC5 as done.

**Skill provenance preparation, 2026-10-06 (AB#207, Active):** two vendored
source commits and reproduced CRLF folder hashes are pinned;
[skill-provenance.json](skill-provenance.json) distinguishes original and local
adaptation bytes. NOTICE/licences remain; AB#42/43 distribution decisions stay open.

The repository's architecture is also drawn, not only described: `docs/architecture/`
holds the system context, the application and data boundaries, and the build/deployment
flow as authoritative D2 source with committed SVG renditions, rendered by an
exactly-pinned engine and gated by `npm run diagrams:check` so a stale picture fails CI
rather than misleading a reader. Anything not operating yet is drawn as such.

The curated gallery's grid is now one of three selectable layouts (AB#157): the existing
row-major `grid`, a new order-preserving `masonry`, and a new prefix-stable `justified`
row layout — each independently pairable with a `below` or `overlay` caption placement, all
six combinations offered. Both settings are authored site-wide (`SiteSettings`) and
optionally overridden per gallery, each field clearable on its own; an absent value falls
back to `grid`/`below`, so an existing deployment renders unchanged. One seam,
`effectiveGalleryPresentation` (`src/lib/gallery-presentation.ts`), composes the two levels
for both the mock fixture layer and the Sanity adapters, so they cannot disagree; an unknown
stored value is rejected as malformed content (`readGalleryPresentationFields`) rather than
silently downgraded to a default or passed through as an unrecognized CSS class, and the
rejection path itself does not trust a non-throwing `reject` callback to have actually
stopped execution — an invalid value is never cast and returned regardless. The Sanity
schema (`sanity/schemas/gallery-presentation.ts`) contributes the same two optional fields
to both `siteSettings` and `gallery` through one shared field builder
(`galleryPresentationFields(inherit)`); its own validation lists are necessarily a second,
independent literal copy of the two allowed-value sets (Studio schemas import nothing from
`src/`), so a test drives the Studio validator itself against `GALLERY_LAYOUTS`/
`GALLERY_CAPTION_PLACEMENTS` to catch the two ever silently drifting apart.

`masonry` (`src/lib/gallery-masonry.ts`) has no rows, so "row-major" does not by itself
define an order in it, and this is exactly the property the CSS multi-column masonry
`GalleryGrid`'s own history already rejected once (a column-major reading order the
lightbox, keyboard, and source do not share) — reintroducing masonry therefore had to name
and prove a real order, not merely avoid regressing to that one. Its progression rule:
items read by ascending top edge, and items whose top edges land within one CSS pixel of
each other read left to right — matching DOM order, keyboard order, and the lightbox
sequence exactly, at every column count. The server places every item without knowing the
visitor's viewport: each item's top edge is a sum of column-width multiples and `rem`
multiples, so dividing through by the column width makes it linear in `ρ = rem⁄columnWidth`,
and each column-count band (`MASONRY_BANDS`: two columns from a 34rem container, three from
56rem, capped at 69rem) bounds `ρ` to one closed interval — a linear inequality holding at
both ends of an interval holds throughout it, so checking the rule at the two endpoints
proves it for every root font-size that band can render at. Plain shortest-column placement
does not survive appending past that same guarantee (a column the rule would refuse to grow
into stalls forever once one item skips it), so a candidate column's start is instead raised
to the chord through the pointwise maximum of its own bottom and the rule's floor at both
interval ends — every column stays reachable, at the cost of a little whitespace where a
band's own width range left a column's relative height ambiguous. Placement depends only on
the items already placed, so `placeMasonry` accepts a previous call's own result as an
optional `resume` argument and places only what is new — proven equal to a full
recomputation by property test — which is what keeps `GalleryMasonryList` doing work
proportional to an appended slice rather than to the whole list loaded so far on every
continuation. `justified` (`src/lib/gallery-justified.ts`) is the simpler, already-familiar
shape: greedy rows closed as soon as they would fill the band's width at a fixed maximum
height, prefix-stable by construction (a closed row's boundary never depends on what comes
after it), with the identical `resume`-and-reuse contract for its own append case.

**Curated-image progressive enhancement, 2026-10-18 (AB#348, Active):**
A curated photograph without a native caption action stays a passive full-frame
image before hydration and without JavaScript. Existing native full-caption
popover buttons remain keyboard-operable; their existing credit contract elsewhere
is unchanged. Enhancement restores the current real-button lightbox trigger, and
an activation never cancels the native caption action while the viewer is unavailable.
Body and mini-gallery figures keep their separate existing enhancement contract.
The curated test helper follows occurrence identities within `#gallery`, including
passive images, while retaining exact result order and continuation boundaries.
Enhanced end-gallery row measurements wait for all 24 real image controls before
sampling; scriptless rendering and exact geometry/append assertions stay intact.
Implementation is in review; this does not close the parent gallery work.

Both new layouts, and `grid`'s new `overlay` caption option, share one figure component
(`GalleryFigure`, `src/components/gallery-figure.tsx`) rather than three independent
caption implementations. A caption always renders `below` regardless of the authored
placement once an image is too low (over `GALLERY_CAPTION_OVERLAY_MAX_RATIO`, 4:1) to hold
two readable lines over itself — one predicate, `resolvesToBelowCaption`, decides this for
both `GalleryFigure`'s own render and `GalleryMasonryList`'s reserved-height math, so the two
cannot drift apart. Every bounded caption also carries a same-origin, scriptless, native
`popover`-backed full-text fallback, reachable by activating the image trigger; hydration's
own `preventDefault()` routes an activated trigger to the lightbox instead once JavaScript
is running, so the popover is specifically the pre-hydration/no-script path, proven as such
(`e2e/gallery-layouts.spec.ts`, with `javaScriptEnabled: false`). A justified row can still
squeeze an extreme-ratio image (a tall portrait beside a panorama) to only a few rendered
pixels wide — measured in both engines, `-webkit-line-clamp` does not merely fail to
truncate gracefully at that width, it stops capping the caption box at all, painting real
text far past the figure — so `GalleryFigure` is its own CSS container
(`container-type: inline-size`) and drops the resting caption below a 3rem figure width
entirely, keeping the same popover as the only, still fully reachable, access path.

Neither new layout's `sizes` hint can track a visitor's own enlarged root font-size, a
platform limitation rather than an oversight: a `sizes` media condition's length —
`px` or `rem` alike — resolves against the browser's *default* root font-size, never a
page's own CSS-overridden one (media queries resolve relative units against the initial
value specifically to avoid depending on the very cascade they could influence), even
though `MASONRY_BANDS`'/`JUSTIFIED_BANDS`' real container queries do shift with it. A
per-column-count `sizes` branch was tried and measured wrong twice — soft at a 200% (32px)
root the first time, and wrong again at the exact viewport its own revised "two columns is
now safe" branch was meant to start from, because a container-query boundary carries
sub-pixel/scrollbar slop no hand computation can predict. Both profiles now request
`calc(100vw - 32px)` unconditionally: a column can never be wider than its own container,
so this is always a safe upper bound, whatever the real column count turns out to be,
proven across a viewport × root-font-size matrix in both engines
(`e2e/gallery-layouts.spec.ts`) rather than asserted from arithmetic alone. The two
synthetic extreme-ratio boundary photographs this exercises (a panorama and a portrait,
`src/lib/mock-gallery-boundaries.ts`) are sized at the largest resolution their ratio can
hold under this project's own 2048px public-derivative ceiling (2048×256 and 256×2048) —
their original 128px-short-edge versions were small enough for `next/image`'s optimizer
(which itself never upscales, confirmed against a real request) to leave the *browser's*
own `w-full` CSS stretching them visibly soft once measured.

`docs/gallery-presentation.md` is the full account: the placement rule, the responsive-
sizing bound above, the caption-access mechanism, and the inheritance model. No ADR was
needed — the one order contract `GalleryGrid`'s own history already required (DOM, keyboard,
and lightbox order agreeing) is preserved exactly, not renegotiated, so this is a
presentation choice over an existing contract rather than a change to it.

An article may now own one optional bounded end-gallery result (AB#161, ADR-0003's
2026-09-15 amendment): a large gallery placed after the article's own body without
splitting it into inline mini-galleries or moving it to a second public content page. The
first 24 items render with the article; every later slice is reachable through a real
`?cursor=` link with no JavaScript, and script progressively enhances that same link into
an in-place append with retry and completion states — the identical shared continuation
and lightbox mechanics a curated gallery already has (`article-end-gallery-pagination.ts`,
`article-end-gallery-request.ts`), scoped to the article identity, the end-gallery
identity, and the full route locale, so a cross-article or cross-locale token 404s the
same way a mismatched curated-gallery cursor does. The end-gallery viewer is its own
sequence, isolated from the body's loose-image viewer and from every inline mini-gallery
(AB#24) on the same page. Sanity stores each item as its own `articleEndGalleryPlacement`
document — mirroring `galleryPlacement`'s one-document-per-item shape rather than an
embedded array — with a validated occurrence identity stable across an article's
per-language documents, read through `sanity-article-end-gallery.ts`'s bounded
compound-key `(order, placementId)` query. The parameter-free article stays the sole
canonical and indexable URL and the only one in the sitemap; a continuation is `noindex`,
canonicalizes back to it, and names no `hreflang` alternates, since another locale carries
the article's own identity, not an equivalent transient slice. An article with no end
gallery keeps ignoring incidental or repeated `cursor` parameters exactly as before.
Mock and Sanity-backed tests, plus `e2e/article-end-gallery.spec.ts`, cover a
multi-slice article, the no-JavaScript continuation, progressive append and retry,
lightbox sequence and focus, and a malformed continuation. Production migration and live
dataset verification are separate, already-open follow-up work (AB#137).

**Converter input integrity, 2026-10-07 (AB#212):** `convert:joomla` refuses
malformed UTF-8 in the source NDJSON, poll-results TSV, resolution JSON and approval
manifest CSV before producing reports. Valid Unicode and each format's existing BOM
behavior are preserved. Source/manifest digest and content-approval rules are unchanged;
AB#137's Production import and audit remain open.

AB#137's legacy-content importer is **half built**: the offline conversion and approval
layer exists, the write half does not. `npm run convert:joomla`
(`scripts/convert-joomla-content.mts`, over the pure `joomla-html-conversion.mts`,
`joomla-import-manifest.mts`, and `joomla-import-plan.mts`) reads an exported
newline-delimited JSON article set and the owner's approval manifest, converts each
legacy body into the shared `ContentBlock` set, and reports exactly what would and would
not migrate — performing **no write of any kind**: no network request, no Sanity
credential, no dataset change, and a plan that is marked non-writable by construction.
The conversion is an allow-list over both elements *and* attributes, parsed with `parse5`
(a devDependency for this tooling only, recorded in `docs/asset-inventory.md`) because
hand-rolled or regex handling would make "unsupported" mean whatever the pattern happened
to miss. Every construct is explicitly convertible, explicitly **lossy** (converted, with
the loss recorded), or a **refusal** that blocks its article — there is no silent fourth
category, since a converter that quietly dropped what it did not understand would publish
articles whose surviving words look correct. Presentation, Word residue, and dropped
anchor ids are lossy — as is a paragraph boundary inside a quote or list item, flattened
into a space, since a *single* `<p>` wrapping one (a common WYSIWYG pattern,
`<blockquote><p>…</p></blockquote>`) is exactly representable and carries no finding at all
(an earlier draft refused it outright — a real over-restriction, not a loss, found and
fixed in Codex review round 8); a Joomla `{loadposition}`/`{loadmodule}`/`{contentpoll}`
marker, a non-YouTube embed, style-hidden content, a behavioural attribute, a heading
outside levels 2–4 or out of semantic order, a nested list, a headerless/ragged/merged-cell
table, a `<th>` outside a table's first row, an image with no approved identity or
alternative text, a YouTube video with no accessible title, a gallery disagreeing with its
approved count, a second oversized gallery in one article, a photograph the owner's own
persisted identity map claims is shared between two locators whose verified bytes actually
differ, and a body that converted to nothing are all refusals. There are **two modes**
because of a real ordering problem: every worksheet row starts ineligible, and what makes
one eligible is knowing what its conversion would lose, so an approval-gated tool alone
could never produce the findings needed to grant the approval it demands — `--review`
converts everything selected, `--plan` is strictly approval-gated to one phase (the
owner's "Lever B"). An owner's acknowledgement of a lossy finding is bound to
**two separate digests**, not one — the **source record's** SHA-256 (title,
summary, author, tags, and body, not the body alone, so an edited title with an
unchanged body still invalidates a stale approval) and, since the source text
alone cannot see a changed photograph, alt text, gallery order, or video title,
a second digest of the **resolved conversion output**
(`resolvedConversionDigest`) — printed as `resolvedDigest` in `findings.json`
for the owner to copy into the manifest, and recomputed from the plan's own
`conversion` result rather than trusted from a caller-supplied value, so the
check cannot drift from what is actually being planned — *and* the conversion
policy version, so editing the article, the resolution file, or a conversion
rule all independently invalidate a stale approval rather than silently
carrying over. A loose body image with no language-specific approved alt text
is refused rather than falling back to the raw Joomla `<img alt>` attribute,
which would otherwise let unreviewed source text back in through the one path
that still had it. A malformed approval record is an error, never a deferral,
so it cannot quietly disappear from the launch; an identity or route collision
is an error even across phases; and naming a phase no approved row matches is
an error rather than a clean run over nothing. An approved gallery folder is
verified by its **owner-approved ordered file inventory** — filename and
content SHA-256 per entry, never a file count alone, since a same-count
substitution would otherwise pass silently — reading every approved file's
bytes without uploading or transmitting them, and a duplicate filename in that
inventory is itself a refusal rather than a silent collapse into a smaller
unique set. A loose body image gets the same treatment (`images` carries a
`{locator, sha256}` pair, not a bare locator string), so neither path can
resolve on trust alone; without `--image-root`, or on a missing or mismatched
file, an image or gallery simply does not resolve. Alt text is language-keyed
per locator, not a bare string, since a translated article pair commonly
shares one gallery folder — this migration's own "Chamonix 2006" fi/en pair
does — and a single string would otherwise attribute one language's words to
the other's article. Four identities stay apart — photograph identity
(persisted **two-part** in `photograph-identities.json` — `byLocator` plus
`byContentHash` — across runs and phases; ADR-0002 §1 requires identity to
survive a rename, and `byLocator` alone cannot, since a renamed file has no
entry under its new path, so `byContentHash` correlates a new locator's
verified bytes with an identity already known under a different one, used only
as a lookup and never as the identity's own derivation — `mintPhotographIdentity()`
mints an **opaque CSPRNG token with no relationship to any locator at all**,
never a hash of the filename/path the way an earlier draft did, which was
itself a real ADR-0002 §1 violation (found and fixed in Codex review round 9,
not merely a stopgap for the reprocessed-photograph case): a locator-derived
id is not a genuine mint, it is whatever the source tree's naming happened to
be at that moment. A genuinely reprocessed photograph (different bytes, same
work) is exactly the case a hash cannot correlate and still needs the owner to
carry over by hand), placement identity per *occurrence* (deliberately
language-free: an fi/en translation pair sharing one gallery sequence shares
one placement id per occurrence, the same cross-language sharing
`galleryPlacement` already has, so a live audit can recognize it — though each
language still gets its own placement *document*), the private source locator,
and the derivative/asset reference the write step resolves — so one photograph
used twice is one identity and two placements. Three conflicts fail the whole
run before the rest of the report is written (only a private, mode-0600
`conflicts.json` is), so none can be silently inherited by a later run: the
owner's own persisted map claiming two *currently referenced* locators share
an identity whose verified bytes actually differ (round 8); the *same* file's
`byLocator` and `byContentHash` entries naming two *different* identities — an
earlier draft preferred `byLocator` whenever both existed, silently
overwriting `byContentHash` with it, so the same photograph could get a
different id depending on which locator was processed first (round 10, the
disagreement the two-index design exists to prevent in the first place); and
the same photograph appearing twice in one gallery with two different approved
alt texts for one language — an authoring ambiguity a naive `Object.fromEntries`
collapse used to silently resolve by keeping whichever occurrence was listed
last (round 9). Every conflict's full detail — private locators, hashes, alt
text — stays in that one report file; the console prints counts only, never
raw conflict detail (an earlier draft printed the full detail to stderr,
found and fixed in round 10, since this project's own runbook is explicit
that console output is counts and digests only). Every verified content hash
also feeds `resolvedConversionDigest`, so a file swapped in place with its
recorded hash updated to match — same locator, same identity, different
pixels — still invalidates a stale approval even though nothing else about the
resolved output moved. A structural attribute (`src`, `href`, `alt`,
`colspan`/`rowspan`, `start`/`type`) is accepted only on the element that
actually consumes it, not globally, so `href` on a `<p>` or `src` on an `<a>`
refuses rather than silently vanishing; a manifest ISO-instant field accepts
any real ISO-8601 spelling — `Z` with no fractional seconds, a numeric
offset — rather than only `Date.prototype.toISOString()`'s own canonical one,
which had been silently rejecting ordinary exported timestamps; content hidden
by `opacity:0`, `visibility:collapse`, or `font-size:0` refuses the same way
`display:none`/`visibility:hidden` already did, closing a real path for
abandoned or private legacy content to be silently republished (a bounded,
pattern-based check, not a CSS parser — a compound technique like
`position:absolute;left:-9999px` is a named, deliberately unclosed gap); and
every `--<option>` name is validated, so a typo (`--phaze` for `--phase`)
fails the command instead of silently keeping the default phase, which decides
which approved rows a `--plan` write covers. An approved row's `published_at`/
`event_date` are **canonicalized**, not carried into the planned document
verbatim: `isRealCalendarDateTime` accepts a wider range of real ISO spellings
(an offset, no fractional seconds) than `src/lib/sanity-article.ts`'s own
already-shipped reader does (UTC `Z`, exactly three fractional digits) —
found in Codex review round 11 as a plan that would have validated cleanly
and then been rejected by that production adapter after the write, throwing
on every future render of the migrated page — so `canonicalCalendarDateTime`
resolves the accepted value (correctly applying any numeric offset via native
`Date` parsing, not hand-rolled arithmetic) to the exact shape that reader
requires before it ever reaches a document. `<br>` and `<hr>` now go through
the same attribute allow-list as every other element — they were the two
elements it never ran on at all, so a dropped anchor id or a behavioural
attribute on either vanished with no finding (round 11). And a malformed
`--plan` manifest's own row errors — which can name a private route, content
id, or source id — get the same private-report treatment the round-10
conflicts already have: a mode-0600 `manifest-errors.json`, count only on
stderr (round 11). `isRealCalendarDateTime` itself was found still wrong in
round 12: it folded a fractional second into the *same* `Date.UTC(...)` call
used to validate the calendar date, so a value whose fraction rounded up to a
full second (`.9999`) correctly carried into the next second — and the
comparison then wrongly rejected the *written* second as not matching. Fixed
by validating hour/minute/second as plain bounded-range checks, entirely
independent of the fractional part, and reserving the `Date.UTC` round trip
for what it actually needs to catch — an impossible year/month/day — which a
fractional-second carry can no longer perturb. Two more private-detail console
leaks were found the same way round 10/11's were and closed the same way,
round 12: an approved manifest row with no matching article in the source
export (the oldest of the three, present since this tool's first slice) into
`missing-from-export.json`, and — checked *before* conversion starts, so
nothing downstream ever reads a bad value — a malformed entry in the persisted
`photograph-identities.json` into `malformed-identities.json`, which used to
flow through conversion unchecked and only surface as an uncaught exception
deep inside `buildImportPlan`'s own `migratedId` call. Migrated documents use a
`migrated--` id namespace deliberately
disjoint from the demo seeder's `seed--`, because `npm run seed:sanity --
--delete-all` deletes every `seed--` document and would otherwise be able to
destroy real launch content; a test pins the two apart. A derived end-gallery or
placement id is checked against the Studio schema's own 128/256-character bounds
before an article is accepted, since an API import bypasses Studio validation
entirely. The genuinely generic document-set checks moved to
`scripts/sanity-document-checks.mts`, shared with `validateSeedFixtures`, whose
demo-fixture *coverage* assertions stayed where they are because they say nothing
about launch content. **The write half is now built too**
(`npm run write:joomla`, `scripts/write-joomla-content.mts`,
`scripts/joomla-image-derivative.mts`): it turns an approved, non-writable
`ImportPlan` into real Sanity documents. Dry-run by default, matching the demo
seeder's own guarantee exactly — without `--yes` it makes no network request at
all, not even a read, since every step through local asset verification is
filesystem and CPU only. It never trusts the plan file blindly: the plan's own
shape is re-validated (every requirement's fields, and an exact correspondence
between the requirements arrays and the actual pending references the plan's
documents carry — a stray requirement or an unresolved reference is refused
before either the filesystem or the network is touched), `IMPORT_PLAN_VERSION`
bumped to `-v2` so a stale pre-hash plan cannot silently satisfy a
version-equality check that never itself changed, and `validateMigrationDocuments`
re-run regardless of how the file claims to have been produced. `AssetRequirement`
gained a `contentHash` field, threaded from the same `resolvedImageContentHashes`
the conversion half already collects: the approval-binding-to-actual-pixels
guarantee round 7 established holds at plan-build time, but the write step can
run arbitrarily later against a separately-minted credential, so each photograph
is re-hashed from the exact same read that feeds its derivative generator
immediately before upload, and a mismatch refuses the run rather than trusting
whatever bytes are now at the locator. The derivative itself
(`joomla-image-derivative.mts`, over `sharp`, a devDependency for this tool only)
resizes to `MAX_PUBLIC_DELIVERY_DIMENSION` with `fit: "inside"` (never crops,
never upscales), applies EXIF orientation before resizing and strips EXIF/GPS
on output, and re-encodes at an explicit, stated quality per format rather than
an implicit library default — AVIF specifically needed its own detection branch,
since Sharp reports an AVIF buffer as `{format: "heif", mediaType: "image/avif"}`,
never `format: "avif"` (verified directly against the pinned 0.35.4, not
assumed — a plain `format` lookup would have silently misclassified every real
AVIF source into the fallback path). An animated or multi-page source is
refused outright rather than silently flattened to one frame, since a universal
fallback would discard visual meaning the photographer never chose to lose; a
static otherwise-unsupported source still converts to JPEG, with an explicit
white background for a transparent source rather than whatever a library
default would composite. Category references resolve against the target
dataset's real document ids (published perspective — an article must bind to a
*live* category, not a draft-only one); before any upload, a target-dataset
collision preflight (raw perspective, chunked to `sanity-read-http.mts`'s own
11 KiB GET budget) checks every `mediaId`, article `(contentId, language)`
pair, `(language, category, slug)` route, and end-gallery `placementId` this
plan is about to write against what the dataset already holds, refusing the
whole run if any is already claimed under a *different* `_id` than this plan
intends — an API write bypasses every Studio uniqueness rule a customer's own
Studio would otherwise enforce. Placeholder substitution is reference-aware —
it rewrites only a matched reference object's own `_ref` string in place,
never replacing the whole `{_type: "reference", ...}` object (an earlier draft
of this tool would have nested a `_ref` string inside what must stay a
reference object) — followed by an independent defensive scan for any
surviving pending marker before a single mutation is sent. Sanity's mutate API
requires a strong reference's target to exist in an *earlier* transaction —
the same constraint `docs/sanity-seeding.md` already documents for the demo
seeder's own write — so documents are batched in two ordered waves, every
`media` document first to completion, then everything else, rather than the
plan's own raw emission order, which interleaves an article with its media
references and would break the moment a real migration's document count
crosses one mutation batch. Every private report (a verification failure, an
unresolved category, a collision, an upload failure) is mode-0600 in a
mode-0700 directory, console limited to counts, matching the conversion half's
own established convention exactly. `SANITY_MIGRATION_TOKEN` is read from the
environment only, never a flag, and is a separate credential from the demo
seeder's `SANITY_SEED_TOKEN`. This design was reviewed once against Codex
before implementation (the mandatory one-round plan check): the wave-ordering
requirement, the reference-aware substitution fix, the AVIF metadata
detection gap, the collision preflight, the path-traversal/symlink
containment check on every source locator, the query/id chunking, and the
explicit encoder policy were all findings from that single round, verified
against real code or measured behavior before being accepted, not taken on
trust. Once implemented, the write half went through 8 further rounds of the
same independent Codex review, this time against the finished, self-reviewed
diff rather than a plan — every finding verified against real code (often by
running the actual code path, not just reading it) before being accepted and
fixed, each fix covered by its own regression test, with the project's gates
green after every round. In order: a memory-accumulation bug in the asset
verification loop, where a long-lived array was retaining full derivative
buffers rather than a lightweight summary per iteration; the media
field-allow-list contract and nested content-block shape validation, matching
exactly the eight block kinds the converter emits; the required-field and
position-aware reference checks, and the collision preflight's scope widened
from articles alone to the shared article/gallery/category identity space
`content-placement-validation.ts` actually governs; the approved-plan digest
widened twice — first to bind `assetRequirements` (`mediaId` + `contentHash`,
so approving a plan also approves exactly which photograph bytes it points
at), then to bind `errors`/`blocked` (so a plan whose blocker state changed
cannot silently satisfy a stale approval); a published article's URL frozen
against a rerun (`language`/`slug`/`canonicalCategory`), and the local-slug
collision check widened from a category's direct children to its whole
ancestry, since migrating content can make a previously dormant branch public
for the first time — both restating `content-placement-validation.ts`'s own
pure functions locally rather than importing them, after direct `node`
execution (not `tsc` or Vitest, which both tolerated it) surfaced that file's
own extension-less internal import crashing a real subprocess — the same
class of "passes under a transpiler, fails for real" trap as AB#116's earlier
parameter-property crash; a direct `_id`-occupancy check ahead of the
identity-scoped collision checks (so a document of the *wrong type* already
occupying one of this plan's deterministic ids is caught, not just a same-type
identity collision), and category reference resolution widened from checking
that a language *key* is present to validating the actual label and slug
*values* against `content-tree.ts`'s own rules, since a present-but-invalid
value would otherwise take the whole public tree down the first time any
route read it, well after the migration had written content depending on it;
and, closing the loop, `checkReferenceShape` requiring an actual
`_type: "reference"` rather than accepting any object with a valid-looking
`_ref` (Sanity dereferences a wrong or missing `_type` as `null`, silently,
not as an error), and `SANITY_MIGRATION_TOKEN` refusing to read if a
`NEXT_PUBLIC_SANITY_MIGRATION_TOKEN` mirror is also set, matching the same
established pattern the security-review skill and `src/lib/sanity-config.ts`'s
own read-token parsing already enforce elsewhere. `docs/sanity-seeding.md`
carries the full per-round account. A 10th round was attempted and blocked
outright by Codex's own usage limit before producing a review — not a
finding, and not retried in a hot loop. **Still unbuilt: every owner-run part
of AB#137** — the manifest approval, the baseline export, the temporary
credential, the Production run itself, the post-write audit, and the
revocation and handoff evidence.

Article polls (AB#162, ADR-0018) add the ninth shared body kind. The runtime
poll facade reads fresh results and performs one atomic receipt/tally mutation;
the independent per-poll cookie is established only on a vote action, before
POST, so a lost first response can be retried without a second count. Results
are server-rendered; voting needs JavaScript and shares the message form's
hydration/submission guard. `convert:joomla --poll-results` carries closed
historical pairs into the approved plan (conversion policy v2, plan v3).
Actual token provisioning and production migration remain owner-run checks.
AB#194 prepares AB#26's separate [comment and reader-rating requirements](article-comments-and-ratings.md).
Neither interaction is implemented; completed AB#162 poll behavior is excluded.

A body media placement can now carry one optional, bounded plain-text caption
(AB#137, ADR-0003's 2026-09-18 amendment): `contentMediaBlock.caption`, owned
by that placement and overriding the referenced photograph's default caption
only in that body, so the same media document can carry contextual legacy
`<figcaption>` text differently in two different articles without turning the
shared media record into a list of editorial contexts. It renders in the
in-flow figure and that figure's own body-image lightbox sequence; it stays
outside curated grids, gallery pagination, media delivery, and image
identity. The converter now reads it from the one real legacy markup shape
the source archive uses — `<figure><img>…<figcaption>…</figcaption></figure>`
— through a dedicated `visitFigure`, no longer the generic transparent-wrapper
walk `<figure>` used to fall through to, which left every `<figcaption>`
landing on the final `unsupported-element` refusal with no way to recover the
words. Measured against the real 102-article selection: this closed 470 of
474 `unsupported-element` refusals outright (`joomla-conversion-v4`); the
remaining single case is a real, different shape — a `<figure>` carrying loose
text beside its image with no `<figcaption>` wrapper at all — refused rather
than guessed at, the same posture a second non-blank caption on one figure or
any other unexpected figure content gets. Raw HTML, links, and inline
formatting inside a caption are flattened to plain text through the same
`captureFlatText` machinery `visitTable`'s own caption already uses, and a
figure nested inside a quote or list item is refused the same way a bare
image already was. `scripts/write-joomla-content.mts` accepts the field at
the write boundary with the same bound the schema enforces.

A tab group (AB#163, [ADR-0020](adr/0020-tab-group-body-block.md)) adds
the eleventh shared body-block kind: a bounded, ordered list of 2–8 named
tabs, each holding exactly one data table (the existing AB#22 table block's
own shape and bounds, reused by name in the Sanity schema so the two share
one rectangularity validator) — a tab is not a generic rich sub-body, scoped
narrowly to the one real legacy shape that motivated it. `ContentTabGroup`
follows the WAI-ARIA Tabs pattern once hydrated — `tablist`/`tab`/`tabpanel`
roles, a roving `tabIndex`, automatic activation with wrapping arrow-key
navigation, the inactive panel hidden via native `hidden` (which correctly
drops it from the accessibility tree, not merely from view) — and renders no
tab control at all without JavaScript, every tab's table stacked and labelled
instead, matching `ContentImageComparison`'s own no-controls-without-JS
posture (ADR-0019). The Joomla converter recognizes the pairing at the
sibling level — a `<ul class="nav-tabs">` immediately followed by its
`<div class="tab-content">`, the one shape the AB#137 legacy archive actually
carries (article 370's Bootstrap burst-test tabs) — through a new
`visitSiblings` walk that replaces the previous flat per-node loop with no
behavioural change for any body lacking the pattern (the full pre-existing
suite passes unchanged). Recognition is strict: an unexpected trigger
attribute, a pane holding anything but exactly one table, an unmatched
fragment, or a tab count outside the schema's own bound all refuse rather
than guess, while a pane's own specific refusal (an unresolved image, for
instance) still surfaces as itself rather than a generic shape complaint.
`convertPaneToSingleTable` mirrors `captureFlatText`'s save/restore technique
for isolating the sub-walk, extended to also catch an oversized `{gallery}`
marker inside a pane that would otherwise be silently discarded with no
finding. Conversion policy advances to `joomla-conversion-v5`. Measured
against the real 102-article selection, this closes the archive's last 4
`behavioural-attribute` refusals and converts article 370 end to end —
verified against the real, unmodified source, aside from one unrelated,
separately-tracked gap the same article also exposed: a `<h6>` nested inside
a table's own `<caption>`, refusing independently of this decision. Full
browser verification (`e2e/content-tab-group.spec.ts`) covers the no-JS
stacked fallback with keyboard-reachable table regions, the hydrated tablist
roles, click switching, and arrow-key navigation with wrapping and no focus
trap, in both engines. AB#137's own review-mode findings, exception
resolution, and manifest approval remain entirely open.

**Native tab fragments, 2026-10-17 (AB#335, parent AB#321):** the first
progressive tab enhancement preserves a currently visible H2–H4 native target
after that group in the same editorial body. A before-mutation snapshot and
layout-phase correction compensate at most that group's own height decrease;
multiple groups share the actual remaining viewport displacement. There are no
scroll listeners, timers, history writes, focus moves, storage or restoration
loops. A target already outside the viewport stays with native navigation and
restoration. Browser end-of-document clamping is accepted. This does not restore
late-image/CMS changes, guarantee an in-progress touch momentum gesture, or
repair a full client-render recovery that discarded the initial DOM. The stacked
scriptless/unavailable-script content and ordinary ARIA tab interactions remain.
This repairs the existing fragment behavior; ADR-0020's Proposed status and
AB#20's open persistence policy are unchanged. Owner review and real-content
acceptance remain pending; AB#335 and parent AB#321 remain Active.

The converter also stopped hard-refusing an anchor's known-inert `rel` value
(`joomla-conversion-v5`): `alternate`, `nofollow`, `tag`, and the rest of
MDN's confirmed no-behaviour set on `<a>` now drop as a new lossy
`link-relationship-dropped` finding, the same posture as any other
presentational attribute, rather than the generic `behavioural-attribute`
refusal every unrecognized attribute gets. A `rel` value with real browser
effect (`noopener`, `noreferrer`, `opener`) or anything unrecognized still
refuses, and a mix of a safe and an unsafe token still refuses the whole
attribute. Measured against the real 102-article selection, this resolved 8
of the archive's 12 `behavioural-attribute` refusals — all eight were
`rel="alternate"`, the only `rel` value the selection actually contains — and
left the remaining 4 (`data-toggle="tab"`, a real Bootstrap tab widget with
no equivalent on the new site) refusing exactly as before, still a content
decision for the owner.

A table caption whose *entire* content is one heading element now flattens
to plain caption text (`joomla-conversion-v6`) instead of refusing on the
heading's level: `<caption><h6>…</h6></caption>` — the real shape article
370's own tables use — notes a new lossy `caption-heading-flattened` finding
and keeps the words, since a caption is not part of the body's heading
outline and the level carries nothing worth preserving. `soleHeadingChild`
scopes this narrowly: a heading alongside other caption text, or more than
one heading, still falls through to the ordinary walk and still refuses
exactly as before (`heading-level-unsupported`/`heading-order`). This closed
4 of the archive's `heading-level-unsupported` refusals, all in article
370 — but verifying it against that article's real, full body (rather than
the isolated tab-widget extract ADR-0020's own measurement used) surfaced a
second, unrelated defect: parse5 reports **no closing tag at all** for the
article's own `<div class="tab-content">` — its source-location info's
recorded end offset is the exact byte length of the article body, i.e.
implicitly closed only at end of input. The rest of the article is
therefore, per real HTML5 parsing rules, nested *inside* the tab-content
container, and the tab-group recognizer (AB#163) correctly refuses this
shape (`tab-group-unsupported-shape`) rather than absorbing unrelated
content into the tab group or guessing where the missing tag belongs. This
is a genuine defect in the source content itself, not a converter gap:
[ADR-0020](adr/0020-tab-group-body-block.md) records it as an owner
decision — correct the exported HTML before the real migration run, or
extend `prepare-selected-source.mts`'s existing precedent (it already
corrected 9 other tables) to insert the one missing tag, with the corrected
body re-approved through the existing source-digest mechanism either way.
Article 370 therefore still does not convert as a whole.

A systematic pass over every remaining refusal category the real 102-article
selection carries (`joomla-conversion-v7`) closed one more genuine technical
gap and confirmed the rest are either already-solved false signals or
structurally owner-gated content decisions, not converter bugs. `--poll-results`
was simply missing from the ad hoc verification command used to measure the
figcaption/`rel`/tab-group/caption-heading fixes above: passing it resolves
every one of the archive's 27 `{CONTENTPOLL}` markers the same way AB#162's
own import already does, so `unknown-plugin-marker` was never a real
remaining gap. `image-unresolved`, `gallery-unresolved`, and
`comparison-unresolved` are structurally gated by design, confirmed by
reading `resolveImage`'s own implementation: resolution requires an
owner-approved `--resolution` JSON regardless of `--image-root`, so no local
audit can resolve them — they need the real approval work AB#137's own row
already names. The fix: a lone `<div>` wrapping only text inside a
`<blockquote>` or list item — `<blockquote><div>text</div></blockquote>`,
article 371's real shape — now flattens the same way a lone `<p>` already
does (round 8), generalizing that fix from `<p>` specifically to every
`TRANSPARENT_ELEMENTS` tag when `flatTextCaptureDepth > 0`, since the
underlying cause (`flushParagraph()` pushing an illegal block mid-capture)
was never `<p>`-specific. Adjacent top-level `<div>`s outside any quote keep
round 5's own behaviour (two separate paragraphs) unchanged. Closes the
archive's one `block-inside-quote-or-item` refusal. The remaining categories
— `heading-level-unsupported` (32, spread across 26 articles, no single
mechanical shape; several `<h6>` occurrences of one exact repeated tagline
turned out to be Joomla template-generated category-title markup —
`<h6 class="heading-style-6…"><span class="item_title_part_…">…` word-split
spans, a known template output pattern, not hand-authored prose — which is
itself an owner content call: whether that fragment belongs in the migrated
body at all), `heading-order` (48), `empty-heading` (19, confirmed genuinely
empty: `normalizeText` already collapses a bare `&nbsp;` to nothing, so this
is real WYSIWYG cruft, not a detection gap), the "flaticon" navigation-style
list found in articles 325/394 (`<ul class="flaticon"><li><a>…</a></li><p>…</p>`,
likely site-chrome content rather than body prose), and the `<dl>` term/definition
pair in article 370 (a real, evidenced case for a possible future
list-shaped mapping, but only 2 occurrences in the one article already
blocked by its own missing `</div>`) — are all genuine content or scope
decisions, not technical gaps, and stay open for the owner. For the four
`youtube-title-missing` videos, real accessible titles were looked up
against YouTube's own public oEmbed API (verified, not invented, author
confirmed as this project's own photographer) for the owner's approval —
one of the four ("Mobile menu bug") does not read as show-worthy content and
is flagged rather than assumed includable.

Capture-sequence galleries (AB#166, [ADR-0022](adr/0022-capture-sequence-rally-galleries.md))
are the third gallery ordering rule, built for large rally collections whose order is the
photographer's filename running number. Such a gallery has **no `galleryPlacement`
documents**: its items are the `media` documents whose `captureSequence` object names the
gallery's language-neutral `contentId`, with a `sequence` and a `sectionId`. FI and EN
galleries share them, and `itemId = mediaId` (a scoped ADR-0002 amendment).
The offline planner exists too (AB#167, `npm run plan:rally`,
`scripts/rally-import-plan.mts`): it reads one exported folder plus its `rally.json`,
refuses any file that breaks the naming, format, or size contract, and writes a plan of
media and gallery documents plus a content-hash identity map. It makes no network
request. `npm run write:rally` (AB#168, `scripts/rally-import-write.mts`) writes an
approved plan, dry-run by default:
- It re-verifies the digest and every file, and produces EXIF-stripped public copies.
- With `--yes`, a raw-perspective preflight refuses on category, identity, route,
  placement, stray-member, draft or release, and frozen-URL conflicts.
- It uploads, writes media before galleries, and reads the result back.
- Reruns patch only plan-owned fields and never delete. This cuts a
bilingual gallery photograph from four Sanity documents to two. The read path is the
existing bounded contract answered from media:
- `sanity-gallery.ts` filters gallery, section, `publiclyRenderable`, and `privateOnly`
  in GROQ before the limit, then keysets on `(captureSequence.sequence, mediaId)`.
- Cursors carry the `capture-sequence-v1` ordering scope, so a manual or seeded token
  fails `wrong-scope`.
- `visibilityVersion` is the newest member media's `_updatedAt`.
- A gallery that also has placements is refused rather than merged.
- Enquiry resolves the item by `mediaId` inside that gallery. The target carries no
  `placementId`, and the email omits the placement line.

**Rally import plan integrity, 2026-10-07 (AB#217):** `write:rally` rejects
malformed UTF-8 before parsing the approved plan, inspecting image files or reading
credentials. Valid Unicode and the existing digest/JSON BOM behavior are preserved.
Local derivative checks, dry-run and raw-perspective preflight remain unchanged;
this is an offline tooling correction, not a new rally import.

Studio validation (`sanity/schemas/capture-sequence.ts`, `gallery.ts`,
`gallery-placement.ts`) blocks every combination the read would refuse. The mock fixture
`content-capture-sequence` has 40 photographs in two sections, authored in reverse, and
`e2e/gallery-capture-sequence.spec.ts` walks it without JavaScript. The conversion of an existing gallery is planned by `npm run plan:rally-conversion`
(AB#169, `scripts/rally-conversion-plan.mts`). It reads the published gallery with a
tokenless, published-only query (`runPublicReadQuery`) and recognizes each renamed file
by content hash through the import artifacts, so every photograph keeps its document and
`mediaId`. It keeps existing section ids and slugs, drops alt overrides that repeat the
photograph's own alt text, and moves placement captions onto the photograph. It reports
moved, duplicate-removed, and added photographs for approval. New photographs and removed
duplicates each need an explicit flag. The write step (`npm run write:rally-conversion`,
AB#170, `scripts/rally-conversion-write.mts`) writes an approved conversion, dry-run by
default: it requires a recent `--backup-archive` (a real, non-trivial, recently modified
file — the one check this tool can make on an owner-run `sanity datasets export`), then
with `--yes` re-derives what remains to do from a fresh raw-perspective read rather than
trusting the plan's own snapshot, so an interrupted run is safe to resume. Photographs are
written first; a gallery's remaining placement deletions and its `orderingRule` switch to
`capture-sequence` are always sent in the same mutation call, so no request boundary can
leave placements referencing a capture-sequence gallery — the one state the public read
refuses outright. A read-back confirms both galleries afterward. **Nine Production
galleries were converted this way on 2026-09-24** — Secto Rally Finland 2021, 2022 and
2023, Neste Rally Finland 2016, 2017, 2018 and 2019, TET Rally Latvia 2024, and Rally
Estonia 2023 — each verified by an independent tokenless read; Production went from
6,820 to 3,581 documents. The placement-based "Rally Finland 2001–2019" best-of gallery
(38 placements) stays curated. The per-gallery decisions are in
`docs/sanity-seeding.md`. At the 2026-09-24 check, the Azure `DeployPreview` stage
had failed on exhausted Microsoft-hosted minutes since 2026-09-23, so merged
code had not deployed automatically. Protected Preview delivery was later
verified in run #501 on 2026-10-02; see [deployment history and recovery](deployment.md#the-verify-stage-runs-on-a-self-hosted-agent).

A content page's short lead can be a **listing-only excerpt** (AB#172, ADR-0003's
2026-09-26 amendment). With `summaryListingOnly`, the lead shows on listing cards and in
the meta, Open Graph and JSON-LD descriptions, but not on the page itself. The rule lives
in `content-page.ts#onPageSummary`, and the Sanity article and gallery schemas and
adapters carry the flag. The imported Joomla stories needed it: the importer left each
intro text as the first body paragraph, so a page opened with the same text twice and its
card had no excerpt. `npm run fix:joomla-intro` (owner-run, dry-run by default,
revision-guarded, one transaction, recovery record) moves those paragraphs. On
2026-09-26 its read-only plan for Production covered 26 pages: 18 rally galleries and the
8 VAT portfolio articles. It left out Secto Rally Finland 2022, whose one paragraph is the
whole text, and the photographer's introduction, which starts with a heading. The write
itself is owner-run. **Article-import follow-up, 2026-10-03 (AB#137):** the Joomla
article planner now sets the flag for every non-blank imported `summary`. The writer
refuses a summary-bearing plan without the true flag or a flag without a non-blank
summary. Old summary-bearing plans must be regenerated, reviewed and approved against
their new document digest. The reviewed source export supplies the plain-text intro
separately from the full-text HTML; the importer does not remove body paragraphs.
Synthetic planner-to-writer tests cover both locales, missing/blank summaries, the
approval digest and malformed or stale plans. Production writes and post-import
listing/page verification remain owner-run under AB#137; this code slice does not
close the migration story or change AB#172's Resolved state.

**Read-only intro diagnosis (AB#355):** `reconcile:joomla-intro` reads an approved
recovery record and current raw document/version state using a Viewer credential;
its runtime import path has no mutate/upload capability. Pending changes never
trigger a resend. It refuses write flags, mismatched targets and invalid recovery
records, preserves existing evidence with an exclusive private report, and reports
observed applied/pending/unexpected states separately from read failures. The existing
writer's explicit retry, approval, revision and recovery contracts remain unchanged.
This tooling slice performs no CMS write and establishes no AB#172/137 operational
acceptance; content operations and owner acceptance are tracked separately.

**Approved intro completion, 2026-10-18 (AB#172, Active):** the owner-approved
remaining 12 articles were corrected in one revision-guarded Production
transaction after a complete document/asset recovery baseline. Independent
readback found 12 applied, zero pending/unexpected and all 108 other page
documents unchanged; the earlier 56-page correction stayed intact. The temporary
writers were revoked and their keys returned HTTP 401. All 12 automatic
Production webhook deliveries succeeded, and 22 anonymous detail/listing/meta
checks passed after cache expiry. No runtime code changed. The
[operation audit](audits/ab172-approved-intro-completion-2026-10-18.md) records the
full baseline, credential lifecycle, verification and limits. AB#172 remains
Active pending evidence acceptance/merge; AB#137 remains Active.

**Rally conversion plan integrity, 2026-10-07 (AB#218):** `write:rally-conversion`
rejects malformed UTF-8 before parsing, backup inspection or credential resolution.
Valid localized caption text retains its exact approved digest and existing JSON BOM
rejection. The recoverable-export requirement, dry-run, resume reconciliation and atomic
placement-deletion/rule-switch boundaries are unchanged; no gallery is converted here.

**Remaining migration preparation, 2026-10-04 (AB#137, PR #239 merged):** a fresh
read-only Production audit found 3,593 documents: 20 gallery versions, 10 article
versions and 6 service versions, with no drafts or release records/versions. All four
route-facing adapter smoke checks passed. The private remaining-content candidate
excludes the 30 published article/gallery identities from the old 102-version plan,
preserving the converted rally galleries. It contains 72 page versions (44 gallery,
28 article), 3,512 media, 4,230 gallery placements, 2,064 end-gallery placements, 20
closed historical poll/tally pairs and 8 new categories. Local contract/category
validation and the read-only Production collision preflight passed. The plan is
unapproved and no Production write was performed. Private evidence stays in the
ignored migration directory; these counts do not close AB#137.

The owner reported upgrading Sanity to Growth on 2026-10-04. A post-merge raw read
confirmed 1,833 quota-counted Production documents and zero in the project's other
dataset, Preview. The remaining import projects 11,759 project-wide documents,
within the 25,000-document limit in Sanity's published Growth pricing. The subscription
is owner-confirmed, not API-verified; counts are planning evidence and must be read
again before import. The separate private post-merge report records the exact quota
query and keeps the content plan and review-bundle digest unchanged. Content approval,
a recoverable Sanity baseline, promotion of the staged linked-content renderer, and the
Production write were pending at that capture; the 2026-10-05 follow-up below records
the approval and completed baseline. Temporary write-credential revocation remains
unverified. AB#137 stays Active.

PR #239 adds the previously prepared bounded inline-link slice: paragraphs
and lists preserve safe links through conversion, Studio, the writer and the public
adapter/renderer. Conversion policy v9 and plan v6 retire earlier input. Unresolved
legacy links are refusals. The category writer preserves safe description links;
the curated-gallery writer accepts the existing listing-only-summary flag only with
a nonblank summary. The intro-summary correction tool reports a first paragraph using
`spans` for an owner decision and retains its links instead of converting it to plain text.
CI #523 passed lint, 4,449 unit tests, the production build, and the full browser
journey matrix (736 passed, 36 skipped). Code acceptance and merge are complete.
At the 2026-10-04 code handoff, exact plan approval, renderer promotion, the import,
post-write verification and credential revocation were pending.

**Category plan input integrity, 2026-10-07 (AB#215):** `write:categories`
refuses malformed UTF-8 before category validation or credential resolution. Valid
localized text and approval digests remain intact, including intentionally encoded
replacement characters. JSON BOM rejection, dependency ordering and create-only
preflight/read-back behavior are preserved; no category is written by this change.

Main CI #524 also passed Quality and Preview delivery. A separate Production-target
candidate was built remotely from that verified main revision, with no local Production
environment copy. Its uploaded source archive matches all 685 uploaded Git files,
including every runtime/public file; the omitted `.gitignore` has no runtime role.
Provider authentication and noindex were checked on the immutable candidate URL.
The current-content HTTP comparison passed 28 GETs across FI/EN landings, services,
articles and gallery continuation pages (24 figures per gallery slice). This is a
current-content smoke, not verification of the unapproved remaining import.
`--skip-domain` kept the public Production alias on the old deployment but moved the
protected generated team alias; that alias was restored and both old targets verified.
The staged candidate is not promoted. The private release evidence also records exact
byte matches for 1,712 of today's 1,748 image assets in the September 24 Sanity export
or the checked local image directories; 36 have no matched local recovery copy in
those locations. A fresh recoverable
baseline including assets required explicit owner authorization, received on 2026-10-05.

**Joomla plan input integrity, 2026-10-07 (AB#213):** `write:joomla` rejects
malformed UTF-8 before parsing a plan, verifying assets or resolving credentials.
Valid Unicode, existing JSON BOM rejection, the exact approval digest and dry-run
boundary are preserved. This changes no approved content and performs no import.

**Approved migration preparation, 2026-10-05 (AB#137):** the owner's confirmation
approves the unchanged remaining-content bundle and the exact local full-baseline
destination. The private approval record resolves only the owner-approval sentinel:
documents, photographs, categories, routes and the original review files remain unchanged.
The resulting approved writer plan passes local contract validation, and both category
and Joomla writer dry runs pass; all 3,512 photograph sources were reverified and their
public derivatives generated without a network write. Fresh Production collision and
category checks found no issues. Projected project-wide usage remains 11,759 quota
documents; the 12 provider system documents and asset documents are excluded from that
count. Even a conservative count adding every planned asset is 15,271.

The complete baseline contains all 3,593 raw documents, including 12 provider system
records, and all 1,748 current image binaries (916,811,028 bytes); no file assets,
drafts or release states were present. The backup credential's effective read-only
permissions were verified through the provider API. The official asset-inclusive export
is bundled with an exact raw-document snapshot because the installed exporter's `raw`
mode skips asset downloads and its normal mode omits non-release system records.
Before/after revision manifests, transformed document and asset metadata, every binary's
size and SHA-1, and final archive member hashes were independently verified. This is
structural recovery evidence, not a live restore test. The owner-only archive and report
remain ignored; their capture time is 2026-10-05 despite the approved filename's
2026-10-04 suffix. Before a later write, the complete revision manifest must still match
this baseline or a new baseline is required. Rollback preparation protects all existing
asset IDs; seven reviewed derivatives match current assets, which must not be deleted
as new-only assets.

A fresh authenticated deployment lookup confirms the public alias still serves the
September 24 commit. Its body projection omits inline spans and rich list items, so it
cannot render 14 approved page versions (21 linked paragraphs and one rich list).
Body-free listings/home/sitemap projections and existing category-description link
support were inspected separately; no post-import runtime check is claimed. A compatible
protected diagnostic build alone does not resolve the public-code gate. The Production
write is deferred until compatible code serves the public alias through the reviewed
release path. No new write credential was minted, and no CMS, deployment or DNS change
was made in the approval/baseline slice. Full post-import audit, route/pagination checks, credential
revocation and ownership/rollback handoff remain open; AB#137 stays Active.

**Protected prebuilt renderer preparation, 2026-10-05 (AB#137):** a later manual
operator build used the same verified main commit, pinned CLI 61.0.0, Next.js 16.3.8
and Node 24.20.0. Fourteen public configuration values entered the local build; neither
runtime Sensitive value was fetched into it. Reproducible installation, unchanged Git
source, physical outputs and CLI-mapped runtime files were checked. Every member of the
provider's original 607-entry prebuilt archive matched the local manifests, including
70 function-directory aliases and 387 mapped inputs. Five physical functions declare
Node 24 on x86_64; no local environment file or private migration data was uploaded.
The candidate reached READY without moving either existing alias. Anonymous access is
challenged and authorized responses carry noindex. The current-content smoke passes
28 GETs, including gallery first/next pages, and 14 semantic comparisons match the prior
same-commit diagnostic. New approved content has not been imported or HTTP-tested.
This candidate was built locally, not by an Azure Production stage; it remains protected
and inactive. At that checkpoint Production metadata lacked the contact-delivery adapter,
sender/recipient and provider key; the later checkpoint below supersedes that provisioning
status. Email verification remains open. The public-code
gate, import/audit/revocation, AB#117 and AB#18 launch decisions remain unresolved.

**Preparation batch merged, 2026-10-07 (AB#219):** as of main revision
`8f926c9362b1d81e696699d0772609738359ef7b`, PRs #259–#268 are merged and
AB#200–209 are verified Closed. Azure CI #620 passed the Quality gates
stage (lint, unit tests, production build and journeys) and the protected Preview
release candidate stage. The scheduled dependency audit stage was skipped.
Earlier dated Active labels describe their original checkpoints.

The completed preparation comprises the offline DNS guard, scriptless-404 evidence
refresh, mail-recovery worksheet, hero CSS journey correction, saved audit summary,
redacted contact failure summary, public availability probe, skill provenance,
rollback worksheet and pending legacy CSV export. Completion of these bounded
items leaves the broader migration and launch acceptance work open.

The owner's remaining-content approval is recorded in the 2026-10-05 checkpoint
above; this integration changes no approved bundle or content decision. The next
operation still needs a compatible renderer on the public alias, a freshly verified
recoverable baseline, the approved import, raw-document/asset and route/pagination
checks, and temporary write-credential revocation. AB#19's pending paths require
per-row decisions and real target verification after migration, including explicit
deferred-path behavior for a phased launch. AB#137, AB#117 and AB#18 remain open.

A successful protected Preview stage does not establish Production activation,
CMS import or domain cutover. Live mail-preservation checks, monitoring notifications
and code/content rollback exercises retain their own acceptance boundaries.

**Merged release and migration readiness, 2026-10-05 (AB#137, Active):** PR #246
merged and AB#188 reached Closed; exact main revision `4b8dd013880eddf79e54e42244d18f5cda32d860`
passed Azure CI #545. A fresh manual prebuilt Production-target candidate reached READY
with that revision. Later main advancement changed only four documentation files;
the release source and runtime/build inputs remain frozen at the CI-verified revision.
All 607 uploaded archive members match the local output and mapped-input manifests.
Provider-side runtime secrets were not downloaded into the build. Both existing aliases
and the project's Production target stayed on the prior deployment; no custom domain
was attached. The candidate's protection and noindex are verified; the old default alias
returns anonymous HTTP 200, so activation changes public serving code. Fourteen
current-content route/pagination GETs pass. Contact GET and four fixed rejected POST cases pass without delivery; the actual email/Reply-To owner test belongs to the
preceding candidate, so the new revision's real delivery is still unverified.

All 3,593 raw revisions and 1,748 asset metadata records still match the complete
baseline. Both approved writers pass dry runs, collision checks remain clear and the
unchanged projected project quota is 11,759 documents (15,271 conservatively including
every planned asset). All 3,512 derivatives pass dimensions, ratio, no-upscale and
EXIF/IPTC/XMP checks: 3,404 unique hashes and seven shared existing assets. Protect all
baseline IDs during rollback and use actual write receipts for new-only IDs. No CMS
write occurred. The operator has Administrator membership and the two datasets are
public; the metadata endpoints do not establish storage region. Token metadata shows
three write-capable project-managed tokens, including a never-expiring temporary Editor;
a separate principal inventory needs reconciliation before cleanup. No token was revoked.

Resend provisioning is no longer absent: the owner verified its sending domain and
received real mail, and Production contact settings are present. Account MFA, key
scoping, actual retention and tracking settings remain AB#117 checks. The published CMS
privacy notice names only name/email/message and generic delivery; its new-field and
processor coverage needs updating, and its authored 12-month mailbox promise still
needs an operational deletion check. The exact local production build reproduces
AB#132's four scriptless semantic failures. AB#132/186 owner decisions, hosting tier,
real-device verification, legacy-route completion, public activation and import/audit/
revocation remain open. This checkpoint neither accepts risk nor closes AB#117/18.

**Fresh protected renderer readiness, 2026-10-07 (AB#137, Active):** PR #281
merged; main CI #655 passed quality and a real protected Preview deployment with
the patched CLI tree, and AB#186 was explicitly moved Active → Closed. PR #282
then merged after CI #656 and a clean Claude documentation review; its exact main
source `49812f639d3e575235cfc7076e356be7abdc4306` passed CI #657, including Preview.
A fresh manual prebuilt Production-target candidate from that source is READY.
All 611 uploaded artifact members match local manifests. Thirty current-content
FI/EN route, contact-field and gallery-pagination GETs pass. Two separate live
scriptless 404 probes reproduce the known semantic defect; they are expected
failures, not successful journeys. At that checkpoint AB#132 remained Active and risk acceptance was pending;
see the subsequent owner-acceptance entry below for the current decision.

The complete baseline archive hash and all 3,593 raw revisions match; no planned
content/category IDs collide. The existing credentialed asset/state audit, four live
adapter tests and both current-main offline writer dry runs pass. Actual import,
post-import audit and credential revocation remain open. All aliases and the
Production target stayed on the old renderer; public activation, DNS and billing
were not changed. Hosting plan, 404 decision, processor/retention/tracking evidence,
privacy-notice correction, region/handoff, final routes and real-device verification
retain their own gates. [Dated evidence and acceptance boundaries](audits/ab137-renderer-readiness-2026-10-07.md)
record the precise preparation scope and October 8/15 decisions; AB#137/117/18 are
not closed by this checkpoint.

**Owner-accepted temporary scriptless-404 risk, 2026-10-07 (AB#132, Active):**
the owner explicitly accepted the measured accessibility/crawlability limitation
with the existing O(1) Proxy and real-404 contract retained. [Dated decision](adr/0007-proxy-request-path-boundary.md#2026-10-07-owner-accepted-temporary-residual-risk-ab132)
records impact, reason, October 8 review before go/no-go or any earlier promotion,
and AB#132 as the Active follow-up for a verified fix. AB#132 comment `59465`
records the decision; AB#18 comment `59466` links it. The earlier pending-decision
entries are historical. Expected semantic failures and JavaScript-enabled test
exceptions remain; no other launch gate or public activation is approved here.

**Contact privacy draft and current hosting preference, 2026-10-07 (AB#117/18,
Active):** the owner keeps Hobby in use for now and will reconsider later; this
records billing preference without claiming commercial hosting suitability or a
provider exception. [ADR-0004 amendment](adr/0004-reference-production-host-and-ownership-boundary.md#amendment-2026-10-07-ab18-ab117--current-hobby-preference)
and AB#18 comment `59467` preserve that boundary. A fresh published-only
CMS read informs a private FI/EN notice draft naming photography type, optional
phone/date, actual processors and published transfer facts. The draft fits the four
existing localized-text arrays; it proposes legal bases/rights and retains the
existing twelve-month mailbox promise pending operational verification. [Data-flow
checkpoint](contact-data-flow.md#2026-10-07-owner-preferences-and-notice-draft-ab117-ab18)
and AB#117 comment `59468` record account-specific checks and a new complete
baseline after any notice write. No CMS mutation, billing change or public activation
was performed; AB#117/18 remain Active.

The visual finish from the owner's Claude Design hi-fi proposal is delivered (AB#173).
The default palettes are now **Kivi** (light, `#ece9e3` ground) and **Grafiitti** (dark,
`#1b1c1e`). The site menu carries the proposal's moon/sun theme toggle
(`theme-toggle.tsx`, `aria-pressed`): the device decides until the first press, which
pins the other theme. The choice is stored in `localStorage`, never a cookie, and a
constant inline `<head>` script (`THEME_BOOTSTRAP_SCRIPT`) applies it before first paint;
without JavaScript the device decides. The language choice is in the menu too: a page's
`LanguageSwitch` publishes its identity-based links to the header through an
owner-scoped store (`language-menu-store.ts`). The bar shows a short code (EN), and the
compact panel shows the language's own name. AB#262 removes the visible nearer-page
note from both layouts and the in-page switch; the description remains available
to screen readers through `aria-describedby`.
The in-page switch stays as the fallback and is hidden only once the header has rendered
the links (`data-language-menu` on `<html>`). The contact route (`CONTACT_PATH`) shows as
a pill at the end of the bar. The wide layout switches on at `lg`, not `sm`: the
added controls no longer fit the old breakpoint (Codex review). A gallery
section's filter row wraps rather than scrolling, with `min-w-0` on each item so
one long unbroken label wraps instead of widening past the viewport (Codex
review, second finding on the same story). Instrument Sans replaced Geist as the sans face.
Moving the font variables from `<body>` to `<html>` also fixed a long-standing bug: the
web font had never actually applied, because `--font-family-sans` resolves on `:root`.
Form fields now take `--border-strong` (3:1). The story and services listings are
borderless two-column card grids with native-ratio images and three-line clamped
excerpts. Story cards now show the effective article author or, for galleries, the
site photographer name before the event date (AB#174). The home page now has an
optional photographer introduction after the hero (AB#175): a native-ratio public
portrait, localized copy, up to three facts, and contact/services actions; when absent,
the old introduction remains. Titles, prose and the header and footer follow the
proposal's scale. The
gallery section control is an underlined row of plain links that wraps, so every option
is visible without horizontal scrolling (owner decision). The proposal's 3:2 and cover crops are
deliberately not reproduced. `docs/theme-contract.md` records the palette adaptations:
the ink is darkened to `#13110e` so the derived `--subtle` role clears AA.
The gallery section row now shows its section count, and a sectioned gallery's
first slice shows the active filter heading with the exact count of public,
visible photographs (AB#179). The mock and Sanity sources use the same
eligibility rules; Sanity reads the count with a scalar aggregate, without
loading every placement. Continuation slices keep their compact layout.
The contact page now includes optional phone and preferred date, a published-service
subject with safe service-link prefill, and a settings-driven portrait and direct/social
contact column (AB#178). Its privacy notice is a native disclosure, and the
direct email link remains usable without JavaScript. Related work item:
AB#176 portfolio topic filter.

**Home and footer text reflow, 2026-10-17 (AB#339, Active):**

The home main region and shared footer allow long words and the site host to wrap
within available space. The introduction retains its 320px desktop portrait beside
the copy when both fit, and wraps into its existing mobile order when enlarged text
exhausts row capacity. The portrait keeps its complete native frame and bounded
image-size hint; copy, links, semantic styles and server rendering remain. Measured controls preserve normal
16px-root geometry and give the 768px/32px-root introduction a full-width text
column and readable fact columns. Regression coverage measures actual visible
text and region bounds at 16px and 32px CSS root sizes in both locales, including
scriptless footer navigation. AB#339 remains Active pending owner review/merge;
the separate header reflow is AB#338, and AB#252's broader acceptance remains open.

**Current integrated release evidence, 2026-10-13 (AB#284, Active):**
[Current-main Preview and fresh recovery](audits/ab284-current-integrated-preview-2026-10-13.md)
bind successful CI951 and clean source 8932116 to an owned protected deployment:
all 415 legacy rows plus 18 published EN articles/644 placements/39 pages pass.
The stable complete 17,614-document snapshot retains all FI/EN pairs; #397 removes
four audit false positives. Current local 5,158-asset byte recovery passes. Pro is
now observed; old Production remains dirty. Seven open works combine without
conflicts after #395's status fix and pass 6,121 tests, lint, build and all 415 local
legacy rows with the new direct Blog alias. ZIP support, actual final Production
checks/recovery, coordinated key replacement and owner acceptance remain open.

**DNS input follow-up, 2026-10-18 (AB#361, Active):** the offline comparator now
refuses non-regular opened descriptors before its existing 4 MiB bounded reads,
preventing a writerless FIFO from blocking the command. All three input positions
have actual-CLI refusal regressions; regular files/symlinks, strict UTF-8,
comparison policy and count/digest-only output are preserved. Files remain
sequential reads, not an atomic DNS snapshot. No DNS lookup/write, mail test or
deployment occurred. AB#200's historical closure and AB#18's open release gates
remain separate; this follow-up awaits owner review and merge.

**Offline web DNS guard, 2026-10-06 (AB#200, Active):** an owner-run normalized
snapshot comparator preserves full protected-record multisets and refuses CNAME
conflicts. It emits counts/digests only. Current zone export, live propagation and
received-mail verification remain separate AB#18/131 gates; no DNS changes were made.

**Hero CSS journey readiness, 2026-10-06 (AB#203, Active):** both real-component
hero groups wait for DOM/CSS readiness, then retain explicit font/pale-image and all
existing geometry/contrast/fade assertions. The original eager home image is held
and witnessed through HTML/CSS readiness, then drained before measurement; old load navigation timed out before assertions.
Runtime styles and accepted AB#155/171 presentation are unchanged.

**Contact email subject follow-up, 2026-10-05 (AB#188, Closed):** ordinary contact
emails use the server-resolved selected service name and optional preferred date in
the deployment's numeric date format, without an em dash or site-name suffix. Other
and older submissions keep the generic contact label. The subject is normalized to
one line and bounded to 160 Unicode code points with the full Gregorian date retained;
the body and visitor reply address are preserved. Composer and route tests cover
locale/timezone behavior, authored header controls and rejected service/date inputs.
The contact data-flow record documents date visibility in inbox and notification
previews. PR #246 is merged and exact main CI #545 passed. The fresh protected candidate
contains this format; the earlier owner delivery test used the preceding renderer and
does not validate the new subject end to end.

The header brand follows the hi-fi proposal's `.brand` (AB#187): an optional
`siteSettings.logo` and dark-theme `logoDark` (shared public images, decorative, native
ratio, 43px / 33px high), swapped by the `light-mode-only` / `dark-mode-only` rules in
`globals.css` without JavaScript, beside either one line of site name or, where a
language has a `brandDescriptor`, the photographer name with a small uppercase
descriptor before or after it as authored. The mock deployment uses brand-free 3:2
placeholder marks. The site name and title template are now authored per language and
resolved for each locale's header and metadata (`resolveSiteName`,
`resolveTitleTemplate`), falling back to the default locale's; a descriptor never falls
back to another language. A pre-AB#187 single-string `siteName` is still read as the
default name until re-authored. The proposal's footer brand block is not built.

**Studio language-version action, 2026-10-16 (AB#125, Active):** the article/gallery
editor now offers a configured missing target language, previews copied review fields
and category/shared-media notices, then explicitly creates linked drafts in one
strict-create transaction. It uses the existing authenticated Studio client; no new
endpoint or credential is introduced. Node and native browser crypto share one
planner policy and preserve deterministic IDs/ordering. Saved-source/preview changes,
release editing, bounded-read overflow, duplicate IDs and provider failures refuse
without source or media writes. No automatic translation/publication occurs.
Synthetic authoring/parity tests and Studio typecheck/schema/static build cover the
implementation; authenticated real-content creation and owner editorial acceptance
remain unexercised, and the story stays Active pending review/merge and acceptance.

**Language-version dialog redesign, 2026-10-19 (AB#125, Active):** the owner created an EN
draft of a test article with the hosted action after the lock fix (the draft appeared as
"EN · tetetet"), then asked for a dialog that needs no instructions. It now uses Sanity UI with
three numbered steps: the only remaining language is preselected, the read-only check starts by
itself and lists copied texts in author terms (title, path segment, short lead, content items)
instead of field paths, notices name categories and images by their source-language text, and
success offers "Open draft". Behaviour, guards and writes are unchanged. A contained wrapper keeps
Sanity UI's absolutely positioned radio input from covering the dialog, which a local preview
showed would otherwise intercept the create button. Verified with unit tests and an isolated
preview with synthetic data in light and dark themes; the hosted Studio needs republication and an
owner check. AB#125 stays Active.

**Language-version action always disabled, 2026-10-19 (AB#125, Active):** the owner found
"Luo kieliversio" greyed out in the hosted Studio on every article. Sanity reports an idle
document's `transactionSyncLock` as the object `{ enabled: false }`; the action tested it with
truthiness, so every loaded document counted as locked. A pure `transactionSyncLocked` helper
(`studio/editor-lock.ts`) now blocks only an enabled or unreadable lock, and the same flaw in the
client-gallery share action's handle gate is corrected. Unit tests cover the idle, active and
malformed states; the earlier synthetic tests had passed `null`. Hosted verification after Studio
republication remains owner-run and unperformed; AB#125 stays Active.

**Localized draft source review, 2026-10-05 (AB#125, Active):** the pure planner
now checks selected gallery and article end-gallery source placements as well as
the source page. Pending or malformed localization reviews refuse another derived
language; reviewed placements get a fresh target review list. A review marker
without `localizedFrom` is checked too. Studio action UI and live authoring checks
remain open; this follow-up adds no provider write or public UI.

**Premium delivery preparation, 2026-10-05 (AB#44, Active):**
[ADR-0025](adr/0025-premium-source-distribution.md) proposes versioned source ZIP
delivery followed by private repository releases if recorded manual work warrants it.
It compares Git/release, archive and package delivery, handles template-history and
customization baselines, and records a synthetic WSL three-way merge experiment
(including conflicts and CRLF). Native Windows delivery remains unverified. AB#42
and this decision still need acceptance; no Premium artifact or service is built.

**Owner decisions on post-MVP ADRs, 2026-10-19 (AB#42, AB#44, AB#126, AB#127, all Active):**
the owner accepted [ADR-0024](adr/0024-free-core-and-premium-boundary.md) (Free Core
boundary; price and demand remain with AB#45), [ADR-0025](adr/0025-premium-source-distribution.md)
(manual ZIP delivery from owner-controlled cloud storage, migration threshold decided
later; a Windows verification procedure was added and has not been run) and
[ADR-0026](adr/0026-editorial-assistant-provider-boundary.md) (suggestion-only editorial
assistant; €15 monthly cap, text classes including captions and alt text, AB#125 first).
[ADR-0027](adr/0027-public-chat-and-knowledge-boundary.md) was **deferred** and stays
Proposed, with the owner's provisional answers recorded. No Premium artifact, AI port,
SDK, provider, infrastructure or chat feature exists; acceptance builds none of them,
and each ticket stays Active for its remaining criteria.

**Commercial terms preparation, 2026-10-05 (AB#49, Active):** the
[requirements worksheet](commercial-policy-requirements.md) maps separate
software/digital delivery and service/bundle classification, MIT and third-party
notices, sales/support/privacy/exit documents, current consent/withdrawal review
and the facts needed by legal and tax advisers. It is not operative terms or legal
advice. AB#45 offer validation, actual seller/offer facts and qualified signoff
remain open; no payment code or completed commercial launch gate is claimed.

**Editorial AI preparation, 2026-10-05 (AB#126, Active):**
[ADR-0026](adr/0026-editorial-assistant-provider-boundary.md) proposes a neutral
suggestion port, server-authorized direct inference, per-target acceptance
preconditions, transient suggestions, protected live evaluations and privacy/cost
controls. It requires owner acceptance and AB#125 integration before implementation.
No port, AI SDK, infrastructure, inference or Studio suggestion UI exists yet.

**Public chatbot preparation, 2026-10-05 (AB#127, Active):**
[ADR-0027](adr/0027-public-chat-and-knowledge-boundary.md) proposes separate chat and
retrieval ports, published public knowledge with authoritative eligibility checked
before inference and before output, synchronization/reconciliation, structured
canonical citations, browser-memory conversation and atomic spend admission.
Defaults and evaluation thresholds require acceptance; no chatbot, index, profile
schema, model adapter or infrastructure exists. AB#126 remains a predecessor.

**Email-account MFA confirmation, 2026-10-07 (AB#117, Active):** the owner
confirms two-factor login enabled on both Infomaniak and Resend, recorded in
AB#117 comment `59470`. This resolves the MFA uncertainty in the earlier contact
checkpoint on owner confirmation; no independent dashboard inspection was performed.
Key permissions/domain restriction, tracking, provider retention and practical mailbox
deletion remain open. No provider setting or CMS content was changed.

**Email settings confirmation, 2026-10-07 (AB#117, Active):** the owner confirms
the existing Resend key is sending-only and restricted to the verified domain,
both tracking controls are off and the Resend plan is Free (comment `59471`).
Those checklist items are resolved on owner confirmation; no independent dashboard/API
readback was performed. The contact inventory records Resend's published 30-day
email/log and 7-day backup policy. The supplied Infomaniak description matches
kSuite Free. The owner commits to twelve-month enquiry/own-copy deletion with
necessary contract/legal exceptions (comment `59472`); no automatic deletion job or
mailbox audit was performed. Exact technical backup erasure and other launch checks
remain open.
The notice remains a local draft; no CMS or provider change was performed by this task.

These notes go stale easily — treat it as a starting hint, not as truth. The MVP
checklist lives in `README.md`, and Azure Boards is authoritative. Before starting work,
check the current state of the code and the relevant work item scope; do not assume a
feature exists or is missing.


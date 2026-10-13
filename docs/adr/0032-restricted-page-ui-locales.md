# ADR-0032: Locale selection on restricted and retained legacy pages

**Status:** Accepted
**Date:** 2026-10-12
**Deciders:** Project owner (explicit approval, 2026-10-12)
**Work item:** AB#255

## Context

AB#255 requires Finnish and English across every page family. Protected client delivery/proofing, its independent administrator interface and retained unlisted legacy galleries currently choose the deployment-default UI locale in their own document roots. Public localized routes are a separate contract. This proposed first slice selects built-in interface labels; it cannot make unreviewed authored gallery titles or image text into accepted translations.

Verified code: private-gallery/layout.tsx and page.tsx use defaultLocale; private-gallery-admin/layout.tsx and page.tsx use default labels/locale; client-gallery/layout.tsx/page.tsx use defaultLocale. Existing private bootstrap captures and strips the capability fragment before router initialization, preserving pathname + search for the exchange's clean navigation. Login/logout are JSON APIs; frontend controls currently assign pathname alone, dropping the query. A later locale slice must preserve only a validated locale on the same fixed page. Legacy manifest includes each image alt. These files match their source hashes on merged baseline `4382537`, after both PR #355 and PR #356.

## Decision

Use one optional GET UI selector, `locale`, on the existing restricted/legacy page namespace, using an exact configured full locale tag. It never proves authorization, chooses a session, changes a capability, or authorizes an image/ZIP. When absent, empty, repeated, overlong, malformed, or unsupported, select the deployment default without reflecting input, redirecting, adding cookies, or changing existing refusal/status/header behavior. Do not infer browser language or redirect from Accept-Language. Full configured tags are a closed allowlist; case/region variants that are not the exact configured spelling are unsupported.

Switch with a plain same-origin anchor that performs a document navigation on the current canonical page path and sets only a validated locale. Do not append fragments, credentials, arbitrary return URLs or unrelated query values. Root html.lang, labels and date formatting must select the same request locale. Next layouts do not receive fresh search parameters on client navigation; therefore a future implementation needs one bounded proxy-owned request-locale value, overwritten on every relevant matched request and validated again at the layout/page boundary. A caller-provided header cannot supply a preference. No content lookup belongs in Proxy. The existing bounded path/cursor header contract stays unchanged; the new value would be separate and non-sensitive. No runtime header is added by this proposal.

Protected gallery: before successful fragment capture/removal, expose no outgoing language switch that can carry or lose an unsafely retained capability. The existing bootstrap must still run first. A caller-supplied valid locale query may survive capture/exchange/clean reload; language selection never changes exchange JSON, API paths, proof/asset permission checks or payload grammars. An authorized session can change language using the clean page URL. Every unauthorized outcome retains the same generic bootstrap and no private/public content lookup. Failed scrub behavior requires an explicit regression case; never propagate the fragment to repair it.

Administrator: retain its independent path/session/cookie/origin/rate-limit/no-store boundary. Select built-in labels for sign-in, failed/unavailable state, draft/proof controls and async statuses; existing APIs continue their closed JSON grammars and status behavior. Successful login/logout reload only the same fixed relative page with a validated locale; do not add a return parameter or put locale in the secret/body/session authority. Persistent locale is the page URL, not a preference cookie.

Retained legacy: valid locale selects built-in UI only, preserving expiry, namespace hygiene, no-store/noindex/referrer protections, individual processed-image and ZIP bytes/resolutions, and ADR-0028's specific owner-accepted exposure. Do not change imported alt in-place: its value participates in the retained manifest. No localized metadata overlay/schema/asset rewrite is proposed. Mark authored-text ownership as pending; do not silently label unchanged source prose as English. Full-page language acceptance requires a later reviewed authored-text decision (owner-declared neutral values or accepted locale metadata), not automatic copy-through.

All three families stay out of public sitemap, canonical/hreflang alternates and ordinary navigation/search. Existing non-public metadata must not introduce indexable language alternates. Locale does not relax CSP, cache, robot, referrer, cookie or storage rules.

## Options Considered

- Query selector in existing namespace (recommended): preserves deployed capability paths and independent cookies, lets a shareable clean UI preference accompany the page, and needs a bounded validated request value plus hard reload for the document root.
- Prefix-specific routes: match public routing aesthetically but add new private/admin/legacy path grammar, proxy handling, cookies and link-bootstrap compatibility work. A separate accepted URL decision would be needed; do not inherit public prefixes automatically.
- Cookie/browser-language selection: adds persistence/implicit behavior and does not provide an explicit same-page choice; no current requirement justifies it.

## Trade-off Analysis

The query selector is visible and copyable, costs dynamic request handling already present on these shells, and preserves existing access boundaries. Hard navigation can discard unsaved proof/admin edits. Future UI must warn or defer switching when it would discard edits, without implementing a new autosave or changing confirmation semantics. It must not preserve operation tokens/cursors merely to preserve locale.

Locale-selectable labels are a first bounded slice, not complete bilingual authored pages or authentication/production proof. Invalid locale falls back to default so new grammar cannot be an existence oracle; existing refusal semantics remain authoritative.

## Consequences

This proposal changes no route, request header, auth/session/cookie, API body, schema, data, image, manifest, storage, deployment or diagram. Accepted ADRs remain unchanged. The owner accepted the selector on 2026-10-12. Separate authored-text compatibility work remains; general album-image captions and alt text are deferred until after MVP under the same continuation. All-pages AB#255 remains Active.

## Action Items

- Owner selector approval received on 2026-10-12; keep authored-text separation explicit.
- Implement a pure bounded configured-tag parser and validated header/page/layout adapter in a small slice; keep raw cookie rejection and capability bootstrap ordering.
- Verify FI/EN html.lang, built-in labels, dates, switch/reload/back-forward and disabled-JavaScript UI where supported; preserve noindex/no-store/referrer rules under configured and literal namespace aliases.
- Exercise repeated/unsupported/overlong locale, spoofed request headers, unsrubbable capability, unauthorized/revoked sessions, login failures/logout, proof actions and dirty edits with synthetic production-build fixtures.
- Compare authorized gallery/object identities and complete image/ZIP bytes, not equality of independently minted signed URLs. No real client/credential/media fetch.
- Decide and verify authored titles/alt/captions separately before full bilingual page acceptance; preserve retained legacy manifest and immutable source approvals.

Primary framework facts checked against [layouts](https://nextjs.org/docs/app/api-reference/file-conventions/layout), [page search parameters](https://nextjs.org/docs/app/api-reference/file-conventions/page) and [request headers](https://nextjs.org/docs/app/api-reference/functions/headers). Project pins Next16.3.8; current documentation is a design reference, not a completed project-specific runtime test. Required production-build behavior remains an implementation gate.

The owner instructed this continuation to proceed without Claude on 2026-10-12.
The final source review at the proposal stage changed the review workflow, not
the decision status. The later explicit owner acceptance is recorded below.


Owner acceptance, 2026-10-12: "Hyväksyn ADR-0032:n kielivalinnan."
Configured full tags remain authoritative: for example a configured `en-GB`
requires `?locale=en-GB`, not its unconfigured `en` shorthand. The owner also
explicitly deferred general album-image alt/caption authoring until after MVP.
This deferral does not remove existing image descriptions or change retained
legacy manifests, media references, bytes, authorization or download semantics.

Implementation checkpoint: the restricted-page locale branch implements the
proxy-owned selector, plain document switches, localized labels/dates, clean
login/logout reload and generic error boundaries. The context above describes
the proposal's original baseline. Source validation and production-build fixture
journeys are recorded in [the implementation audit](../audits/ab255-restricted-page-locales-2026-10-12.md).
Authored-title acceptance and production activation remain separate.

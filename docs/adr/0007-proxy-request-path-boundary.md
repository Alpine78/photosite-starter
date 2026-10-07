# ADR-0007: A Proxy request boundary carrying the requested path

**Status:** Proposed
**Date:** 2026-08-13
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#72

## Context

ADR-0003 decision 8 requires one thing this application could not do:

> An unknown section and a malformed, tampered, wrong-scope, or stale cursor return an
> accessible 404 response **with a link to the gallery's parameter-free first page**.

The route that refuses the request knows exactly which gallery that is. The 404 that
renders does not, and there is no supported way to tell it. Two facts, both verified
against Next.js 16.2 rather than assumed:

- **`not-found.tsx` is rendered with no props.** In `create-component-tree.tsx` the
  boundary is created as `createElement(Component, null)` — no `params`, no
  `searchParams`. This is the only rendering path for every not-found boundary in App
  Router, so no route context reaches it.
- **The boundary renders *before* the page.** A per-request `React.cache()` holder,
  written by the page immediately before `notFound()` and read by the boundary, reads back
  empty. Instrumented against a production build, the read logged ahead of the write with
  the same holder identity — the cache scope is shared, but the data would have to travel
  backwards through render order.

So the refused address has to arrive out of band. Next.js 16 renamed Middleware to
**Proxy** (`proxy.ts`), which runs before a request completes and can add request headers
via `NextResponse.next({ request: { headers } })`. That is the remaining mechanism.

Introducing it is not a small thing. It runs on every matched request, so its cost is the
site's cost on every page view, and a request-header boundary is a place where trusted and
untrusted data meet.

## Decision

Add `src/proxy.ts`. It copies the requested pathname into `x-photosite-request-path`, and
whether a `cursor` parameter was present into `x-photosite-request-has-cursor` — two
project-owned request headers, on the routes that can render a content 404. It also owns
trailing-slash normalization: `skipTrailingSlashRedirect` disables Next.js's earlier
automatic redirect so a gallery token can be validated before any permanent response.

Five constraints define it, and each is enforced rather than documented:

1. **O(1) and nothing more.** No content reads, adapter calls, secrets, or `await`. An
   ordinary request copies two bounded facts. A trailing-slash request additionally reads
   the cached locale route configuration to distinguish a possible story path from an
   ordinary route; it does not resolve the path or gallery.
2. **The pathname, and one bit — never the token.** A continuation token is a signed value
   whose only legitimate reader is the gallery adapter; copying it into a header would
   spread it across a layer with no business holding it. What the 404 needs is not the
   token but the first gate on the *reason*: without a cursor this cannot be the
   invalid-continuation case. So the Proxy carries presence (`1`, or the header absent) and
   nothing else. The 404 then resolves the path and verifies both the content page and the
   parameter-free gallery result; presence alone never proves a destination works.
3. **No secrets.** The cursor signing key is server-only and lazily resolved. Nothing here
   touches it, and the Proxy runtime never needs it.
4. **Unconditional overwrite.** `Headers.set` replaces any client-supplied value of that
   name. The reader validates the value again anyway — as an absolute, same-origin,
   single-line, bounded path — because paths the matcher excludes never pass through the
   Proxy at all, and a header is untrusted input in its own right.
5. **A narrow matcher.** `_next/*` and every path carrying a file extension are excluded.
   API routes remain matched only so the Proxy can preserve Next.js's former trailing-slash
   308 after the global automatic redirect is disabled; ordinary API requests pass through
   without either project header.

The 404 boundary for the public content space (`ContentRouteNotFound`) reads both headers
and offers a link only when a cursor was refused **and** the path resolves — through the
*same* resolver the route itself uses — to a gallery whose content page and parameter-free
result are both served. It may follow one resolver-owned canonical redirect so casing,
redundant-prefix, trailing-slash, and retired-path spellings still get the required link.
An unknown address, or a gallery that failed for any other reason, keeps the bare 404: a
guessed destination would lead from one 404 to another.

For trailing slashes, Proxy restores the ordinary direct 308 itself on non-story routes.
A possible story path reaches the route with the original bounded pathname in the header.
The resolver treats the slash as one more normalization defect: a valid gallery cursor is
carried unchanged to the direct canonical destination, an invalid one 404s before a
redirect, and a path with casing or prefix defects collapses them in the same hop.

`RouteNotFound` — the static route spaces' 404 — is deliberately left alone. Reading
`headers()` is a dynamic API, and a boundary that reads one opts every route beneath it
out of static rendering; confining it to the content routes, which are already dynamic
because they read `searchParams`, keeps `/`, `/contact`, `/services`, and
`/services/[slug]` prerendered. That was measured, not assumed: a shared header-reading
404 turned all four dynamic in the build output.

## Options considered

| Option | Verdict |
| --- | --- |
| **Proxy sets a request header** | **Chosen.** Server-rendered, no client dependency, one small file, and the reader can verify the path against the content tree. |
| Per-request `React.cache()` handoff | Rejected — verified not to work: the boundary renders before the page. |
| Client component using `usePathname`/`useSearchParams` | Rejected. The link would depend on JavaScript, which is the opposite of what continuation is built for, `useSearchParams` forces a client bailout on every 404, and the path is not verified, so it can link to another 404. |
| Amend ADR-0003 to drop the requirement | Rejected. A stale indexed continuation URL is exactly the case the requirement exists for. |
| Proxy carrying the query as well | Rejected. It would put a signed cursor into a header read by a layer that must not interpret one. Presence is the only query fact the 404 needs before it independently verifies the destination. |
| Offering the link on any resolvable gallery path | Rejected. A gallery whose content failed to load would then link back to the address that just failed. |
| Keep Next.js's automatic trailing-slash redirect | Rejected. It runs before the route can validate a cursor, so a malformed token would create a cached 308 in direct conflict with ADR-0003 decision 8. |

## Consequences

- The project has a Proxy. Anything added to it later is paid on every matched request,
  and this ADR is the record that it is meant to stay O(1). Route decisions, content
  lookups, authentication, and personalization do not belong there.
- Both header names are project-owned and are overwritten, never merged. Reading either
  anywhere else means going through `readRequestPath` / `readRequestHasCursor`, which
  validate — the flag by exact match, so a client's own guess never becomes a link.
- Running Proxy is now part of the routing contract. Without it the 404 loses its request
  facts and, because Next.js's automatic trailing-slash redirect is disabled, slash
  variants are no longer normalized. A deployment that cannot run Proxy is unsupported.
- The static route spaces stay statically rendered. A future need for the header outside
  the content routes has to weigh that cost again.

## Known limitation

**404 responses deliver their semantic UI as RSC payload, not as initially rendered HTML,
so the link cannot be seen without JavaScript.** Every tested 404 on this site returns
Next's internal `__next_error__` document. Its body contains a hidden placeholder and
scripts carrying the flight payload, but no rendered heading or link; the `404` and this
return link appear only after that payload is applied.

This is not caused by continuation, and it is not caused by anything this ADR adds:
verified on `main` before this branch, where `/`-level, `/services/*`, and content-tree
404s all behave identically.

Four candidate explanations were explored against production builds:

| Hypothesis | Test | Result |
| --- | --- | --- |
| Multiple root layouts (`(default)`, `[localePrefix]`) leave no document to render into | Collapsed to one root `layout.tsx`, segment layouts reduced to fragments | Unchanged |
| No root-level `not-found.tsx` for the synthetic `/_not-found` entry | Added `src/app/not-found.tsx` | Unchanged |
| `global-not-found.tsx` is the sanctioned fix for multiple root layouts | Added the file and `experimental.globalNotFound: true` | No effect on tested URLs. The app's optional catch-all route matches unknown public paths, so this does not test `global-not-found`'s unmatched-route case. |
| Turbopack-specific | Rebuilt with `next build --webpack` | Unchanged |

The observed behavior is therefore unresolved in this Next.js 16.2.11 application; the
experiments narrow it but do not establish a framework root cause. Resolving it needs a
minimal reproduction, comparison with a newer Next.js release, and then either an upstream
issue or a project mechanism that does not rely on this `notFound()` rendering path. That
investigation is separate from gallery continuation.

**2026-09-03: still reproduces on Next.js 16.3.2.** AB#117 bumped the framework as part of
its dependency remediation, so the "comparison with a newer release" was worth performing
directly. A plain `curl` of an unknown path against a production build — `next build` then
`next start`, no browser and no JavaScript at any point — returns
`<html id="__next_error__">` with no `<h1>` anywhere in the initially rendered HTML. One
version step is not the full comparison this record asks for, and it establishes no root
cause; what it does establish is that the limitation is not already fixed, so nothing here
is retired.

AB#132 owns that investigation and is `Active`. It was briefly closed and reopened on
2026-09-03, because none of its own "Done when" conditions held: the semantic 404 HTML
above, the removal of the continuation journeys' JavaScript-enabled exception, and an
updated or retired limitation here. Until it lands, the continuation journey covers the link
with JavaScript enabled and says why at the point it does. The link itself is server-rendered — a Server Component reading a
request header, with no client code involved — so it needs no change when the framework
behaviour does.

**2026-09-03, later the same day: root cause isolated.** The defect is specifically
`notFound()` called from a **matched route**, not 404s in general: a genuinely unmatched
URL renders its `not-found.tsx` correctly, with a real `<h1>` in the initial HTML. This
site's optional catch-all (`[localePrefix]/[[...segments]]`) matches every unknown public
path, so no request here ever reaches Next's working unmatched-URL branch — every 404 on
the site goes through the broken one. Reproduced in a minimal four-file app outside this
codebase (no proxy, no route groups, no config), which rules this in as a framework
behavior rather than an application defect. A verified workaround exists — a Proxy rewrite
onto a path matching no route makes Next take its working branch — but it requires the
Proxy to know a request will be refused before the route decides, which is exactly what
this ADR's O(1), content/adapter-read-free boundary forbids. That trade is a decision for
the site owner, not something to make inside an investigation.

**2026-09-11: this is a known, already-tracked upstream Next.js defect, not a
photosite-starter-specific one.** Before doing anything further, the investigation
checked for an existing report rather than assuming none existed:
[vercel/next.js#62228](https://github.com/vercel/next.js/issues/62228), open since
February 2024, describes the identical matched-route-vs-unmatched-URL split, and was
already reconfirmed against Next.js 16.3.1 and 16.3.3 by other reporters days before this
check. A first proposed fix, `#88491`, was rebased and reworked once already (2026-08-27)
after the code it patched was restructured, but its author closed it unmerged on
2026-09-04 — not merely stalled, abandoned. A follow-up attempt, `#98455`
("Fixes #62228"), opened 2026-09-09 by a different contributor, cites #88491 by name and
takes a similar approach against the current code structure; still open and receiving
updates as of this check, it is the current live fix candidate, but neither has landed.
A fresh, independent minimal reproduction — the same four files quoted above,
against `next@16.3.5` (current stable), `react`/`react-dom@19.3.0`, Node `24.20.0` —
confirmed the defect still reproduces and was added to that thread as a comment, with two
diagnostic details not previously called out there: the response's own `<html>` tag has
its author-set attributes replaced by `id="__next_error__"` in the broken case, and the
broken response's RSC flight payload carries an error digest
(`NEXT_HTTP_ERROR_FALLBACK;404`) that the working response's payload does not — even
though both payloads correctly serialize the same rendered not-found tree. This does not
change any of the "Done when" conditions above; it establishes that the fix, if it comes,
will come from upstream.

**Owner decision, 2026-09-11: retain this ADR's O(1) Proxy boundary; do not implement a
pre-route content check to work around this.** The verified workaround above is a lead
with a named cost, not yet shown to be the only path, and trading away this boundary for
one story is not a decision to make inside that story. AB#132 stays `Active`, the
continuation journeys keep their `javaScriptEnabled: true` exception, and this limitation
stays open — tracked upstream rather than solved locally — until either the upstream fix
lands or the trade-off above is revisited on its own terms, which should happen no later
than before AB#18's production promotion if the upstream issue is still open by then.

## 2026-10-02 release-candidate recheck (AB#132)

A fresh production build of the AB#186 dependency candidate uses **Next.js
16.3.8**, Node 24.20.0 and the harness-owned mock deployment settings. The
Chromium desktop and WebKit mobile journeys both run with JavaScript disabled
and inspect actual accessible heading/link nodes after a complete page load,
independently verifying HTTP 404 and no redirect. Heading text embedded in RSC
scripts is never the semantic detector.

| Request | Engines | HTTP | Rendered h1 | Gallery return link |
| --- | --- | ---: | ---: | ---: |
| Unknown public URL | Chromium + WebKit | 404 | 0 | 0 (none should be invented) |
| Existing gallery, malformed continuation | Chromium + WebKit | 404 | 0 | 0 (required, missing) |

The [four raw observations](../audits/ab132-2026-10-02-scriptless.json) record
the fixture-derived paths, framework version, `__next_error__` HTML id and
**present** `NEXT_HTTP_ERROR_FALLBACK;404` digest. Both required semantic journeys
still fail. `e2e/gallery-continuation.spec.ts` now carries explicit known-failure
probes with JSON attachments. Setup, HTTP status, external-request checks and a
changed-but-still-broken signature fail before the known-failure marker. A
complete semantic fix instead produces an unexpected pass, requiring removal
of that marker and the JavaScript-enabled gallery/category exceptions. A green
runner result with four expected failures is not a successful scriptless journey
or owner acceptance.

**Current upstream check, 2026-10-02:** the official GitHub API reports
[issue #62228](https://github.com/vercel/next.js/issues/62228) open (last updated
2026-09-29), and [PR #98455](https://github.com/vercel/next.js/pull/98455) open,
unmerged, at head `8b76611b5edd80c5a35c6fbb5c2b174a7d6398e7` (last updated
2026-09-12). The proposed fix documents a fallback to the empty shell when
nested not-found boundaries are present. Landing that PR alone must not be
treated as proof that this application's route topology passes; rerun the
actual probes against the exact release candidate.

The installed 16.3.8 guide and current [official not-found reference](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
still describe `global-not-found` as an unmatched-URL mechanism. The application's
optional catch-all matches these requests. The supported [notFound function](https://nextjs.org/docs/app/api-reference/functions/not-found)
throws the 404 fallback; moving the check behind streaming can preserve a shell
but returns a 200, which does not meet this application's real-404 contract.
These documented mechanisms do not establish a bounded local fix for the
measured matched-route defect. No new global-not-found experiment, framework
patch, pre-route content lookup or 200 substitution is introduced here.

**Owner decision still required before AB#18.** The 2026-09-11 decision to retain
the Proxy boundary remains in force; it did not accept this release candidate's
accessibility/crawlability gap. Impact: visitors with JavaScript disabled see a
blank 404 and cannot use the invalid-continuation return link; crawlers that do
not execute scripts receive no semantic recovery content. The reason to retain
the current boundary is its O(1), adapter-read-free routing cost and the absence
of a verified supported local remedy that preserves HTTP 404. The owner can
withhold promotion or explicitly accept that bounded limitation; this amendment
makes neither choice.

**Proposed review date:** 2026-10-08, before AB#18's existing go/no-go, or earlier
when a supported upstream fix is released. **Follow-up:** AB#132 remains Active
for the actual semantic fix; if it is later closed on an accepted-risk basis,
record a successor for that fix first. Record impact, reason, review date and
follow-up on the owner's decision, then link it from AB#18. The deployment
runbook points here, but no acceptance or production promotion is recorded.

## 2026-10-03 main-branch recheck and decision proposal (AB#132)

The [fresh audit](../audits/ab132-2026-10-03-scriptless.json) records a production
build of main commit `f7b26e197a93efe263bbfc8e2d0d70f640c44f7a`, after AB#19's
legacy-redirect verification merged. It includes the build ID, UTC run time,
installed versions, command and four raw observations. The harness builds before
`next start` and refuses an existing server (`reuseExistingServer: false`). The
detector is Playwright's `getByRole` against rendered heading/link nodes with
JavaScript disabled after `waitUntil: "load"`; text in RSC scripts cannot pass it.

**Result:** unchanged on Next.js 16.3.8, still the npm `latest` release at this
check. Both Chromium and WebKit return HTTP 404 without a redirect for an unknown
gallery slug under an existing parent (matched by the catch-all) and a refused
continuation, with zero rendered headings and return links.
The gallery/category suites have **36 passing journeys and four expected
failures**, not 40 successful semantic journeys. JavaScript-enabled recovery
controls pass. The AB#72 gallery/category exceptions remain necessary. This is a
fixture-backed production build, not a smoke test of the live CMS deployment.

**Upstream, checked 2026-10-03:** [issue #62228](https://github.com/vercel/next.js/issues/62228)
and both [#98455](https://github.com/vercel/next.js/pull/98455) and
[#98583](https://github.com/vercel/next.js/pull/98583) remain open; neither PR is
merged. The audit preserves their exact heads and update timestamps. Unlike
[#98455's nested-boundary fallback](https://github.com/vercel/next.js/commit/1f38b1727faff130389e20f6ac2c214edda7fd8d),
#98583 proposes rendering the nearest
not-found boundary inside its layouts. A [2026-09-29 report on the issue](https://github.com/vercel/next.js/issues/62228#issuecomment-5894229713)
describes success with that patch under a dynamic locale root. That is another
reporter's measurement of an unreleased framework branch, not verification of
this application's multiple root layouts, async boundary or return-link logic.
It establishes neither a supported local remedy nor a release date.

**Bounded remedy assessment:** the installed 16.3.8 guides, current official
[not-found reference](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
and [notFound reference](https://nextjs.org/docs/app/api-reference/functions/not-found)
retain the distinctions measured above:

| Option | Disposition within the retained boundary |
| --- | --- |
| `global-not-found` | Handles unmatched routes; these requests match the catch-all. No supported fix established for this case. |
| Existence check after streaming starts | The [documented streaming behaviour](https://nextjs.org/docs/app/api-reference/functions/not-found#calling-notfound-after-streaming-has-started) preserves a shell but returns 200, violating the real-404 contract. Not re-prototyped here. |
| Proxy content lookup and rewrite | The earlier verified workaround requires pre-route content knowledge, excluded by the owner's 2026-09-11 decision. |
| Custom HTML Route Handler | [Documented constraint](https://nextjs.org/docs/app/getting-started/route-handlers#route-resolution): a handler cannot share a route with a page or participate in its layouts. **Assessment, not prototyped:** intercepting page-decided failures would need a different routing/rendering arrangement; no bounded implementation verified here. |
| Unreleased framework patch | Both candidates change Next.js internals; neither is a supported stable release. No patch is vendored. |

This assessment finds no verified supported remedy within the retained boundary;
it does not claim all possible remedies are exhausted. A future passing build
must pass both semantic probes and the recovery controls before removing their
known-failure markers and JavaScript-enabled exceptions.

**Proposed temporary residual-risk decision — pending owner acceptance:**

- **Impact:** a visitor without JavaScript sees a blank 404 and cannot follow the
  refused continuation's return link; a crawler that does not execute scripts
  receives no semantic recovery content. The measured status remains HTTP 404.
- **Reason:** retain the O(1), adapter-read-free Proxy and real-404 contract while
  no supported remedy has been verified; avoid taking over unreleased framework
  internals for this launch.
- **Review:** 2026-10-08, before AB#18's go/no-go or any earlier promotion;
  reassess sooner if a supported upstream fix is released. Retest the exact
  candidate even if an upstream PR has merged.
- **Follow-up item:** AB#132 itself remains Active for the semantic fix; accepting
  this temporary risk does not close it. If it is later closed on accepted-risk
  grounds, create and record a successor first.
- **Launch gate:** the owner may accept this temporary residual or withhold
  promotion. After the decision, the maintainer records it on AB#132 and adds its
  permalink to AB#18 before promotion. The dependency already exists; this
  investigation constitutes neither risk acceptance nor promotion approval.

## Action items

- [x] `src/proxy.ts` with the bounded copy, the unconditional overwrite, and a narrow matcher
- [x] `src/lib/request-path.ts` owning the header name, the bound, and the validation
- [x] `ContentRouteNotFound` resolving the path through the route resolver
- [x] Tests: path validation including protocol-relative and backslash forms, served
      return-link resolution through canonical normalization, cursor-aware trailing-slash
      behavior, and a journey proving spoofed headers cannot choose the target
- [x] A work item for the non-semantic initial 404 document: **AB#132**, which carries the
      ruled-out experiments and the root-cause isolation above. A minimal reproduction
      confirmed this is a known, still-open upstream Next.js defect
      ([vercel/next.js#62228](https://github.com/vercel/next.js/issues/62228)) rather than
      an application-specific one; the owner decision above tracks it there instead of
      working around it locally. Retiring the limitation below also retires the
      JavaScript-enabled exception in the continuation journey.

## 2026-10-05 merged release build check (AB#132)

The exact PR #246 merged source (`4b8dd013880eddf79e54e42244d18f5cda32d860`),
Next.js 16.3.8 and Node 24.20.0 was built with the live public Production CMS settings.
An owned local production server used a synthetic cursor key and no delivery credential.
Chromium and WebKit, JavaScript disabled, both measured an unknown matched route and a
refused existing-gallery continuation after page load. All four returned HTTP 404 and
noindex without a redirect, with zero rendered headings; both continuation cases also
had zero required return links. The `__next_error__` document and fallback digest were
present. The owner-only receipt is retained with the release evidence; this is a local
production-build measurement, not a physical-device test or a provider-deployment
Playwright result.

The existing O(1) Proxy decision and supported-remedy assessment above remain in force.
No framework patch or content lookup was introduced. The October 8 review proposal,
required explicit owner decision before AB#18, and AB#132 follow-up remain unchanged.
Main CI #545 passed its gates with the documented expected failures; it does not mean
scriptless recovery passed. No residual acceptance or public promotion is recorded.

## Scriptless checkpoint, 2026-10-06 (AB#201)

The merged baseline's four production-build cases still return HTTP404 with the
known empty shell: neither browser renders the required heading, and refused gallery
continuations have no parameter-free return link. The harness classifies the four
assertion failures as expected; they are not passing accessibility journeys.
[Redacted observations and exact identities](../audits/ab132-2026-10-06-scriptless.json)
record the source/build, harness locale, package versions and artifact hashes.
Official issue62228 remains open; PR88491 is closed without merge; PR98455 and98583
remain open/unmerged at the recorded check time. AB#132's launch decision remains
pending. No CMS existence lookup, framework upgrade or risk acceptance is introduced.

## 2026-10-07 release-candidate and latest-stable check (AB#132)

The [dated audit](../audits/ab132-2026-10-07-scriptless.json) records a fresh
production build of PR #281's exact source
`9aadd907633c7e39279ac2bd1e810f3b32a212cd`, on Next.js 16.3.8 and React 19.2.1.
The gallery/category suites exit successfully and report 40 passed, but that
total includes **four expected semantic failures**. The 36 other journeys pass,
including the JavaScript-enabled recovery controls. In both Chromium and WebKit,
an unknown matched gallery path and a refused continuation return HTTP 404 with
zero rendered headings and return links, the `__next_error__` document and the
fallback digest. The harness uses mock content, not live CMS data.

The npm registry now resolves `next@latest` to **16.4.0**. A separate, freshly
installed four-file App Router reproduction with that version and the same
React 19.2.1 also reproduces the matched-route defect: `/throws`, which calls
`notFound()`, returns HTTP 404 without an HTML heading or return link. Its
unmatched `/no-such-path` control returns HTTP 404 with both elements. The
detector parses actual HTML start tags; it does not search for text inside
scripts. The audit includes the scaffold, versions, lockfile hash, build ID
and response hashes. This isolated check does not upgrade the application or
prove its whole route tree on 16.4.0.

[Issue #62228](https://github.com/vercel/next.js/issues/62228) and proposed fixes
[#98455](https://github.com/vercel/next.js/pull/98455) and
[#98583](https://github.com/vercel/next.js/pull/98583) remain open; neither fix is
merged at this check. The earlier bounded-remedy assessment and O(1) Proxy
decision remain in force. A framework bump alone is not a verified remedy.

The temporary residual-risk proposal above remains **pending owner acceptance**,
with its October 8 review before AB#18's go/no-go or any earlier promotion.
AB#132 stays Active. A successful quality pipeline or a protected Preview
does not supply that acceptance or authorize public promotion.

## 2026-10-07 owner-accepted temporary residual risk (AB#132)

**Status: Accepted, limited to the temporary residual described below.** After
reviewing the measured impact and the proposed decision, the owner explicitly
accepted it in this session: “Hyväksyn riskin.” This dated decision supersedes the
pending-acceptance status of the October 3 proposal and October 7 checkpoint;
the measured failures and the wider ADR's status are preserved.

- **Impact:** without JavaScript, an unknown public URL or refused gallery
  continuation returns HTTP 404 without a visible error heading or required
  gallery return link. Scriptless crawlers receive no semantic recovery content.
  JavaScript-enabled recovery controls pass; HTTP 404 remains the response status.
- **Reason:** retain the O(1), adapter-read-free Proxy and real-404 contract while
  no supported remedy has been verified; avoid maintaining unreleased framework
  internals for this launch.
- **Review:** 2026-10-08 before AB#18's go/no-go or any earlier promotion;
  reassess sooner if a supported upstream fix is released. Retest the exact candidate.
- **Follow-up:** AB#132 remains Active for the semantic fix. Keep expected-failure
  markers and the JavaScript-enabled exceptions until both scriptless semantic
  probes and recovery controls pass. This acceptance does not close the story
  or supply approval for other launch gates.

The [authoritative decision comment](https://dev.azure.com/ilkkarytkonen/62b19d48-11f0-4c5a-a41b-58913c123cfd/_apis/wit/workItems/132/comments/59465) is recorded on AB#132 as
comment `59465`; AB#18 comment `59466` links that exact decision. Both items remain
Active. No public activation, CMS write or DNS change was performed.

A fresh upstream metadata check on 2026-10-07 confirms [issue #62228](https://github.com/vercel/next.js/issues/62228)
and candidate fixes [#98455](https://github.com/vercel/next.js/pull/98455) and
[#98583](https://github.com/vercel/next.js/pull/98583) are open; neither fix is merged.
There is no confirmed release date. A merged proposal alone does not establish a
supported released fix or a passing project-specific journey.

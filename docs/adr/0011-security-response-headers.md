# ADR-0011: Security response headers and the CSP inline-content trade-off

**Status:** Accepted
**Date:** 2026-08-22
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#117

## Context

AB#117 ("Run production security and privacy launch review") requires CSP, HSTS,
framing, MIME sniffing, referrer, and permissions behavior to be reviewed before
production promotion. Before this change, `next.config.ts`'s `headers()` set only one
header — `Cache-Control` on versioned `/gallery/**` assets — confirmed by a repo-wide
grep for `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` that returned no
other matches.

A first draft of this change proposed a CSP with no `'unsafe-inline'` on `script-src`
or `style-src`. A one-time Codex plan review (`codex-review-loop` skill, phase 1)
rejected that draft as unshippable and pointed at concrete evidence in this
repository's own build output rather than general CSP guidance. That evidence was
independently reproduced before this ADR accepted the finding:

- `SITE_CONTENT_SOURCE=mock npm run build` followed by inspecting
  `.next/server/app/services.html` shows a bare inline `<script>` tag (Next's App
  Router RSC hydration bootstrap payload — `self.__next_f.push(...)`) and inline
  `style="color:transparent"` attributes (from `next/image`'s sizing wrapper and
  `next/font`'s fallback handling) on an ordinary page, even though a repo-wide grep
  for `dangerouslySetInnerHTML`, `<script`, and `next/script` in `src/app` and
  `src/components` returns zero matches — the inline content is entirely
  framework-generated, not application code.
- Next.js's own documented fix for this is a per-request CSP nonce, which the
  framework requires to be threaded through `headers()`/middleware and read in the
  root layout — and nonces are documented as incompatible with static rendering: a
  nonce is minted per request, so every route using one must render dynamically.
  This site's whole caching posture (ADR-0004's hosting boundary, AB#83's tagged
  `revalidateTag` caching, and the static/SSG routes visible in `next build`'s own
  route table) is built around *not* rendering every request dynamically. Converting
  the site to support nonces is an architectural change out of AB#117's scope, not a
  header addition.

Two more Codex findings were checked directly rather than taken on faith:

- **HSTS.** Vercel's own documentation
  (`https://vercel.com/docs/headers/response-headers`, fetched and read during this
  review) states every Vercel deployment response already carries
  `strict-transport-security: max-age=63072000` (2 years) as a platform default. This
  project is explicitly a clonable, generic template (`AGENTS.md`'s "Keep it generic"
  rule) — it cannot know whether a given clone's own subdomains are HTTPS-ready, which
  is exactly what `includeSubDomains` would newly assert, and `preload` is a
  long-lived, hard-to-reverse commitment burned into browsers' built-in preload lists.
  Shipping an application-level HSTS header with those directives, on top of a
  platform default that already exists without them, would add risk with no verified
  benefit.
- **Sanity webhook replay.** Codex flagged that `sanity-revalidation.ts` validates an
  `idempotency-key` header's format but never stores or compares it, so a captured
  valid signed request could be replayed. Reading `docs/cache-revalidation.md`
  (§"Replay handling") and `sanity-revalidation.test.ts`'s existing
  `"accepts duplicate delivery as the same idempotent invalidation plan"` test showed
  this is a **deliberate, already-reviewed, already-tested design decision from AB#83**,
  not an oversight: `revalidateTag(tag, { expire: 0 })` is itself idempotent — invoking
  it any number of times with the same tag has the same effect as invoking it once —
  so a process-local or shared replay ledger would add state and complexity to prevent
  a repeat of a no-op. This finding was not acted on; it is recorded here as a
  Codex finding that did not hold up under verification (see
  `docs/security-privacy-review.md`).

## Decision

Add a broad `headers()` entry (`source: "/:path*"`, applied to every response,
alongside the existing versioned-gallery-asset entry which still governs only its own
narrower `Cache-Control`) setting:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` — nothing in this application is meant to be framed by
  another site; restated for browsers that predate `frame-ancestors`.
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: denies `camera`, `geolocation`, `microphone`, `midi`,
  `payment`, and `usb` outright (`feature=()`); scopes `accelerometer`, `autoplay`,
  `clipboard-write`, `encrypted-media`, `fullscreen`, `gyroscope`, and
  `picture-in-picture` to `self` plus the one known origin the click-to-load YouTube
  embed uses (`feature=(self "https://www.youtube-nocookie.com")`) — this list
  restates `youtube-embed.tsx`'s own `allow`/`allowFullScreen` attributes exactly —
  both the origin and the feature list are shared source, not hand-copied: the
  component's `allow` attribute renders `YOUTUBE_EMBED_ALLOW_FEATURES` directly, and
  `permissionsPolicy()` scopes that same array (plus `fullscreen`, which
  `allowFullScreen` grants separately) to `YOUTUBE_NOCOOKIE_ORIGIN` (both from
  `src/lib/embed-origins.ts`), so a future change to what the embed requests cannot
  drift from what the header grants without also changing this one file.
- `Content-Security-Policy`:
  `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:[ https://cdn.sanity.io/images/{projectId}/{dataset}/, only when SITE_CONTENT_SOURCE=sanity]; frame-src https://www.youtube-nocookie.com; connect-src 'self'; font-src 'self'`
  — every directive strict (no wildcard host, no `*`) in every built/started/deployed
  response **except** `script-src`/`style-src`, which carry `'unsafe-inline'` as
  documented, accepted residual risk (see Trade-off Analysis). In development only
  (`npm run dev`, `NODE_ENV === "development"`), `script-src` additionally carries
  `'unsafe-eval'` — Next.js's own CSP guide documents this as required for React's
  development-mode debugging (`eval()`-based server error stack reconstruction), and a
  Codex review round caught its absence by testing a real `npm run dev` server, where it
  produced a real CSP violation the earlier production-only verification never exercised.
  The Sanity image grant is scoped to
  this deployment's own project/dataset *path* on the CDN host, derived from the same
  validated `SanityBuildSettings` the existing `images.remotePatterns` allow-list
  already uses (computed once at module-evaluation time and passed into both, rather
  than re-derived independently by each) — never a bare `https://cdn.sanity.io` host
  grant, which would reach every other Sanity customer's project on the same shared
  CDN host, and never present at all for a deployment reading fixtures.
- **No `Strict-Transport-Security` header** — deliberately left to Vercel's platform
  default (see Context).

## Options Considered

### Option A (chosen): ship now with `'unsafe-inline'` on script-src/style-src, documented

**Pros:** closes every other directive immediately (blocks cross-origin script/style/
image/frame/font loading, clickjacking via `frame-ancestors 'none'` + `X-Frame-Options`,
MIME-sniffing, arbitrary form-action targets, and base-URI injection); ships inside
AB#117's scope as a `next.config.ts` change with no rendering-architecture impact;
verified against a real production build and a real headless-browser walk (see
Consequences) rather than merely reasoned about. **Cons:** does not close the specific
inline-script/inline-style injection vector `'unsafe-inline'` exists to close.
**Accepted** because the realistic size of that specific gap is small and independently
bounded: zero `dangerouslySetInnerHTML` and zero raw-HTML content-block rendering exist
anywhere in this codebase (`content-page.ts`'s `ContentBlock` union has no "raw HTML"
kind), so there is no unsanitized-input-to-DOM path for an attacker-controlled string
to reach the inline-script/style surface `'unsafe-inline'` leaves open in the first
place.

### Option B: nonce-based strict CSP, converting affected routes to dynamic rendering

**Pros:** the only way to close `script-src`/`style-src` without `'unsafe-inline'` for
an App Router site with framework-injected inline content, per Next's own documented
guidance. **Cons:** every route using a nonce must render dynamically per request —
directly reversing this project's static-generation and tagged-caching investment
(ADR-0004, AB#83) for its entire route surface, not just the header. **Rejected** as
disproportionate to AB#117's scope; revisit if the site's rendering strategy changes
for independent reasons (see Consequences).

### Option C: `Content-Security-Policy-Report-Only` instead of enforcing

**Pros:** would leave a violation trail without any risk of breaking a page.
**Cons:** no reporting endpoint exists in this project (`report-to`/`report-uri` need
one), so a report-only policy here would collect nothing — it would only be a
no-op placeholder, not real evidence. **Rejected**: the production build + real
Playwright-suite + real headless-browser verification this change actually performed
(see Consequences) already provides stronger evidence than an unread report-only
policy would.

### Option D: skip HSTS review entirely (assume the platform handles it)

**Cons of skipping the check:** would leave AB#117's "HTTPS... reviewed" criterion
unverified. **Rejected** — the review fetched and read Vercel's actual documentation
rather than assuming; see Context. The finding (Vercel supplies it by default) is
recorded so this is a verified fact, not an assumption.

## Trade-off Analysis

**A real, verified CSP today versus a theoretically complete one that risks shipping
broken.** The first draft of this ADR's decision was rejected in its own plan-review
round precisely because it would have been theoretically stricter but empirically
untested against this framework's actual output. Choosing Option A and verifying it —
not choosing Option B — is what let this change ship inside one review cycle instead of
becoming a rendering-architecture migration.

**Documented residual risk versus silent gap.** `'unsafe-inline'` is not hidden inside
a generic CSP string; it is named, justified, and tied to a migration trigger below, per
this project's own `security-review` skill guidance: "Start strict and loosen only with
a documented removal plan... treat as temporary compatibility debt."

**Platform default versus an application-level duplicate.** Rather than reasoning about
whether Vercel's own HSTS header would coexist safely with an application-level one,
this decision avoids the question: no application-level header exists, so there is
nothing to conflict, override, or drift from Vercel's own value over time.

## Consequences

**Easier**

- A real security-header baseline exists where none did, verified rather than assumed:
  `next-config.test.ts` asserts every header's presence and value using the same
  `unstable_getResponseFromNextConfig` harness the file's existing immutable-cache-control
  test already used, including that the Sanity `img-src` grant only appears for a
  `SITE_CONTENT_SOURCE=sanity` deployment.
- Beyond the unit tests, this decision was verified against a real production build
  (`npm run build && npm run start`) with a headless Chromium walk (Playwright,
  `chromium.launch()`) of the home page, `/services`, a service detail page, `/contact`,
  and a curated gallery page including opening the PhotoSwipe lightbox — zero CSP
  violation console messages, zero page errors, zero failed same-origin requests. The
  full existing Playwright public-journey suite (210 specs, production build) also
  passed unchanged with the new headers active.
- The one opt-in third-party surface (`youtube-embed.tsx`) and its Permissions-Policy
  grant are now pinned together by a shared constant and a test, so widening or
  narrowing what the embed requests and forgetting to update the header (or vice
  versa) fails a test instead of silently drifting.

**Harder**

- `script-src 'self' 'unsafe-inline'` does not block a hypothetical future inline-script
  injection the way a nonce-based policy would. This is accepted, not eliminated — see
  the migration trigger below.
- A future contributor adding a *second* third-party embed must remember to extend both
  `contentSecurityPolicy()`'s `frame-src` and `permissionsPolicy()`'s scoped-feature
  list in `next.config.ts`, the same way `youtube-embed.tsx` did — there is no
  compile-time enforcement that a new `<iframe src="https://...">` gets a matching CSP
  entry, only the existing project convention of grepping for third-party origins
  during a security review.

**To revisit — migration triggers**

- **The site's rendering strategy moves toward per-request dynamic rendering for an
  independent reason** (a future story, not this one) → revisit Option B; the dynamic
  conversion cost that made it disproportionate here would already be paid for that
  other reason.
- **Any content-block type that renders raw/unsanitized HTML is ever added** to
  `content-page.ts`'s `ContentBlock` union → `'unsafe-inline'` on `script-src` would
  then sit in front of a real injection path instead of an empty one, and this
  decision must be revisited before that block type ships.
- **A second third-party embed is added** → extend `frame-src` and the
  Permissions-Policy scoped-feature list in the same change, not after.

## Action Items

1. [x] Add `securityHeaders()`, `contentSecurityPolicy()`, and `permissionsPolicy()` to
       `next.config.ts` and wire them into `headers()` via a broad `/:path*` entry.
2. [x] Extract `YOUTUBE_NOCOOKIE_ORIGIN` and `YOUTUBE_EMBED_ALLOW_FEATURES` into
       `src/lib/embed-origins.ts`, shared by `youtube-embed.tsx` and `next.config.ts`.
3. [x] Add header-presence and header-value tests to `next-config.test.ts`, including
       the Sanity-deployment-only `img-src` case.
4. [x] Verify against a real production build: `npm run build && npm run start`, curl
       header inspection, a headless-Chromium console/network walk of five representative
       pages including an opened lightbox, and the full existing Playwright suite.
5. [x] Record this decision, its rejected first draft, and the verified evidence in
       this ADR and in `docs/security-privacy-review.md`.
6. [x] Scope `'unsafe-eval'` into `script-src` for development only, after a Codex
       review round caught its absence against a real `npm run dev` server. Add
       `next-config.test.ts` coverage for both the development and production cases.

## What this ADR did not establish

- **A nonce-based strict CSP.** Deliberately out of scope; see Option B and its
  migration trigger.
- **Live verification of the effective header set behind Vercel's own edge**, e.g.
  whether Vercel's platform-level header injection would ever override or merge with
  an application-set header of the same name. No live Vercel deployment exists yet to
  observe this against (see `docs/security-privacy-review.md`'s AB#116 finding) — this
  ADR only establishes that no application-level header exists that could conflict with
  Vercel's own `Strict-Transport-Security` default, sidestepping the question rather
  than answering it definitively.

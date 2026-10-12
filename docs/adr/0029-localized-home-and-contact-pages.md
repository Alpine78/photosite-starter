# ADR-0029: Localized home and contact pages

**Status:** Accepted
**Date:** 2026-10-11
**Deciders:** Project owner
**Work item:** AB#255 — first implementation slice

## Context

The owner requires Finnish and English versions of every page family, including
historical content and customer/administrator pages, and explicitly requested
starting with home and contact. ADR-0003 already defines unprefixed default-locale
routes and configured prefixes for other locales. Home and contact previously
existed only in the default space; their language-menu fallback opened stories.
The existing homePage and siteSettings singletons already store language-keyed
copy under ADR-0008. Neither a new CMS model nor a second UI is necessary.

## Decision

1. Home uses the locale base itself: `/` in the default space, `/<prefix>` in
   other spaces. Contact keeps the application-owned `contact` segment:
   `/contact` and `/<prefix>/contact`. Prefixes and full language tags remain
   deployment configuration; the reference site uses Finnish by default and
   English under `/en`. This introduces no translated contact slug contract.
2. Shared Server Components render both spaces with an explicit locale. The
   existing optional catch-all delegates prefixed static pages before services
   and stories. DocumentRoot retains the route's full HTML language tag.
   `Accept-Language` causes no automatic redirect.
3. Required shared settings and home prose are projected in the requested
   language. An absent/blank required non-default language entry is an unavailable version:
   its static page returns 404 and is omitted from exact language links,
   hreflang, navigation and sitemap. Home also requires its home-page copy;
   contact requires settings but no home-page copy. Default-locale required copy
   remains a deployment requirement and fails instead of withdrawing its canonical
   pages. Malformed CMS data and
   infrastructure failures remain classified failures, never empty translations.
   Optional copy can remain absent; existing brand compatibility fallback remains.
   ADR-0008's accessible media-alt fallback also remains; the live content audit
   must identify and author any missing FI/EN image descriptions before claiming
   complete bilingual content.
4. Static language switching opens the equivalent available page. Metadata
   names only available versions, with the unprefixed version as `x-default`
   when available. Filtered/legacy-notice home views remain noindex with a
   parameter-free canonical and no alternate-language metadata. WebSite and
   Organization JSON-LD remain global entities emitted only on the default home;
   their existing name, URL and default `inLanguage` are unchanged.
5. Home/contact/service targets in navigation and calls to action resolve inside
   the selected locale. Arbitrary authored links are not blindly prefixed;
   unrecognized static links remain omitted from non-default navigation.
   Shared chrome uses localized settings when complete and retains the previous
   default-settings shell for existing story pages awaiting shared translations.
6. The contact form still posts to `POST /api/contact`, with the same field,
   origin, validation, throttle, delivery and owner-language email contracts.
   Labels, status messages, privacy copy and selectable service names follow the
   page locale. A choice requires both a published local service and its stable
   identity in the owner catalog used by the endpoint. Services without that
   counterpart can still be discussed through Other; expanding that endpoint
   contract belongs to later bilingual coverage.
7. `contact` is reserved against both story and service namespaces. Content slugs
   below those namespaces do not collide with the static contact route. Casing
   variants of configured prefixes/contact normalize directly to a real available
   canonical page, preserving recognized page parameters. Redundant default-prefix
   aliases keep ADR-0003's existence-gated redirect contract; unknown paths remain 404.

## Options Considered

- Reuse language-keyed singletons, shared renders and the existing catch-all
  (selected): preserves the established route/CMS contracts with no dependency.
- Add another generic locale route subtree and duplicate pages: overlaps the
  existing dynamic route owner and makes later UI corrections diverge.
- Keep the story-root fallback as the static-page language choice: does not
  provide the same page in another language and fails the owner's requirement.

## Trade-off Analysis

Availability checks use the same projections as rendering and React's request
cache. They add bounded locale reads, but avoid a separately maintained readiness
flag drifting from actual authored copy. An unavailable version is visible in
the remaining-work inventory rather than presented as a successful translation.
Live authored-copy readiness still requires a content audit before activation.

## Consequences

The first source slice enables bilingual home/contact without automatically
creating or publishing translations. Existing independent content publication
under ADR-0003 decision 7 remains valid during the wider migration; AB#255 is not
complete until every required family is covered and accepted. Private and admin
routes need a separate implementation that preserves their security contracts.

## Action Items

1. Validate static routes, exact switches, metadata, navigation, localized forms
   and native-ratio media against the deterministic production-build harness.
2. Audit and author missing live shared-copy entries before Production activation.
3. Complete the remaining coverage in
   [the AB#255 inventory](../bilingual-page-coverage.md); keep the story Active.

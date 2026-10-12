# AB#255 — Service locale journeys, 2026-10-12

This slice extends [the services suite](../../e2e/services.spec.ts) with seven
cases derived from the harness's configured English and Finnish route spaces.
The original six cases remain. The production-build harness, browser projects,
workers, retry policy, third-party-origin guard and synthetic client addresses
are unchanged. Initial tested baseline: `ce43481`. The worktree then fast-forwarded
to `3da712b`; only documentation changed between those main commits, so tested
application, package and harness inputs are unchanged.

## Verified cases

- A priced top-level service keeps the requested `html.lang`, pricing label,
  authored fixture name and packages, image alt and real dimensions. The image
  retains its complete native frame in both locale routes.
- The service's enquiry link opens the same-locale contact page with the stable
  service identity selected. The localized form label and fixture option agree.
- A nested service has same-locale listing and parent breadcrumbs, its own
  canonical URL, and actual counterpart addresses in each configured locale's
  `hreflang`. Counterparts are joined by `serviceId`, not translated labels or
  a presumed shared slug.
- An unknown service returns HTTP 404 without a redirect in both route spaces.
  This is a status assertion, not semantic initial-HTML acceptance for AB#132.
- With JavaScript disabled, the equivalent nested service opens in both
  directions with the target URL, language, title and canonical metadata.

Root lint and all 5,720 browser-free tests in 239 files passed. The suite built
and served the application itself, then passed all 26 cases across desktop
Chromium and mobile WebKit, without retries. The build's TypeScript check passed.
The mobile Chromium lightbox project does not include this services spec.

## Remaining coverage and acceptance

These cases prove the selected fixture journeys. Mock services retain placeholder
English prose/media text in the Finnish fixture projection; the tests do not
declare that prose to be an accepted translation or verify live CMS coverage.
Owner acceptance, missing published counterparts and deployment remain separate.

The legacy default `/services` listing and one-segment detail handlers do not
supply page-specific language links or locale-version metadata at the inspected
baseline. The nested-service language tests exercise the shared locale catch-all;
they do not establish equivalent-page switches or real alternates on those legacy
handlers. That parity remains a source implementation follow-up. Further optional
content and service failure states require concrete cases rather than a blanket
claim that this suite covers every service page.

No application route, fixture data, delivery/CMS adapter, dependency or production
configuration changed. No live CMS, email or private-client request occurred.
AB#255 remains Active. The owner instructed this continuation to proceed without
Claude; source review and applicable checks were completed locally.

The ignored handoff retains the tested source hashes and logs. Early local runs
exposed runner restrictions (sandboxed subprocesses, a restrictive inherited
umask and a dependency symlink outside Turbopack's root); those were corrected in
the local setup. One image-union narrowing error in the added test was corrected
before the successful production-build run. No harness tolerance was changed.

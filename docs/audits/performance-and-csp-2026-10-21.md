# Mobile performance and CSP nonce feasibility, 2026-10-21

Read-only evidence and a feasibility study. Nothing in the CMS, configuration, headers or
deployment changed. Production still served the morning release; #577 (eager first images)
and #580 (bounded gallery image sizes) were merged afterwards and are not live yet.

## Mobile performance under throttling

Playwright Chromium, Pixel 7 emulation, network throttled to 1.6 Mbit/s down, 750 kbit/s up
and 150 ms latency, CPU slowed 4×. Each page loaded three times in a fresh context; the
table gives the median. "TBT≈" sums long-task time beyond 50 ms until three seconds after
`load`, a proxy rather than Lighthouse's exact Total Blocking Time.

| Page | TTFB | FCP | LCP | LCP element | TBT≈ | CLS | Transfer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/en` (home) | 93 ms | 960 ms | 3.46 s | image | 409 ms | 0.035 | 664 kB |
| `/tarinat` | 90 ms | 972 ms | 3.26 s | card image | 309 ms | 0.033 | 614 kB |
| `/tarinat/portfolio` | 85 ms | 900 ms | **6.39 s** | gallery image | 431 ms | 0.035 | 1182 kB |
| Rally gallery (Secto 2023) | 94 ms | 1.06 s | 3.47 s | hero | 426 ms | 0.025 | 697 kB |
| Travel article (Chamonix 2006) | 102 ms | 1.34 s | 2.60 s | hero | 1011 ms | 0.026 | 453 kB |
| Blog article (sausage test) | 88 ms | 1.25 s | 3.21 s | hero | 552 ms | 0.026 | 538 kB |
| `/palvelut` | 95 ms | 828 ms | 2.12 s | service cover | 237 ms | 0.040 | 585 kB |
| `/palvelut/haakuvaus` | 87 ms | 872 ms | 3.85 s | cover | 272 ms | 0.038 | 662 kB |
| `/contact` | 88 ms | 936 ms | 936 ms | heading | 355 ms | 0.040 | 265 kB |
| `/haku` | 98 ms | 840 ms | 840 ms | text | 344 ms | 0.031 | 297 kB |

Observations:

- Server response is fast everywhere (TTFB under 0.11 s); first paint is about 1 s.
- LCP is 2.1–3.9 s on image-led pages, above the 2.5 s "good" threshold under this
  deliberately slow profile. The gallery page is the outlier at 6.4 s: its LCP image was
  lazy-loaded and its thumbnails requested full-viewport sources, exactly what #577 and
  #580 change. Remeasure after the next release with this same profile.
- Every page shows a small load-time shift (0.025–0.040, under the 0.1 threshold) that
  the unthrottled crawl did not; a font swap is the likely source, not yet confirmed.
- Long-task time is highest on the longest article (about 1 s at 4× CPU), mainly
  hydration of a large body.

## CSP nonces: is `'unsafe-inline'` for scripts still necessary?

`next.config.ts` and [ADR-0011](../adr/0011-security-response-headers.md) keep
`script-src 'self' 'unsafe-inline'` as accepted residual risk. The recorded reason is that
per-request nonces require the whole site to render dynamically, "which conflicts with the
static-generation and tagged-caching architecture ADR-0004 and AB#83 already committed to".

**Verified facts (Next.js 16.4.2 bundled guide `docs/01-app/02-guides/content-security-policy.md`):**

- A nonce generated in Proxy and placed in the `Content-Security-Policy` request header is
  applied by Next.js to its own scripts automatically during server rendering; every page
  using it must render dynamically, and static pages get no nonce.
- The experimental SRI option hashes script *files* at build time; it does not by itself
  cover Next.js's inline bootstrap and RSC payload scripts.
- A nonce covers `<script>` and `<style>` elements, not `style` attributes.

**What has changed since the decision:** public HTML is already served
`private, no-store` and rendered per request, because the routes read `searchParams`
(recorded in the [headers audit](ab117-production-headers-2026-10-21.md)). A production
build's `.next/prerender-manifest.json` (mock content, 2026-10-21) lists only
`/services/[slug]` (through `generateStaticParams`) besides `robots.txt` and the error
pages; even those service pages reach visitors as `private, no-store` (checked on
`/palvelut/haakuvaus`). The data cache that AB#83 relies on is independent of
whether the page shell renders per request. So the main cost the decision named — losing
static generation — is no longer a real trade-off for most pages.

**What a nonce migration would involve (assessment, not done):**

1. Generate a nonce per request in the existing `src/proxy.ts` (a constant-time step,
   compatible with ADR-0007's O(1) proxy boundary) and move the HTML `Content-Security-Policy`
   from `next.config.ts` into that response; keep the header for non-HTML routes.
2. `script-src 'self' 'nonce-…' 'strict-dynamic'` in production; development keeps
   `'unsafe-eval'`.
3. Give the two `dangerouslySetInnerHTML` scripts the nonce: the constant theme bootstrap
   (it must run before paint) and the JSON-LD block (a data block, not executed, but
   harmless to tag).
4. Render `/services/[slug]` per request too, or it would ship scripts without a nonce.
5. Keep `style-src 'self' 'unsafe-inline'`: server-rendered markup carries `style`
   attributes (13 component `style` props and `next/image` sizing), which nonces cannot
   cover. Styles set later through the CSSOM from script (PhotoSwipe's positioning, for
   example) are not restricted by `style-src`. Only script injection is closed.
6. A journey guard that fails on any `securitypolicyviolation` event across the public
   page families, with and without JavaScript-driven features (lightbox, polls, search,
   contact).

**Assessment:** feasible at modest cost, and it closes the remaining script-injection
fallback that `'unsafe-inline'` keeps open. The existing argument that the injection
surface is "effectively empty" (no raw-HTML block, escaped JSON-LD) still holds, so this
is defence in depth rather than a fix for a known hole. It changes an accepted security
boundary, so it needs a work item and an ADR-0011 amendment before implementation; it is
not started here.

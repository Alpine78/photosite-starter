# Production security response headers — 2026-10-21 (AB#117)

Read-only check that the public Production domain sends the headers ADR-0011 and
`next.config.ts` (`securityHeaders`, `contentSecurityPolicy`, `permissionsPolicy`) define.
Anonymous GET requests only; no setting was read or changed.

**Target:** the public Production domain serving `dpl_ARuiTPxfvhAsn7D4foP2ajzfchVE`
(main `90543d5`). Sampled responses: the home page, an English listing, the search page,
`GET /api/gallery` without parameters (a 400 API response) and `/sitemap.xml`.

## Result

| Header | Expected (source) | Observed on every sampled response |
| --- | --- | --- |
| `Content-Security-Policy` | `contentSecurityPolicy()` | `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` plus the project's own Sanity `images/` and `files/` origins; `frame-src https://www.youtube-nocookie.com`; `connect-src 'self'`; `font-src 'self'` |
| `X-Frame-Options` | `DENY` | `DENY` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | same |
| `Permissions-Policy` | `permissionsPolicy()` | camera, geolocation, microphone, MIDI, payment and USB disabled; accelerometer/autoplay etc. limited to `self` and the privacy-enhanced YouTube origin for click-to-load embeds |
| `Strict-Transport-Security` | not set by the app; Vercel's edge sends it (ADR-0011) | `max-age=63072000` |

No `Set-Cookie` on any sampled public response. The `'unsafe-inline'` script and style
sources are ADR-0011's documented residual (a per-request nonce would force every route to
render dynamically), not a finding.

## Observation outside this check's scope

Every sampled public HTML page answered `cache-control: private, no-cache, no-store,
max-age=0, must-revalidate` with `x-vercel-cache: MISS`, so the CDN serves no cached HTML
and each page view renders on demand (CMS reads still use the documented data cache in
`docs/cache-revalidation.md`). That is not a security issue and pages loaded quickly in the
[2026-10-20 audit](ab117-public-production-audit-2026-10-20.md); whether it is intended is
recorded for separate investigation rather than assumed either way.

## Not covered

Authorized or unlisted pages, error responses other than the sampled 400, and response
bodies. Header presence does not by itself establish that every directive is sufficient.

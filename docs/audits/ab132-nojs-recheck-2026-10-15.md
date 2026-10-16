# AB#132 — fresh scriptless 404 check, 2026-10-15

Status: defect reproduced; AB#132 remains Active. No framework, Proxy, route or
test marker changed. Source runtime inputs are those of `6cdc231`; the checkout
was advanced to `eabbc5d` during the run, whose #416 delta changes documentation
only. The worktree began without a `.next` build. The harness built and served
its own synthetic production app on loopback port 3100; this is not Vercel or a
real-content/production-configuration observation.

## Reproduction

```sh
npm run test:e2e -- e2e/gallery-continuation.spec.ts \
  --grep 'initial 404 HTML without JavaScript' --workers=2
```

The production build and harness start succeeded. The four existing marked tests
ran with JavaScript disabled in desktop Chromium and mobile WebKit. Both the
unknown public gallery path and the refused gallery cursor returned HTTP 404
without a redirect. Each observation recorded:

| Field | All four observations |
| --- | --- |
| Installed Next.js | 16.3.8 |
| Rendered accessible h1 count | 0 |
| Gallery-return link count | 0 |
| Return href | null |
| HTML id | `__next_error__` |
| RSC fallback digest present | true |

The role-based assertions inspect rendered HTML, not text embedded in RSC scripts.
The fixture guard observed no third-party request. Runner summary was `4 passed`
because **all four are expected failures** under strict `test.fail()` markers.
That is evidence of the known semantic failure, not four successful accessibility
journeys. A complete semantic fix would unexpectedly pass and fail this gate until
the marker is removed deliberately. Existing JavaScript-enabled recovery journeys
were not rerun by this filtered command. FI/EN/redundant-prefix and refused-category
matrix coverage was not expanded; no all-locale claim is made.

## Upstream state observed on October 15

Primary GitHub API reads returned:

- [Issue #62228](https://github.com/vercel/next.js/issues/62228): open, not closed.
- [Candidate #98455](https://github.com/vercel/next.js/pull/98455): open, `merged_at=null`.
- [Candidate #98583](https://github.com/vercel/next.js/pull/98583): open, `merged_at=null`.

Neither inspected candidate was merged; no release containing a supported remedy
was identified by this check. It is not a comprehensive latest-Next-release audit.
No upgrade or unreleased patch was attempted. ADR-0007's bounded O(1), adapter-read-free
Proxy and real-404 contract remain intact.

## Acceptance boundary

The owner's October 7 temporary residual decision named an October 8 review before
AB#18. That review date has passed; this report does not extend the acceptance or
assert that a later owner decision occurred. Use these observations for a current
exact-release decision. A verified semantic fix or the required owner decision
remains separate from local reproduction, and AB#132 is not closed.

The test-generated observation files/traces remain ignored in the worktree. Only
synthetic aggregate results are recorded here. No production, CMS, credential or
DNS operation occurred.

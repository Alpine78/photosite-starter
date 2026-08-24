---
name: security-review
description: Review PhotoSite Starter changes that affect untrusted requests, secrets, server-only adapters, CMS or media projection, third-party delivery, browser policy, deployment credentials, authentication, private galleries, or payments. Do not activate for routine presentation-only changes.
---

# PhotoSite Starter security review

Review the actual change against this repository's established security and privacy
boundaries. Do not replace evidence with a generic checklist or prescribe unrelated
authentication, database, or infrastructure products.

## Establish scope and evidence

- If the request names an Azure Boards item, read it under the gate in `AGENTS.md` before
  implementation or review. Do not infer acceptance criteria from the diff.
- Read the changed code, its tests, the relevant ADRs, and the applicable maintained
  document: `docs/contact-data-flow.md`, `docs/sanity-setup.md`,
  `docs/cache-revalidation.md`, `docs/deployment.md`, or
  `docs/security-privacy-review.md`.
- Verify version-sensitive Next.js, Sanity, Vercel, Resend, and browser behavior against
  current official documentation. Label facts, assumptions, and recommendations.
- In review-only work, report findings without modifying files unless the user also asks
  for fixes.

## Review the affected trust boundaries

Apply only the sections the change reaches.

### Untrusted requests and route handlers

- Bound methods, content types, body size, query multiplicity, field names, string sizes,
  and response data. Prefer closed allow-lists and fail closed on malformed input.
- Preserve route-specific origin controls. Do not add permissive CORS headers. For the
  contact endpoint, header rejection stays ahead of throttling and body reads so a
  cross-origin request cannot spend a visitor's allowance or force body processing.
- Keep expensive work behind the cheapest applicable validation and throttling. Do not
  log attacker-controlled payloads merely because validation rejected them.
- Gallery continuation tokens remain opaque, authenticated, and scoped to the gallery,
  full route locale, normalized filter, and boundary identity. Invalid, tampered, stale,
  repeated, or cross-scope tokens must retain their documented 404 behavior.
- Proxy-owned request headers must overwrite client-supplied values and carry only the
  bounded path and cursor presence, never the cursor value or a secret.
- Revalidation endpoints must authenticate before invalidating data, use bounded input,
  and disclose neither credentials nor provider payloads.

### Secrets and server/client separation

- Keep credentials in validated server-only configuration. Reject a corresponding
  `NEXT_PUBLIC_` setting instead of silently accepting a browser-visible copy.
- Preserve `server-only` markers and ESLint import boundaries around Sanity, delivery,
  cursor-signing, and revalidation modules. Trace indirect Client Component imports, not
  only direct ones.
- Never expose signing keys, read/write tokens, delivery credentials, provider responses,
  or sensitive error details through browser payloads, request headers, logs, build
  artifacts, screenshots, or test fixtures.
- Preserve lazy secret resolution when the established contract intentionally avoids
  reading a credential for a request path that does not need it.

### CMS and public media projection

- Treat every CMS response as untrusted. Validate its shape and bounds; classify malformed
  data as a defect rather than silently returning empty content or falling back to mocks.
- Project through explicit allow-lists. Browser-facing media may contain only a versioned
  public derivative and its true intrinsic dimensions—never camera masters, archive
  locators, provider internals, capture metadata used only for ordering, or private and
  sales assets.
- Preserve the declared Sanity dataset visibility contract. A private dataset requires a
  server-only read token and must fail closed when it is missing. A public dataset's
  Studio schema must not publish fields that are sensitive even if the runtime adapter
  omits them.
- Delivery transforms may downscale but must not crop or upscale. URL transformations are
  optimization controls, not authorization.

### Browser policy, rendering, and privacy

- Keep authored content in the typed block model. Do not introduce raw HTML or
  `dangerouslySetInnerHTML` without a separately justified sanitization boundary.
- Keep third-party origins narrowly shared between the component that uses them and the
  response policy that permits them. YouTube remains click-to-load and uses the established
  privacy-enhanced origin; no third-party embed loads automatically.
- Keep CSP and the other response headers restrictive. Any relaxation needs a concrete
  compatibility reason, a test, and documentation in ADR-0011 and the launch review.
- Preserve privacy by default: no tracking, personal-data persistence, or new external
  processor without an explicit requirement and corresponding data-flow documentation.

### Delivery, logging, dependencies, and CI

- Contact content is delivered without storage. Operational events carry only the random
  correlation identifier, state, and redacted error class; never message fields or a
  visitor identifier.
- Keep Preview/provider credentials out of pull-request jobs and scope them to the stage
  that needs them. A release candidate must remain access-protected and `noindex` before
  its URL is published.
- Tests and published failure artifacts must use fixtures without credentials or personal
  data and must not reach live CMS, email, or other third-party services.
- Add no security library by reflex. Explain the concrete gap before adding a dependency;
  use the lockfile, `npm ci` in CI, and run an appropriate dependency audit when the
  dependency tree changes.

## Roadmap-sensitive features

Authentication, private client galleries, proofing, payments, sales assets, and video
delivery do not inherit a complete security model from the public site. Before implementing
one, require its prioritized work item and the relevant ADR or threat-boundary decision.
Do not treat contact-form origin checks, signed pagination cursors, or public CDN URLs as
authorization for those features.

## Validate and report

Add or update abuse-case tests at the lowest useful layer: malformed inputs, size and count
bounds, cross-origin requests, secret leakage, signature tampering, stale scope, provider
failures, and fail-closed configuration. Use project-owned Playwright fixtures for browser
journeys so a third-party request fails the test.

Run the focused tests first, then the applicable repository gates (`npm run lint`,
`npm test`, `npm run build`, and `npm run test:e2e` when a public journey changed).

Report findings first, ordered by severity. Each finding should name the affected location,
attack or failure path, impact, smallest appropriate correction, and missing regression
test. If no finding remains, say so and record residual risks or live-infrastructure checks
that static and fixture-based validation could not establish.

## Provenance

Adapted for PhotoSite Starter on 2026-08-24 from Affaan Mustafa's MIT-licensed
`security-review` skill. See `NOTICE` and `licenses/MIT-affaan-m-ECC.txt`.

/**
 * The environment the application under test runs with.
 *
 * The harness owns this environment instead of inheriting the developer's or
 * the pipeline's deployment settings, for three reasons:
 *
 * - **Determinism.** A journey assertion must not change because a clone
 *   pointed `SITE_CANONICAL_BASE_URL` somewhere else. Values passed here reach
 *   both the production build and the server that serves it, and Next.js
 *   resolves `process.env` before any `.env` file, so these win over a local
 *   `.env.local`.
 * - **No real external requests.** Every value below is a local path or a
 *   reserved test name. When an external delivery adapter lands (contact-form
 *   email, a CMS client), this module is where its *test* adapter is selected,
 *   so the suite exercises the real code path without reaching a real service.
 *   Browser-side third-party requests are blocked separately, by the guard in
 *   `fixtures.ts`.
 * - **No secrets in failure artifacts.** Traces, screenshots, and server logs
 *   are retained on failure. Nothing here is a credential, and the content they
 *   capture is the project's own mock data, so an artifact can be attached to a
 *   pipeline run without a review of what it might contain.
 *
 * Two limits worth knowing rather than discovering:
 *
 * - Settings this module does not name still fall through to the deployment's
 *   own `.env` files. That is why anything that could reach an external service
 *   has to be named here, not left to whatever the machine happens to hold.
 * - The production build itself fetches the Geist fonts through `next/font`
 *   before self-hosting them, so building is network-dependent. That is the
 *   application's existing font strategy — the same fetch the deployment build
 *   makes — and not a request the running suite performs.
 */

/** Loopback only: the harness server is never reachable from the network. */
export const HARNESS_HOSTNAME = "127.0.0.1";

/** Distinct from the 3000 a `npm run dev` session usually holds. */
export const HARNESS_PORT = 3100;

export const HARNESS_BASE_URL = `http://${HARNESS_HOSTNAME}:${HARNESS_PORT}`;

/**
 * The route spaces the application under test publishes. Exported so a journey
 * can name an application-owned route without restating what the settings
 * below configure — the two cannot drift apart.
 */
export const DEFAULT_STORY_NAMESPACE = "stories";

export const PREFIXED_LOCALE = {
  prefix: "fi",
  storyNamespace: "tarinat",
} as const;

/** The default locale's own language subtag, which its routes never carry. */
export const REDUNDANT_DEFAULT_PREFIX = "en";

/**
 * Deployment settings for the application under test.
 *
 * `.test` is reserved by RFC 6761 and never resolves, so a canonical or Open
 * Graph URL built from it cannot become a real request even if something later
 * tries to fetch one. The social image is the project's own public derivative,
 * carrying its byte version in the filename, with its true intrinsic
 * dimensions — the same public media boundary a deployment must satisfy.
 */
export const appUnderTestEnvironment: Record<string, string> = {
  SITE_LOCALE: "en-GB",
  // Two route spaces, so the suite exercises the unprefixed default and a
  // prefixed locale the way a bilingual deployment publishes them.
  SITE_LOCALE_ROUTES: `en-GB||${DEFAULT_STORY_NAMESPACE},${PREFIXED_LOCALE.prefix}|${PREFIXED_LOCALE.prefix}|${PREFIXED_LOCALE.storyNamespace}`,
  SITE_CANONICAL_BASE_URL: "https://e2e.photosite-starter.test",
  SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
  SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536",
  SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
  // Authored in the default locale. Prefixed locale pages must not copy it.
  SITE_DEFAULT_SOCIAL_IMAGE_ALT: "Rocky shoreline beside calm water",
  // The suite is not a production deployment, and says so: the sink adapter
  // below is refused outright in one, because accepting a message and sending
  // nothing is silent data loss there.
  SITE_DEPLOYMENT_STAGE: "development",
  // The contact endpoint's delivery boundary, resolved to the adapter that
  // accepts a message and sends nothing. The suite therefore exercises the real
  // route, the real validation, and the real response contract without a
  // credential in the environment or a synthetic enquiry in a real mailbox —
  // the same adapter ADR-0004 §3 requires of the Preview environment. Delivery
  // failures are reachable through it too: a reply-to address on the reserved
  // `delivery-failure.test` domain makes the sink report that class of failure,
  // so the endpoint classifies and answers a real failure instead of the suite
  // stubbing one.
  CONTACT_DELIVERY_ADAPTER: "sink",
  // The content boundary, resolved to the project's own fixture layer. The
  // suite must reach no external service, and a journey asserting against
  // someone's live Content Lake would fail whenever they published. Declaring
  // it here rather than leaving it unset also keeps the harness honest: this
  // is a real choice the application reads, and `mock` is refused in a
  // production deployment, which the stage above says this is not.
  SITE_CONTENT_SOURCE: "mock",
  // Signs the continuation cursors a gallery larger than one page issues. Fixed
  // rather than generated, because a cursor has to stay valid between the
  // request that issued it and the one that spends it, and because a suite that
  // minted a new key per run could never tell a stale token from a rotated key.
  // Not a credential: it protects nothing but this fixture's page boundaries,
  // and it is deliberately safe to publish in a failure artifact.
  GALLERY_CURSOR_SIGNING_KEY: "e2e-harness-gallery-cursor-signing-key",
  // The private client-gallery store (ADR-0014), resolved to the in-process
  // development fixture. It is the same shape of choice as the two above: the
  // suite exercises the real routes, the real capability crypto, and the real
  // session contract without a database, an object store, or a credential in
  // this environment — and `memory` is refused outright in a production
  // deployment, because its fixture link is a published constant. Nothing here
  // is a secret: the fixture's handle and capability are exported from
  // `private-gallery-memory-store.ts` and are deliberately safe to appear in a
  // published failure trace. Each run seals them under a fresh ephemeral key,
  // so an artifact from one run authorizes nothing anywhere.
  PRIVATE_GALLERY_STORE: "memory",
};

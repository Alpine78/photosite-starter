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
  SITE_LOCALE_ROUTES: "en-GB||stories",
  SITE_CANONICAL_BASE_URL: "https://e2e.photosite-starter.test",
  SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
  SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536",
  SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
};

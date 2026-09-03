import { expect, test } from "./support/fixtures";

/**
 * ADR-0014 §6: every response for the reserved private client-gallery namespace
 * carries `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, and
 * `Referrer-Policy: no-referrer` — against the production build the harness
 * serves, which is where the Proxy matcher and the Proxy-over-`next.config.ts`
 * header precedence are actually exercised. No private route exists yet, so
 * every path here is a 404 (or a 308); the point is that the namespace behaves
 * privately before it has content. `Referrer-Policy` is the one header with a
 * site-wide value (`strict-origin-when-cross-origin`, `next.config.ts`), so its
 * override on a private path proves the precedence documented in `src/proxy.ts`.
 *
 * The same contract covers the reserved **administrator** namespace (ADR-0015
 * §1), which owns no route at all yet — the boundary itself is AB#145's later
 * slice. That is the point of asserting it here: a namespace has to behave
 * privately before it has content, or the deployment that adds the first
 * administrator route is also the first one crawled.
 *
 * The harness runs `SITE_DEPLOYMENT_STAGE: development` and the default
 * `PRIVATE_GALLERY_ROUTE_PREFIX` (`private`) and
 * `PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX` (`admin`). `buildRobotsPolicy`'s
 * production-only `Disallow` entries have deterministic coverage in
 * `src/lib/robots.test.ts`, since this harness's stage cannot flip live.
 */

const HYGIENE: Record<string, string> = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

const SITE_WIDE_PRESENT = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "permissions-policy",
];

test.describe("private route namespace response hygiene", () => {
  for (const path of [
    "/private",
    "/private/some-gallery-handle",
    // Deep paths with a dotted last segment: an earlier matcher excluded these.
    // The matcher is prefix-independent, so a custom `PRIVATE_GALLERY_ROUTE_PREFIX`
    // behaves the same way — `src/lib/request-path.test.ts` covers that arm.
    "/private/some-handle/preview.jpg",
    "/private/some-handle/download.v2.zip",
  ]) {
    test(`${path} is a non-indexable, uncached 404`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);

      const headers = response.headers();
      for (const [key, value] of Object.entries(HYGIENE)) {
        expect(headers[key]).toBe(value);
      }
      // The Proxy only adds three headers; the site-wide security headers must
      // still be there.
      for (const key of SITE_WIDE_PRESENT) {
        expect(headers[key] ?? "").not.toBe("");
      }
    });
  }

  test("a private path's trailing-slash 308 also carries the hygiene headers", async ({
    request,
  }) => {
    const response = await request.get("/private/handle/", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"] ?? "").toContain("/private/handle");
    for (const [key, value] of Object.entries(HYGIENE)) {
      expect(response.headers()[key]).toBe(value);
    }
  });

  test("an ordinary route keeps the site-wide Referrer-Policy and is not marked noindex", async ({
    request,
  }) => {
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers()["x-robots-tag"]).toBeUndefined();
    expect(response.headers()["cache-control"] ?? "").not.toBe("no-store");
  });

  test("a repeated-separator private URL 308s to the protected clean form (framework limitation)", async ({
    request,
  }) => {
    // Next 16.3.2 collapses a repeated separator with its own bare 308 in
    // `resolveRoutes`, before the Proxy or its matcher runs, so this one
    // redirect carries none of §6's headers and is not decoratable at the app
    // layer (`src/proxy.ts` documents why). `/api/contact` has the identical
    // property. This characterization test pins the behavior — the redirect
    // still lands on the clean private URL, which *is* protected — so a future
    // Next version that decorates it, or a live-edge rule that does, is noticed.
    const response = await request.get("/private//handle", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toBe("/private/handle");

    const clean = await request.get("/private/handle", { maxRedirects: 0 });
    expect(clean.status()).toBe(404);
    for (const [key, value] of Object.entries(HYGIENE)) {
      expect(clean.headers()[key]).toBe(value);
    }
  });

  test("grants no object-store image source when there is no object store", async ({
    request,
  }) => {
    // The harness runs `PRIVATE_GALLERY_STORE=memory`, which has no object
    // store, so the private routes' `img-src` must not be widened. This is the
    // half of ADR-0011 action item 4 that can be observed here: the grant is
    // conditional, and a build that emitted it unconditionally would be a
    // permanent hole for a feature most deployments never enable. The positive
    // case — the grant appearing for an `enabled` store — is in
    // `src/lib/next-config.test.ts`, which can vary the build configuration.
    const policy =
      (await request.get("/private/some-handle", { maxRedirects: 0 })).headers()[
        "content-security-policy"
      ] ?? "";

    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/img-src[^;]*https:/);
  });

  test("robots.txt disallows the namespace as crawl guidance", async ({
    request,
  }) => {
    // On this harness's `development` stage the whole site is disallowed, which
    // already covers `/private/`. The production-only per-prefix Disallow is in
    // the Vitest suite; here we only confirm the namespace is not somehow
    // allowed.
    const body = await (await request.get("/robots.txt")).text();
    expect(body).not.toMatch(/Allow:\s*\/private/i);
  });
});

test.describe("administrator route namespace response hygiene", () => {
  for (const path of [
    "/admin/galleries/some-gallery-id",
    // A deep dotted path, for the same matcher reason the private cases above
    // cover one: an earlier form of the Proxy matcher excluded these.
    "/admin/galleries/some-gallery-id/export.zip",
  ]) {
    test(`${path} is a non-indexable, uncached 404`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);

      const headers = response.headers();
      for (const [key, value] of Object.entries(HYGIENE)) {
        expect(headers[key]).toBe(value);
      }
      for (const key of SITE_WIDE_PRESENT) {
        expect(headers[key] ?? "").not.toBe("");
      }
    });
  }

  test("the namespace's own routes carry the same hygiene", async ({
    request,
  }) => {
    // `/admin` serves the sign-in surface now, so this is no longer a 404 —
    // but §1's headers apply to a route that answers as much as to one that
    // does not. `e2e/private-gallery-admin.spec.ts` owns the journey itself.
    const response = await request.get("/admin", { maxRedirects: 0 });
    expect(response.status()).toBe(200);

    const headers = response.headers();
    for (const [key, value] of Object.entries(HYGIENE)) {
      expect(headers[key]).toBe(value);
    }
    for (const key of SITE_WIDE_PRESENT) {
      expect(headers[key] ?? "").not.toBe("");
    }
  });

  test("an admin path's trailing-slash 308 also carries the hygiene headers", async ({
    request,
  }) => {
    const response = await request.get("/admin/login/", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"] ?? "").toContain("/admin/login");
    for (const [key, value] of Object.entries(HYGIENE)) {
      expect(response.headers()[key]).toBe(value);
    }
  });

  test("a path that merely starts with the prefix is an ordinary public 404", async ({
    request,
  }) => {
    // `/administrator` is Joomla's own admin path and a plausible probe. It is
    // not in the namespace, so it must not silently inherit its headers — that
    // would be the reservation quietly claiming more than one segment.
    const response = await request.get("/administrator", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()["x-robots-tag"]).toBeUndefined();
    expect(response.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  test("robots.txt does not allow the administrator namespace", async ({
    request,
  }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).not.toMatch(/Allow:\s*\/admin/i);
  });
});

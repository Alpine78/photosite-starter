import { expect, test } from "./support/fixtures";

/**
 * The two namespaces the protected client galleries used (ADR-0014 §9,
 * ADR-0015 §1) own no route since AB#313. Their prefixes stay reserved, and
 * every path under them — and under the two literal segments the routes lived
 * in — answers a 404 carrying `Cache-Control: no-store`,
 * `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.
 *
 * This runs against the production build the harness serves, which is where
 * the Proxy matcher and the Proxy-over-`next.config.ts` header precedence are
 * exercised. `Referrer-Policy` is the one header with a site-wide value
 * (`strict-origin-when-cross-origin`), so its override proves that precedence.
 *
 * The harness uses the default prefixes (`private`, `admin`); custom prefixes
 * and `buildRobotsPolicy`'s production-only `Disallow` entries are covered in
 * `src/proxy.test.ts` and `src/lib/robots.test.ts`.
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

const RESERVED_PATHS = [
  "/private",
  "/private/some-gallery-handle",
  "/private/handle/",
  // Deep paths with a dotted last segment: an earlier matcher excluded these.
  "/private/some-handle/preview.jpg",
  "/private/some-handle/download.v2.zip",
  "/private/some-handle/exchange",
  "/admin",
  "/admin/login",
  "/admin/login/",
  "/admin/galleries/some-gallery-id/export.zip",
  // The literal segments the removed routes lived under.
  "/private-gallery/some-handle",
  "/private-gallery-admin/login",
];

test.describe("retired protected namespaces", () => {
  for (const path of RESERVED_PATHS) {
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
      expect(await response.text()).toBe("");
    });
  }

  for (const [method, path] of [
    ["post", "/admin/login"],
    ["post", "/private/some-handle/exchange"],
    ["put", "/private/some-handle/proof"],
    ["patch", "/admin/delivery"],
  ] as const) {
    test(`${method.toUpperCase()} ${path} is the same 404 and sets no cookie`, async ({ request }) => {
      const response = await request[method](path, { maxRedirects: 0, data: { secret: "x", capability: "x" } });
      expect(response.status()).toBe(404);
      expect(response.headers()["set-cookie"]).toBeUndefined();
      for (const [key, value] of Object.entries(HYGIENE)) {
        expect(response.headers()[key]).toBe(value);
      }
    });
  }

  test("the removed link bootstrap script is gone", async ({ request }) => {
    const response = await request.get("/private-gallery-bootstrap.js", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
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

  test("a repeated-separator URL 308s to the clean reserved form (framework limitation)", async ({
    request,
  }) => {
    // Next collapses a repeated separator with its own bare 308 before the
    // Proxy or its matcher runs, so this one redirect carries none of the
    // hygiene headers and is not decoratable at the app layer. This pins the
    // behaviour: the redirect lands on the clean URL, which is the hygienic 404.
    const response = await request.get("/private//handle", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toBe("/private/handle");
  });

  test("grants no object-store image source", async ({ request }) => {
    // The conditional grant for an `enabled` store is covered in
    // `src/lib/next-config.test.ts`; here the default must not widen `img-src`.
    const policy =
      (await request.get("/private/some-handle", { maxRedirects: 0 })).headers()[
        "content-security-policy"
      ] ?? "";

    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/img-src[^;]*https:/);
  });

  test("a path that merely starts with a prefix is an ordinary public 404", async ({
    request,
  }) => {
    // `/administrator` is Joomla's own admin path and a plausible probe. It is
    // not in the namespace, so it must not inherit its headers.
    const response = await request.get("/administrator", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()["x-robots-tag"]).toBeUndefined();
    expect(response.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  test("robots.txt allows neither namespace", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).not.toMatch(/Allow:\s*\/private/i);
    expect(body).not.toMatch(/Allow:\s*\/admin/i);
  });
});

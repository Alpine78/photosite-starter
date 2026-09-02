import { getBuiltInLabels } from "@/lib/deployment-config";

import {
  appUnderTestEnvironment,
  HARNESS_BASE_URL,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The private client-gallery link journey (ADR-0014 §3), against the production
 * build the harness serves.
 *
 * This is the one place the whole chain actually runs together: the Proxy
 * rewrite from the deployment-configured prefix onto the internal route, the
 * bootstrap document that looks nothing up, the external same-origin script
 * reading the URL fragment under the real CSP, the exchange endpoint, and the
 * session cookie. Every part has its own Vitest coverage; none of it proves the
 * pieces are *wired*, and two of the properties here — that a browser never
 * sends the fragment, and that `script-src 'self'` admits the bootstrap — exist
 * only in a browser.
 *
 * The harness runs `PRIVATE_GALLERY_STORE=memory`, whose fixture link is a
 * published constant (`src/lib/private-gallery-memory-store.ts`). The literals
 * are written out here because that module carries the `server-only` marker;
 * `private-gallery-memory-store.test.ts` pins them so the two cannot drift.
 * They are not credentials: a production deployment refuses this store, and
 * each run seals the fixture under a fresh ephemeral key, so a value in a
 * published failure artifact authorizes nothing anywhere.
 */
const HANDLE = "EREREREREREREREREREREQ";
const CAPABILITY = "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0";
const GALLERY_PATH = `/private/${HANDLE}`;
/**
 * The right shape, naming no gallery. It must decode canonically — a handle
 * that does not is refused as malformed long before any store is consulted, so
 * it would test a different path than the one these cases are about.
 */
const UNKNOWN_HANDLE = "MzMzMzMzMzMzMzMzMzMzMw";

/**
 * The authorized view's heading. A clone rebrands application labels, so this
 * is read from the harness's own configured locale rather than hardcoded as
 * prose — `getBuiltInLabels` is the same source the page renders from.
 */
const GALLERY_HEADING = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE as string,
).privateGallery.galleryHeading;

test.describe("private gallery link", () => {
  test("exchanges the fragment capability for a session", async ({ page }) => {
    const exchanges: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") exchanges.push(request.url());
    });

    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);
    // The listener above is already recording, so poll it rather than starting
    // a fresh wait: the exchange fires during `goto` and would be missed.
    await expect.poll(() => exchanges.length).toBe(1);

    // The capability is gone from the address bar, so it cannot be shoulder-read,
    // screenshotted, or reached with the Back button.
    expect(page.url()).not.toContain(CAPABILITY);
    expect(page.url()).not.toContain("#");
    expect(new URL(page.url()).pathname).toBe(GALLERY_PATH);

    // The browser addressed the configured public prefix; the internal rewrite
    // target is never a URL a client sees.
    expect(exchanges).toEqual([
      `${new URL(page.url()).origin}${GALLERY_PATH}/exchange`,
    ]);

    // The capability never travelled in a URL, only in the request body.
    for (const url of exchanges) expect(url).not.toContain(CAPABILITY);
  });

  test("issues a host-only session cookie scoped to this gallery", async ({
    request,
  }) => {
    // Asserted on the wire, so it holds in every browser project: the harness
    // serves plain HTTP on a loopback address, and WebKit refuses to *store* a
    // `Secure` cookie there at all (Chromium accepts one, treating loopback as
    // trustworthy). A real deployment is HTTPS, so this is a harness limitation
    // rather than a product one — but it is why the browser-storage half below
    // runs only where it can.
    const response = await request.post(`${GALLERY_PATH}/exchange`, {
      headers: {
        "content-type": "application/json",
        origin: HARNESS_BASE_URL,
      },
      data: { capability: CAPABILITY },
    });

    expect(response.status()).toBe(200);
    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("__Secure-");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
    // Scoped to this gallery's own path, so another gallery's route never
    // receives it.
    expect(setCookie).toContain(`Path=${GALLERY_PATH}`);
    // No `Domain`, so the cookie stays host-only and no sibling host sees it.
    expect(setCookie.toLowerCase()).not.toContain("domain=");
  });

  test("a real browser stores that cookie with the same scope", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit does not store a Secure cookie over the harness's plain-HTTP loopback origin; the wire contract is asserted for every browser in the test above.",
    );

    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      GALLERY_HEADING,
    );

    const cookie = (await context.cookies()).find((row) =>
      row.name.startsWith("__Secure-"),
    );
    expect(cookie, "the exchange set a __Secure- session cookie").toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe(GALLERY_PATH);
    expect(cookie?.domain).toBe(new URL(page.url()).hostname);
  });

  test("shows the invalid state for a link with no fragment", async ({ page }) => {
    await page.goto(GALLERY_PATH);

    const status = page.getByRole("status");
    await expect(status).toHaveText(
      (await status.getAttribute("data-invalid")) as string,
    );
  });

  test("shows the same invalid state for a wrong capability", async ({ page }) => {
    // The bootstrap has exactly one failure message because the endpoint has
    // exactly one refusal; a second, more specific message here would undo that.
    await page.goto(`${GALLERY_PATH}#${"A".repeat(43)}`);

    const status = page.getByRole("status");
    await expect(status).toHaveText(
      (await status.getAttribute("data-invalid")) as string,
    );
    expect(page.url()).not.toContain("#");
  });

  test("renders the same document for a handle that names nothing", async ({
    page,
  }) => {
    // The initial GET carries no credential and must never reveal whether the
    // handle exists. The handle itself is naturally echoed in the routing
    // payload — it is the address the visitor asked for — so the property is
    // that *nothing else* differs: with the handle masked out, the two
    // documents are byte-identical.
    const mask = (body: string, handle: string) =>
      body.split(handle).join("<handle>");
    const real = mask(
      await (await page.request.get(GALLERY_PATH)).text(),
      HANDLE,
    );
    const unknown = mask(
      await (await page.request.get(`/private/${UNKNOWN_HANDLE}`)).text(),
      UNKNOWN_HANDLE,
    );

    expect(unknown).toBe(real);
  });

  test("serves the bootstrap page with the private hygiene headers", async ({
    request,
  }) => {
    const response = await request.get(GALLERY_PATH, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  test("404s a malformed handle and the internal rewrite target", async ({
    request,
  }) => {
    // A handle that cannot name a gallery, and the literal internal segment the
    // Proxy rewrites onto — which would otherwise be a second door into the
    // namespace, reachable without the configured prefix or its hygiene headers.
    for (const path of [
      "/private/not-a-handle",
      `/private-gallery/${HANDLE}`,
      `/private-gallery/${HANDLE}/exchange`,
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
  });

  test("refuses a cross-origin exchange", async ({ request }) => {
    const response = await request.post(`${GALLERY_PATH}/exchange`, {
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.test",
      },
      data: { capability: CAPABILITY },
    });

    expect(response.status()).toBe(403);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });

  test("answers an unknown handle exactly like a wrong capability", async ({
    request,
  }) => {
    // Same-origin, so both requests pass the header guard and are refused by
    // the credential check itself rather than ahead of it.
    const shape = async (path: string, capability: string) => {
      const response = await request.post(`${path}/exchange`, {
        headers: {
          "content-type": "application/json",
          origin: HARNESS_BASE_URL,
        },
        data: { capability },
      });
      const headers = response.headers();
      return {
        status: response.status(),
        body: await response.text(),
        setCookie: headers["set-cookie"],
        retryAfter: headers["retry-after"],
        cacheControl: headers["cache-control"],
      };
    };

    // Same status, same body, same headers: nothing distinguishes a handle that
    // exists from one that does not.
    expect(await shape(`/private/${UNKNOWN_HANDLE}`, CAPABILITY)).toEqual(
      await shape(GALLERY_PATH, "A".repeat(43)),
    );
  });
});

/**
 * Everything that needs the browser to actually *hold* the session.
 *
 * The harness serves plain HTTP on a loopback address and WebKit refuses to
 * store a `Secure` cookie there at all, while Chromium treats loopback as
 * trustworthy and accepts one. A real deployment is HTTPS, so this is a harness
 * limitation and not a product one — the cookie's own contract is asserted on
 * the wire for every browser in the group above, and the server-side
 * authorization matrix (expired, superseded, another gallery's session, a
 * gallery that vanished) is proven against the real modules in
 * `src/lib/private-gallery-access.test.ts`. What is left here is the property
 * only a browser shows: that the two documents are actually wired to the cookie.
 */
test.describe("private gallery session in a browser", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "WebKit does not store a Secure cookie over the harness's plain-HTTP loopback origin.",
  );

  test("lands on the gallery once the capability is exchanged", async ({
    page,
  }) => {
    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);

    // The server, not the browser, decides this: it is the session cookie it
    // now sees. One `h1` naming the gallery is the observable difference
    // between holding a link and holding a session.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      GALLERY_HEADING,
    );
    // The bootstrap's status region belongs to the unauthorized document only.
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("keeps the gallery on a later visit, without the link", async ({
    page,
  }) => {
    // The whole point of the session: the visitor comes back to the plain
    // address — no fragment, no capability — and is still in.
    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      GALLERY_HEADING,
    );

    await page.goto(GALLERY_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      GALLERY_HEADING,
    );
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("does not carry the session to another gallery's address", async ({
    page,
  }) => {
    // A valid session pointed at a different handle gets the same
    // credential-free document a stranger gets, so it never reveals whether
    // that handle names anything.
    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      GALLERY_HEADING,
    );

    await page.goto(`/private/${UNKNOWN_HANDLE}`);
    const status = page.getByRole("status");
    await expect(status).toHaveText(
      (await status.getAttribute("data-invalid")) as string,
    );
  });

  test("renders no credential in the authorized document", async ({ page }) => {
    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      GALLERY_HEADING,
    );

    // The handle is deliberately not asserted on: it is the address the visitor
    // asked for, so the routing payload carries it and always will. What must
    // never appear is the credential itself or anything derived from the
    // session — those the visitor's browser holds, and the document does not.
    const body = await page.content();
    expect(body).not.toContain(CAPABILITY);

    const cookie = (await page.context().cookies()).find((row) =>
      row.name.startsWith("__Secure-"),
    );
    expect(cookie?.value).toBeTruthy();
    expect(body).not.toContain(cookie?.value as string);
  });
});

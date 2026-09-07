import { getBuiltInLabels } from "@/lib/deployment-config";

import {
  appUnderTestEnvironment,
  HARNESS_BASE_URL,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The administrator boundary journey (ADR-0015), against the production build
 * the harness serves.
 *
 * The unit suites already prove the *semantics* — the credential format and its
 * constant-time verification, the two throttle layers and their ordering, the
 * session model and its `__Host-` cookie contract, and every failure
 * classification. What only a real browser and a real build can show is that the
 * chain is **wired**: that the configured prefix reaches a file-system route,
 * that the cookie a real browser stores is the one the contract describes, that
 * the session survives a navigation, and that signing out actually ends it.
 *
 * The harness runs `PRIVATE_GALLERY_STORE=memory`, whose administrator secret is
 * a published constant (`src/lib/private-gallery-memory-store.ts`). The literal
 * is written out here rather than imported, because that module carries the
 * `server-only` marker Playwright has no stub for;
 * `private-gallery-memory-store.test.ts` pins it so the two cannot drift.
 */

const ADMIN_SECRET =
  "development-fixture-administrator-secret-not-for-any-real-deployment";

/** The harness leaves `PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX` at its default. */
const ADMIN_PATH = "/admin";
const LOGIN_PATH = "/admin/login";
const LOGOUT_PATH = "/admin/logout";

const COOKIE_NAME = "__Host-pg_admin_session";

/**
 * A request context sends no `Origin` of its own, and §3's boundary refuses a
 * request without one — so a test that omits it never reaches the credential at
 * all and would pass against a completely broken endpoint. Every case that is
 * meant to exercise what lies *behind* the boundary sends this.
 */
const sameOrigin = {
  "content-type": "application/json",
  origin: HARNESS_BASE_URL,
};

const labels = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE as string,
).privateGalleryAdmin;

const URL_CANARY = "SYNTHETIC-ADMIN-URL-CANARY";

for (const mode of ["disabled JavaScript", "blocked hydration"] as const) {
  test.describe(mode, () => {
    test.use({ javaScriptEnabled: mode !== "disabled JavaScript" });

    test("locks sign-in and keeps a forced native submission secret-free", async ({ page }) => {
      const urls: string[] = [];
      page.on("request", (request) => urls.push(request.url()));
      page.on("framenavigated", (frame) => urls.push(frame.url()));
      if (mode === "blocked hydration") {
        await page.route("**/*", (route) =>
          route.request().resourceType() === "script" ? route.abort() : route.continue(),
        );
      }
      await page.goto(ADMIN_PATH);
      const input = page.getByLabel(labels.secretLabel);
      await expect(input).toBeDisabled();
      await expect(page.getByRole("button", { name: labels.signIn })).toBeDisabled();
      if (mode === "disabled JavaScript") {
        // Playwright's text selector skips noscript content even when scripts
        // are disabled. Locate the rendered paragraph directly, then assert
        // both its visibility and its localized message.
        const notice = page.locator("noscript > p");
        await expect(notice).toBeVisible();
        await expect(notice).toHaveText(labels.javascriptRequired);
      }

      // Browser automation seeds a canary even though a visitor cannot type
      // into the disabled field. Force the native path without React handlers;
      // also enable the input to prove that omission of its name protects it.
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === LOGIN_PATH,
      );
      await input.evaluate((element: HTMLInputElement, canary) => {
        element.value = canary;
        element.disabled = false;
        element.form!.submit();
      }, URL_CANARY);
      const response = await responsePromise;
      expect(response.request().method()).toBe("POST");
      expect(response.request().postData() ?? "").not.toContain(URL_CANARY);
      expect(response.status()).toBe(401);
      await expect(page).toHaveURL(`${HARNESS_BASE_URL}${LOGIN_PATH}`);
      expect(urls.every((url) => !url.includes(URL_CANARY))).toBe(true);
      expect((await page.context().cookies()).some((cookie) => cookie.name === COOKIE_NAME)).toBe(false);
    });
  });
}

test("delayed hydration unlocks sign-in and sends the secret only as JSON", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("framenavigated", (frame) => urls.push(frame.url()));
  let releaseScripts!: () => void;
  const scriptsReleased = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await scriptsReleased;
    await route.continue();
  });
  try {
    await page.goto(ADMIN_PATH, { waitUntil: "commit" });
    const input = page.getByLabel(labels.secretLabel);
    const button = page.getByRole("button", { name: labels.signIn });
    await expect(input).toBeDisabled();
    await expect(button).toBeDisabled();
    releaseScripts();
    await expect(input).toBeEnabled();
    await expect(button).toBeEnabled();
    await input.fill(URL_CANARY);
    const requestPromise = page.waitForRequest((request) =>
      new URL(request.url()).pathname === LOGIN_PATH,
    );
    await input.press("Enter");
    const request = await requestPromise;
    expect(request.method()).toBe("POST");
    expect(request.headers()["content-type"]).toBe("application/json");
    expect(request.headers().origin).toBe(HARNESS_BASE_URL);
    expect(request.postDataJSON()).toEqual({ secret: URL_CANARY });
    await expect(page.getByRole("alert").filter({ hasText: labels.signInRefused })).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page).toHaveURL(`${HARNESS_BASE_URL}${ADMIN_PATH}`);
    expect(urls.every((url) => !url.includes(URL_CANARY))).toBe(true);
  } finally {
    releaseScripts();
  }
});

test.describe("administrator sign-in", () => {
  test("offers an accessible sign-in form to a visitor with no session", async ({
    page,
  }) => {
    await page.goto(ADMIN_PATH);

    await expect(
      page.getByRole("heading", { name: labels.title, level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel(labels.secretLabel)).toBeVisible();
    await expect(
      page.getByRole("button", { name: labels.signIn }),
    ).toBeVisible();
    // Nothing about the signed-in surface leaks to someone who is not.
    await expect(page.getByText(labels.administrationPending)).toHaveCount(0);
  });

  test("refuses a wrong secret with one message and no session", async ({
    page,
  }) => {
    await page.goto(ADMIN_PATH);
    await page.getByLabel(labels.secretLabel).fill("not-the-secret-at-all-xxxx");
    await page.getByRole("button", { name: labels.signIn }).click();

    // Scoped by text: Next renders its own `role="alert"` route announcer, so
    // the role alone is not a unique handle on this page.
    await expect(
      page.getByRole("alert").filter({ hasText: labels.signInRefused }),
    ).toBeVisible();
    expect(
      (await page.context().cookies()).find((c) => c.name === COOKIE_NAME),
    ).toBeUndefined();
  });

  test("sets a __Host- cookie with the attributes the contract fixes", async ({
    request,
  }) => {
    // The **wire** contract, asserted for every browser. The stored-cookie
    // tests below cannot run in WebKit on this harness, so this is what keeps
    // the attributes covered there.
    const response = await request.post(LOGIN_PATH, {
      headers: sameOrigin,
      data: { secret: ADMIN_SECRET },
    });
    const setCookie = response.headers()["set-cookie"] ?? "";

    expect(setCookie).toContain(COOKIE_NAME);
    // Attribute *values* are case-insensitive (RFC 6265bis), and Next writes
    // `SameSite=strict`; matching the exact casing would pin a framework
    // detail rather than the contract.
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*SameSite=strict/i);
    expect(setCookie).toMatch(/;\s*Path=\/(;|$)/i);
    // Two hours, ADR-0015 §2's default, rather than merely "a lifetime".
    expect(setCookie).toMatch(/;\s*Max-Age=7200/i);
    // `__Host-` is void if a Domain is present; the browser would refuse the
    // cookie outright, so this is the attribute that must never appear.
    expect(setCookie).not.toContain("Domain=");
  });

  test("signs in, survives a navigation, and signs out again", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit does not store a Secure cookie over the harness's plain-HTTP loopback origin; the wire contract is asserted for every browser in the test above.",
    );

    await page.goto(ADMIN_PATH);
    await page.getByLabel(labels.secretLabel).fill(ADMIN_SECRET);
    await page.getByRole("button", { name: labels.signIn }).click();

    await expect(
      page.getByRole("heading", { name: labels.signedInHeading, level: 1 }),
    ).toBeVisible();
    // The surface says what it can and cannot do rather than implying more.
    await expect(page.getByText(labels.administrationPending)).toBeVisible();

    // Authorization is re-derived server-side on every request, so a fresh
    // navigation is the real check that the session is stored, not just that
    // the login response was rendered.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: labels.signedInHeading, level: 1 }),
    ).toBeVisible();

    await page.getByRole("button", { name: labels.signOut }).click();
    await expect(page.getByLabel(labels.secretLabel)).toBeVisible();

    // Signing out ends the server's session too, not only the browser's cookie:
    // a stored row that outlived the cookie would still authorize anyone
    // holding a copy of the identifier.
    expect(
      (await page.context().cookies()).find((c) => c.name === COOKIE_NAME),
    ).toBeUndefined();
  });

  test("stores that cookie in a real browser, unreadable from script", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit does not store a Secure cookie over the harness's plain-HTTP loopback origin; the wire contract is asserted for every browser above.",
    );

    await page.goto(ADMIN_PATH);
    await page.getByLabel(labels.secretLabel).fill(ADMIN_SECRET);
    await page.getByRole("button", { name: labels.signIn }).click();
    await expect(
      page.getByRole("heading", { name: labels.signedInHeading, level: 1 }),
    ).toBeVisible();

    const cookie = (await page.context().cookies()).find(
      (c) => c.name === COOKIE_NAME,
    );
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    // `__Host-` requires Path=/ and forbids a Domain; a browser that stored it
    // under the prefix has already enforced both, and this pins the shape.
    expect(cookie?.path).toBe("/");

    // It is not readable from script, which is what HttpOnly buys.
    expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE_NAME);
  });
});

test.describe("the administrator namespace", () => {
  test("carries the reserved namespace's response hygiene", async ({
    request,
  }) => {
    const response = await request.get(ADMIN_PATH, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  test("answers a direct request to the internal segment with a 404", async ({
    request,
  }) => {
    // The rewrite target is an implementation detail, not a second door.
    for (const path of [
      "/private-gallery-admin",
      "/private-gallery-admin/login",
    ]) {
      expect(
        (await request.get(path, { maxRedirects: 0 })).status(),
      ).toBe(404);
    }
  });
});

test.describe("the sign-in endpoint", () => {
  test("refuses a cross-origin post", async ({ request }) => {
    const response = await request.post(LOGIN_PATH, {
      headers: { "content-type": "application/json", origin: "https://elsewhere.test" },
      data: { secret: ADMIN_SECRET },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(COOKIE_NAME);
  });

  test("refuses a request with no Origin at all", async ({ request }) => {
    const response = await request.post(LOGIN_PATH, {
      headers: { "content-type": "application/json" },
      data: { secret: ADMIN_SECRET },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(COOKIE_NAME);
  });

  test("refuses a non-JSON content type", async ({ request }) => {
    const response = await request.post(LOGIN_PATH, {
      headers: { ...sameOrigin, "content-type": "text/plain" },
      data: `{"secret":"${ADMIN_SECRET}"}`,
    });
    expect(response.status()).toBe(401);
  });

  test("refuses an unknown field rather than ignoring it", async ({ request }) => {
    const response = await request.post(LOGIN_PATH, {
      headers: sameOrigin,
      data: { secret: ADMIN_SECRET, remember: true },
    });
    expect(response.status()).toBe(401);
  });

  test("accepts the right secret through the endpoint itself", async ({
    request,
  }) => {
    // Proves the same-origin cases above are refused *behind* the boundary
    // rather than at it: the identical shape with a good secret succeeds.
    const response = await request.post(LOGIN_PATH, {
      headers: sameOrigin,
      data: { secret: ADMIN_SECRET },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["set-cookie"] ?? "").toContain(COOKIE_NAME);
  });

  test("answers a wrong secret exactly as it answers a valid one that is refused", async ({
    request,
  }) => {
    // ADR-0015 §3: one indistinguishable refusal. Nothing in the status, the
    // body, or the headers may separate the causes — a caller who could tell
    // "throttled" from "wrong" would know when to resume.
    const wrong = await request.post(LOGIN_PATH, {
      headers: sameOrigin,
      data: { secret: "definitely-not-the-secret-here" },
    });
    const malformed = await request.post(LOGIN_PATH, {
      headers: sameOrigin,
      data: { secret: "" },
    });

    expect(wrong.status()).toBe(401);
    expect(malformed.status()).toBe(401);
    expect(await wrong.text()).toBe(await malformed.text());
    expect(wrong.headers()["retry-after"]).toBeUndefined();
    expect(malformed.headers()["retry-after"]).toBeUndefined();
  });

  test("issues no cookie on any refusal", async ({ request }) => {
    const response = await request.post(LOGIN_PATH, {
      headers: sameOrigin,
      data: { secret: "wrong-secret-value-for-this-test" },
    });
    expect(response.headers()["set-cookie"] ?? "").not.toContain(COOKIE_NAME);
  });
});

test.describe("sign-out", () => {
  test("refuses a cross-origin post", async ({ request }) => {
    const response = await request.post(LOGOUT_PATH, {
      headers: { "content-type": "application/json", origin: "https://elsewhere.test" },
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test("succeeds without a session and reveals nothing by doing so", async ({
    request,
  }) => {
    const response = await request.post(LOGOUT_PATH, {
      headers: sameOrigin,
      data: {},
    });
    expect(response.status()).toBe(200);
  });
});

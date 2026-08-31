import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page, Response } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  HARNESS_BASE_URL,
} from "./support/harness-environment";
import { openLightbox } from "./support/lightbox";
import { expect, test } from "./support/fixtures";

/**
 * AB#123 — the gallery-item enquiry identity & origin validation smoke.
 *
 * The *resolution semantics* — which trusted `mediaId` a reference resolves to,
 * that gallery context is preserved, that a dynamic reference invents no
 * placement, that every tampered / unknown / private / unpublished /
 * non-enquirable identifier is refused with the right class — are already proven
 * exhaustively, against the real mock content source, by
 * `src/lib/enquiry-media.test.ts`; the route's collapse of every rejection to
 * one generic answer and its no-leak posture by
 * `src/app/api/enquiry/route.test.ts`; and `buildEnquiryEmail`'s handling of the
 * private `archiveLocator` by `src/lib/contact-delivery.test.ts`.
 *
 * What only a browser against a **production build** can add, and what this
 * suite is for:
 *
 * - the whole chain is actually *wired and enforced* when the app really runs —
 *   the real content source, the real container authorization, the real origin
 *   and honeypot checks, in `next start` rather than a unit `Request` — with one
 *   representative request per AB#123 AC3 rejection category so a wiring
 *   regression in any single path reddens this gate rather than only the units;
 * - the **browser itself** puts only public identities on the wire (`itemId`,
 *   the gallery `contentId`, the route `locale`) and never a `mediaId`, an
 *   archive locator, or a master URL — a property of the client, observable
 *   only from the client;
 * - the browser never *receives* one back either — every same-origin document,
 *   RSC, and JSON payload it loads across the journey is swept for the private
 *   sentinels, not just the final DOM;
 * - the enquiry view reuses the contact form's authored privacy notice.
 *
 * The dynamic origin has no UI entry point (AB#58/AB#71 own that), and the
 * rejection categories cannot be expressed through the form at all, so those
 * checks are direct requests to the running endpoint — the same shape
 * `sitemap-robots.spec.ts` uses for its routes. They go through Playwright's
 * `APIRequestContext`, which does **not** inherit the browser context's headers
 * or the external-request guard, so each passes its own `Origin` and
 * `x-forwarded-for` explicitly (a distinct throttling identity per request) and
 * `externalRequests` is asserted only for the browser-driven test.
 *
 * Fields and wording that matter are located by application-owned control names
 * and imported built-in labels, never by authored copy, so a clone's rebrand
 * cannot silently change what this gate means. Every address uses a reserved
 * domain that resolves nowhere.
 */

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const ROUTE_LOCALE = appUnderTestEnvironment.SITE_LOCALE; // "en-GB"
const language = new Intl.Locale(ROUTE_LOCALE).language;
const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const APP_ORIGIN = new URL(HARNESS_BASE_URL).origin;

function canonicalPathOf(contentId: string): string {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  const path = getCanonicalContentPath(buildContentTree(treeInput), contentId);
  if (path === null) {
    throw new Error(`[e2e] ${contentId} has no canonical route in ${language}.`);
  }
  return `${STORY_ROOT}/${path.join("/")}`;
}

/** The featured curated gallery; its first placement is enquirable. */
const GALLERY_CONTENT_ID = "content-selected-work";
const GALLERY_PATH = canonicalPathOf(GALLERY_CONTENT_ID);
const FIRST_ITEM = "selected-work-coastal-landscape";
/** Enquirable as a curated placement, and the same photograph reached dynamically. */
const SHARED_MEDIA_ID = "coastal-landscape";

/**
 * Strings that must never reach the browser (AC4). Deliberately not `mediaId` or
 * `placementId`: those are public gallery identities that legitimately appear in
 * the grid and the lightbox (`gallery-result.ts`). These are the genuinely
 * private ones — the mock archive locators, the field name that carries them,
 * and a CMS asset origin.
 */
const PRIVATE_SENTINELS = [
  "/Volumes/Archive/",
  "catalogue://plates/",
  "Drive B / 2021 / marsh",
  "archiveLocator",
  "cdn.sanity.io",
] as const;

const SYNTHETIC = {
  name: "Harness Visitor",
  email: "visitor@harness.test",
  message: "Automated identity/origin smoke. No reply is expected.",
} as const;

function assertNoPrivateSentinel(haystack: string, where: string): void {
  for (const sentinel of PRIVATE_SENTINELS) {
    expect(haystack, `${where} must not contain "${sentinel}"`).not.toContain(
      sentinel,
    );
  }
}

async function fillAndSubmit(page: Page): Promise<void> {
  await page.locator('[name="name"]').fill(SYNTHETIC.name);
  await page.locator('[name="email"]').fill(SYNTHETIC.email);
  await page.locator('[name="message"]').fill(SYNTHETIC.message);
  await page.locator("form").getByRole("button", { name: /\S/ }).click();
}

/**
 * Every same-origin document / RSC / JSON body the browser loads while a test
 * runs, as promises resolved at assertion time — the pattern `contact.spec.ts`
 * uses so a body read never races a navigation. Image and script payloads are
 * skipped: serialized server data can only leak through the first three.
 */
function collectTextResponses(page: Page): Promise<string>[] {
  const bodies: Promise<string>[] = [];
  page.on("response", (response: Response) => {
    if (new URL(response.url()).origin !== APP_ORIGIN) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (!/text\/html|text\/x-component|application\/json/i.test(contentType)) {
      return;
    }
    bodies.push(response.text().catch(() => ""));
  });
  return bodies;
}

test("a curated enquiry puts only public identities on the wire and receives nothing private", async ({
  page,
  externalRequests,
}) => {
  const receivedBodies = collectTextResponses(page);

  await page.goto(GALLERY_PATH);
  const dialog = page.getByRole("dialog");

  await openLightbox(dialog, () =>
    page.getByRole("main").getByRole("button").first().click(),
  );

  const enquire = dialog.getByRole("link", { name: labels.lightbox.enquire });
  const href = await enquire.getAttribute("href");
  const onScreenItem = new URL(href ?? "", HARNESS_BASE_URL).searchParams.get(
    "enquire",
  );
  expect(onScreenItem).toBe(FIRST_ITEM);
  await enquire.click();

  await expect(
    page.getByRole("heading", { name: labels.enquiry.pageTitle }),
  ).toBeVisible();

  await test.step("the enquiry view reuses the contact privacy notice (AC5)", async () => {
    const notice = page
      .getByRole("main")
      .getByRole("region", { name: labels.contact.privacyTitle });
    await expect(notice).toBeVisible();

    for (const term of [
      labels.contact.privacyCollected,
      labels.contact.privacyPurpose,
      labels.contact.privacyRecipient,
      labels.contact.privacyRetention,
    ]) {
      await expect(notice.getByRole("term").filter({ hasText: term })).toHaveCount(
        1,
      );
    }
    // Four statements, each with a non-empty authored description.
    await expect(notice.getByRole("term")).toHaveCount(4);
    for (const definition of await notice.getByRole("definition").all()) {
      await expect(definition).toHaveText(/\S/);
    }
    // The one line the enquiry adds over the shared contact notice.
    await expect(
      notice.getByText(labels.enquiry.itemContextNotice),
    ).toBeVisible();
  });

  const [sentRequest, response] = await test.step(
    "submit and capture the exchange",
    async () => {
      const requestPromise = page.waitForRequest(
        (candidate) =>
          candidate.method() === "POST" &&
          new URL(candidate.url()).pathname === "/api/enquiry",
      );
      const responsePromise = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          new URL(candidate.url()).pathname === "/api/enquiry",
      );
      await fillAndSubmit(page);
      const captured = await Promise.all([requestPromise, responsePromise]);
      return captured;
    },
  );

  await test.step("the browser sent exactly the public context, nothing more (AC1, AC4)", async () => {
    const sent = sentRequest.postDataJSON() as Record<string, unknown>;

    expect(Object.keys(sent).sort()).toEqual(
      [
        "company",
        "contentId",
        "email",
        "itemId",
        "kind",
        "locale",
        "message",
        "name",
        "submissionId",
      ].sort(),
    );
    expect(sent.kind).toBe("curated");
    expect(sent.locale).toBe(ROUTE_LOCALE);
    expect(sent.contentId).toBe(GALLERY_CONTENT_ID);
    expect(sent.itemId).toBe(FIRST_ITEM);
    // No resolved / private identity is ever the browser's to send.
    for (const forbidden of ["mediaId", "placementId", "sectionId", "archiveLocator"]) {
      expect(forbidden in sent).toBe(false);
    }
    assertNoPrivateSentinel(
      sentRequest.postData() ?? "",
      "the outgoing request body",
    );
  });

  await test.step("the endpoint answered with nothing but its generic receipt (AC4)", async () => {
    expect(response.status()).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      status: "delivered",
      correlationId: expect.stringMatching(/\S/),
    });
  });

  await test.step("the success is shown", async () => {
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      labels.contact.successTitle,
    );
  });

  await test.step("no payload the browser received carries a private identifier (AC4)", async () => {
    const bodies = await Promise.all(receivedBodies);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      assertNoPrivateSentinel(body, "a payload the browser received");
    }
    assertNoPrivateSentinel(await page.content(), "the rendered enquiry page");
  });

  // Delivery is server-side; the browser reached no third-party origin.
  expect(externalRequests).toEqual([]);
});

type EnquiryPost = {
  readonly status: number;
  readonly json: Record<string, unknown>;
};

/**
 * A direct POST to the running endpoint. `APIRequestContext` sends no `Origin`
 * and does not inherit the browser context's `x-forwarded-for`, so both are set
 * by the caller: a good `Origin` for the same-origin check, and a distinct
 * throttling identity per call so no row spends another's window allowance.
 */
async function postEnquiry(
  request: APIRequestContext,
  clientKey: string,
  {
    body,
    origin = HARNESS_BASE_URL,
    contentType = "application/json",
  }: {
    body: Record<string, string>;
    origin?: string;
    contentType?: string;
  },
): Promise<EnquiryPost> {
  const payload = {
    name: SYNTHETIC.name,
    email: SYNTHETIC.email,
    message: SYNTHETIC.message,
    company: "",
    submissionId: randomUUID(),
    ...body,
  };
  const response = await request.post("/api/enquiry", {
    headers: {
      "content-type": contentType,
      origin,
      "x-forwarded-for": clientKey,
    },
    // The body only matters for a request that gets past the header checks; a
    // non-JSON type is refused before it is read.
    data:
      contentType === "application/json"
        ? JSON.stringify(payload)
        : "not json",
  });
  return {
    status: response.status(),
    json: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const CURATED_CONTEXT = {
  kind: "curated",
  locale: ROUTE_LOCALE,
  contentId: GALLERY_CONTENT_ID,
  itemId: FIRST_ITEM,
} as const;

test("a valid dynamic reference resolves to the same photograph and invents no container (AC2)", async ({
  request,
  clientAddress,
}) => {
  const ok = await postEnquiry(request, `${clientAddress}-dyn-ok`, {
    body: { kind: "dynamic", locale: ROUTE_LOCALE, itemId: SHARED_MEDIA_ID },
  });
  expect(ok.status).toBe(200);
  expect(ok.json).toEqual({
    status: "delivered",
    correlationId: expect.stringMatching(/\S/),
  });

  // A dynamic result has no container; sending one is a malformed request, not
  // a field to quietly drop — the endpoint must not resolve it as a placement.
  const withContainer = await postEnquiry(request, `${clientAddress}-dyn-box`, {
    body: {
      kind: "dynamic",
      locale: ROUTE_LOCALE,
      itemId: SHARED_MEDIA_ID,
      contentId: GALLERY_CONTENT_ID,
    },
  });
  expect(withContainer.status).toBe(400);
  expect(withContainer.json).toMatchObject({ reason: "malformed-body" });
});

test("every unsafe identifier fails safely through the running endpoint (AC3)", async ({
  request,
  clientAddress,
}) => {
  const malformed = [
    {
      label: "a tampered identity that breaks the public-identity grammar",
      body: { ...CURATED_CONTEXT, itemId: "Not_An_Id" },
    },
    {
      label: "a route locale the deployment does not publish",
      body: { ...CURATED_CONTEXT, locale: "de-DE" },
    },
  ] as const;

  const unavailable = [
    {
      label: "an unknown occurrence inside a real public gallery",
      body: { ...CURATED_CONTEXT, itemId: "selected-work-does-not-exist" },
    },
    {
      label: "an occurrence whose container is an unpublished gallery draft",
      body: { ...CURATED_CONTEXT, contentId: "content-unpublished-gallery-draft" },
    },
    {
      label: "a photograph that is public but not opted in to enquiries",
      body: { ...CURATED_CONTEXT, itemId: "selected-work-lakeside-reeds" },
    },
    {
      label: "a private-only photograph",
      body: { ...CURATED_CONTEXT, itemId: "selected-work-lichen-stones" },
    },
  ] as const;

  for (const [index, row] of malformed.entries()) {
    await test.step(`${row.label} → 400 malformed-body`, async () => {
      const result = await postEnquiry(request, `${clientAddress}-m${index}`, {
        body: { ...row.body },
      });
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ reason: "malformed-body" });
    });
  }

  for (const [index, row] of unavailable.entries()) {
    await test.step(`${row.label} → one generic 404, disclosing nothing`, async () => {
      const result = await postEnquiry(request, `${clientAddress}-u${index}`, {
        body: { ...row.body },
      });
      expect(result.status).toBe(404);
      // Byte-for-byte identical across every category — a probe cannot tell
      // "unknown" from "private" from "unpublished" from "not enquirable".
      expect(result.json).toEqual({
        status: "rejected",
        reason: "item-unavailable",
        correlationId: expect.stringMatching(/\S/),
      });
      const serialized = JSON.stringify(result.json);
      for (const internalClass of [
        "unknown-item",
        "container-unavailable",
        "not-public",
        "not-enquirable",
      ]) {
        expect(serialized).not.toContain(internalClass);
      }
      assertNoPrivateSentinel(serialized, "the 404 answer");
    });
  }
});

test("the enquiry endpoint reuses the contact origin and content-type guards (AC5)", async ({
  request,
  clientAddress,
}) => {
  const crossOrigin = await postEnquiry(request, `${clientAddress}-xo`, {
    body: { ...CURATED_CONTEXT },
    origin: "https://attacker.example",
  });
  expect(crossOrigin.status).toBe(403);
  expect(crossOrigin.json).toMatchObject({ reason: "cross-origin" });

  const wrongType = await postEnquiry(request, `${clientAddress}-ct`, {
    body: { ...CURATED_CONTEXT },
    contentType: "text/plain",
  });
  expect(wrongType.status).toBe(415);
  expect(wrongType.json).toMatchObject({ reason: "unsupported-media-type" });
});

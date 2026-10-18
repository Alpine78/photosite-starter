import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { contactSinkFailureAddress } from "@/lib/contact-delivery-sink";
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
 * The gallery-item enquiry journey (AB#60 PR3): from the lightbox "Enquire"
 * control to a `noindex` form on the gallery page, submitted through the same
 * sink delivery adapter the contact journey uses — the real
 * `resolveEnquiryTarget`, the real `/api/enquiry` boundary, the real response
 * contract, nothing leaving the machine. A reply-to on `delivery-failure.test`
 * is how a failure state is reached; a `?enquire=` for a photograph the fixture
 * does not opt into is how the "not available" state is reached. The endpoint
 * runs end to end in every case.
 *
 * Fields are located by the control `name`s the application owns; wording that
 * matters is the imported built-in label, never written out here, so a
 * translation cannot silently change what this gate means. Every address uses a
 * reserved domain that resolves nowhere.
 */

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;

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

/** The site's featured curated gallery; its first two placements are enquirable. */
const GALLERY_PATH = canonicalPathOf("content-selected-work");
const FIRST_ITEM = "selected-work-coastal-landscape";
const SECOND_ITEM = "selected-work-misty-birch";
/** `lakeside-reeds` is deliberately not `enquiryEligible` in the mock records. */
const NOT_ENQUIRABLE_ITEM = "selected-work-lakeside-reeds";

const SYNTHETIC = {
  name: "Harness Visitor",
  email: "visitor@harness.test",
  message: "Automated public-journey check. No reply is expected.",
} as const;

async function fillAndSubmit(
  page: Page,
  email: string = SYNTHETIC.email,
): Promise<void> {
  const submit = page.locator("form").getByRole("button", { name: /\S/ });
  // The form can arrive in streamed HTML before its input handlers hydrate.
  // Its existing submit guard marks when it can retain the entered values.
  await expect(submit).toBeEnabled();
  await page.locator('[name="name"]').fill(SYNTHETIC.name);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="message"]').fill(SYNTHETIC.message);
  await submit.click();
}

function outcome(page: Page) {
  return page.getByRole("main").getByRole("status");
}

test("a visitor enquires about the photograph they are viewing", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH);
  const dialog = page.getByRole("dialog");

  await test.step("open the lightbox and move to the second photograph", async () => {
    await openLightbox(dialog, () =>
      page.getByRole("main").getByRole("button").first().click(),
    );
    await dialog.getByRole("button", { name: labels.lightbox.next }).click();
  });

  await test.step("the Enquire control names the photograph on screen", async () => {
    const enquire = dialog.getByRole("link", { name: labels.lightbox.enquire });
    await expect(enquire).toHaveAttribute(
      "href",
      `${GALLERY_PATH}?enquire=${SECOND_ITEM}`,
    );
    await enquire.click();
  });

  await test.step("the enquiry form loads on the gallery's own URL", async () => {
    await expect(page).toHaveURL(
      new RegExp(`${GALLERY_PATH}\\?enquire=${SECOND_ITEM}$`),
    );
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: labels.enquiry.pageTitle }),
    ).toBeVisible();
  });

  await test.step("the view is noindex-follow, canonical to the gallery, no hreflang", async () => {
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${GALLERY_PATH}$`),
    );
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  });

  await test.step("a valid submission is delivered", async () => {
    await fillAndSubmit(page);
    await expect(outcome(page)).toContainText(labels.contact.successTitle);
  });
});

test("the Enquire control is reachable and activates by keyboard", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH);
  const dialog = page.getByRole("dialog");
  await openLightbox(dialog, () =>
    page.getByRole("main").getByRole("button").first().click(),
  );

  const enquire = dialog.getByRole("link", { name: labels.lightbox.enquire });
  await enquire.focus();
  await expect(enquire).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(
    new RegExp(`${GALLERY_PATH}\\?enquire=${FIRST_ITEM}$`),
  );
});

test("correcting enquiry errors keeps focus in the field", async ({ page }) => {
  await page.goto(`${GALLERY_PATH}?enquire=${FIRST_ITEM}`);
  const submit = page.locator("form").getByRole("button", { name: /\S/ });
  await expect(submit).toBeEnabled();
  await submit.click();

  const summary = page.getByRole("main").getByRole("alert");
  await expect(summary).toBeFocused();
  const name = page.locator('[name="name"]');
  await summary.getByRole("link").first().click();
  await expect(name).toBeFocused();
  await name.click();
  for (const key of ["a", "b", "c"]) {
    await page.keyboard.insertText(key);
    await expect(name).toBeFocused();
  }
  await expect(name).toHaveValue("abc");
  await expect(summary.getByRole("link")).toHaveCount(2);
});

test("a delivery failure is announced and offered a retry", async ({ page }) => {
  await page.goto(`${GALLERY_PATH}?enquire=${FIRST_ITEM}`);
  await fillAndSubmit(page, contactSinkFailureAddress("provider-unavailable"));

  await expect(outcome(page)).toContainText(labels.contact.errorRetryable);
  await expect(
    page.locator("form").getByRole("button", { name: /\S/ }),
  ).toHaveText(labels.contact.retry);
});

test("a photograph not opted into enquiries is turned away accessibly", async ({
  page,
}) => {
  await page.goto(`${GALLERY_PATH}?enquire=${NOT_ENQUIRABLE_ITEM}`);
  await expect(
    page.getByRole("heading", { name: labels.enquiry.pageTitle }),
  ).toBeVisible();

  await fillAndSubmit(page);

  await expect(outcome(page)).toContainText(labels.enquiry.unavailable);
  await expect(outcome(page)).not.toContainText(labels.contact.errorRetryable);
  await expect(
    page.locator("form").getByRole("button", { name: /\S/ }),
  ).not.toHaveText(labels.contact.retry);
});

test("a malformed ?enquire= is ignored and the gallery renders", async ({
  page,
}) => {
  await page.goto(`${GALLERY_PATH}?enquire=Not_An_Id`);

  await expect(page.getByRole("main").getByRole("list").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: labels.enquiry.pageTitle }),
  ).toHaveCount(0);
});

test("?enquire= combined with a cursor is a 404", async ({ page }) => {
  const response = await page.goto(
    `${GALLERY_PATH}?enquire=${FIRST_ITEM}&cursor=not-a-real-token`,
  );
  expect(response?.status()).toBe(404);
});


for (const [locale, prefix, namespace] of [["en-GB", "", DEFAULT_STORY_NAMESPACE], ["fi", "/fi", "tarinat"]] as const) {
  test(`legacy-mode ordinary enquiry submits in the selected locale (${locale})`, async ({ page }) => {
    const language = new Intl.Locale(locale).language;
    const path = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), "content-selected-work");
    expect(path).not.toBeNull();
    const galleryPath = `${prefix}/${namespace}/${path!.join("/")}`;
    const localized = getBuiltInLabels(locale);
    await page.goto(`${galleryPath}?enquire=${FIRST_ITEM}`);
    await expect(page.getByRole("heading", { name: localized.enquiry.pageTitle })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const sent = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/enquiry" && response.request().method() === "POST");
    await fillAndSubmit(page);
    const response = await sent;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ kind: "curated", locale, contentId: "content-selected-work", itemId: FIRST_ITEM });
    await expect(outcome(page)).toContainText(localized.contact.successTitle);
  });

  test(`a disabled gallery hides enquiries and refuses a crafted request (${locale})`, async ({ page, request }) => {
    const language = new Intl.Locale(locale).language;
    const path = getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), "content-layout-single");
    expect(path).not.toBeNull();
    const galleryPath = `${prefix}/${namespace}/${path!.join("/")}`;
    await page.goto(galleryPath);
    const dialog = page.getByRole("dialog");
    await openLightbox(dialog, () => page.getByRole("main").getByRole("button").first().click());
    await expect(dialog.locator("[data-gallery-enquire]")).toHaveCount(0);
    const response = await request.post("/api/enquiry", {
      headers: { origin: HARNESS_BASE_URL },
      data: { ...SYNTHETIC, company: "", submissionId: randomUUID(), kind: "curated", locale,
        contentId: "content-layout-single", itemId: "layout-single-1" },
    });
    expect(response.status()).toBe(404);
    const direct = await page.goto(`${galleryPath}?enquire=layout-single-1`);
    expect(direct?.status()).toBe(404);
  });
}

test("the lightbox removes an unavailable photograph's enquiry action", async ({ page }) => {
  await page.goto(GALLERY_PATH);
  const dialog = page.getByRole("dialog");
  await openLightbox(dialog, () => page.getByRole("main").getByRole("button").first().click());
  await expect(dialog.getByRole("link", { name: labels.lightbox.enquire })).toBeVisible();
  await dialog.getByRole("button", { name: labels.lightbox.next }).click();
  await expect(dialog.getByRole("link", { name: labels.lightbox.enquire })).toBeVisible();
  await dialog.getByRole("button", { name: labels.lightbox.next }).click();
  await expect(dialog.getByRole("link", { name: labels.lightbox.enquire })).toHaveCount(0);
  await dialog.getByRole("button", { name: labels.lightbox.previous }).click();
  await expect(dialog.getByRole("link", { name: labels.lightbox.enquire })).toHaveAttribute("href", `${GALLERY_PATH}?enquire=${SECOND_ITEM}`);
});

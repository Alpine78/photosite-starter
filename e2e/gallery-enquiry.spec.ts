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
  await page.locator('[name="name"]').fill(SYNTHETIC.name);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="message"]').fill(SYNTHETIC.message);
  await page.locator("form").getByRole("button", { name: /\S/ }).click();
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

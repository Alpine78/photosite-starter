import { getBuiltInLabels } from "@/lib/deployment-config";

import { appUnderTestEnvironment } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The administrator's proof-gallery status / reopen / resend journey (AB#130),
 * against the production build the harness serves.
 *
 * Signing in is real: the administrator login endpoint mutates only the admin
 * session store, never a gallery's proof state, so it carries no risk to the
 * suite's "tests share no state" contract. Every proof-status lookup and
 * action past that point is answered by a `page.route` interception holding
 * its own closure-local state, for the same reason
 * `private-gallery-proof-flow.spec.ts` intercepts the customer side: the
 * fixture's proof gallery is a `globalThis` singleton for the whole harness
 * process, and a reopen or resend committed here would be visible, and wrong,
 * to every other spec and to a rerun of this one.
 */
const ADMIN_SECRET =
  "development-fixture-administrator-secret-not-for-any-real-deployment";
const ADMIN_PATH = "/admin";
const HANDLE = "IiIiIiIiIiIiIiIiIiIiIg";

const adminLabels = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE as string,
).privateGalleryAdmin;
const labels = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE as string,
).privateGalleryProofAdmin;

const PRICING = { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR" };
const draftLabels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE as string).privateGalleryProofCreation;

async function mockProofAdminApi(page: import("@playwright/test").Page) {
  let confirmed = false;
  let draftRevision = 0;
  let notification: { state: "pending" | "sent"; attempts: number } | undefined;

  function status() {
    return {
      handle: HANDLE,
      confirmed,
      draftRevision,
      latestConfirmationVersion: confirmed ? 1 : 0,
      pricing: PRICING,
      ...(confirmed
        ? {
            currentSummary: { selectedCount: 2, extraCount: 1, extraTotalMinor: 1250, currency: "EUR" },
            confirmedAt: new Date().toISOString(),
          }
        : {}),
      ...(notification === undefined ? {} : { notification }),
    };
  }

  await page.route(`**/admin/proof/${HANDLE}`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, status: status() }) });
    }
    const body = JSON.parse(request.postData() ?? "{}") as
      | { action: "reopen"; expectedRevision: number }
      | { action: "resend" };
    if (body.action === "reopen") {
      if (!confirmed) {
        return route.fulfill({ status: 422, contentType: "application/json",
          body: JSON.stringify({ ok: false, reason: "not-confirmed" }) });
      }
      if (body.expectedRevision !== draftRevision) {
        return route.fulfill({ status: 409, contentType: "application/json",
          body: JSON.stringify({ ok: false, reason: "conflict" }) });
      }
      confirmed = false;
      draftRevision += 1;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, revision: draftRevision }) });
    }
    if (!confirmed) {
      return route.fulfill({ status: 422, contentType: "application/json",
        body: JSON.stringify({ ok: false, reason: "not-confirmed" }) });
    }
    notification = { state: "pending", attempts: (notification?.attempts ?? 0) + 1 };
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, confirmationVersion: 1 }) });
  });

  return {
    confirm() {
      confirmed = true;
      draftRevision += 1;
      notification = { state: "pending", attempts: 0 };
    },
  };
}

test.describe("private gallery proof administration", () => {
  test("creates and lists a private draft without showing a customer access link", async ({ page }) => {
    const drafts: Array<{
      handle: string; createdAt: string; revision: number;
      pricing: typeof PRICING; customerReference: string;
    }> = [];
    await page.route("**/admin/proof", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ ok: true, items: drafts, hasMore: true }) });
      }
      if (route.request().method() === "PATCH") {
        const input = JSON.parse(route.request().postData() ?? "{}") as {
          handle: string; expectedRevision: number; pricing: typeof PRICING;
        };
        const current = drafts.find((draft) => draft.handle === input.handle);
        if (!current || current.revision !== input.expectedRevision) {
          return route.fulfill({ status: 409, contentType: "application/json",
            body: JSON.stringify({ ok: false }) });
        }
        current.pricing = input.pricing;
        current.revision += 1;
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ ok: true, draft: current }) });
      }
      const input = JSON.parse(route.request().postData() ?? "{}") as { pricing: typeof PRICING; customerReference: string };
      const draft = { handle: HANDLE, createdAt: new Date().toISOString(), revision: 0,
        pricing: input.pricing, customerReference: input.customerReference };
      drafts.unshift(draft);
      return route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ ok: true, draft }) });
    });
    await page.reload();
    await page.getByLabel(draftLabels.includedCount).fill("2");
    await page.getByLabel(draftLabels.extraUnitPriceMinor).fill("1200");
    await page.getByLabel(draftLabels.currency).fill("EUR");
    await page.getByLabel(draftLabels.customerReference).fill("customer-1");
    await page.getByRole("button", { name: draftLabels.create }).click();
    await expect(page.getByRole("status")).toContainText(HANDLE);
    await expect(page.getByText(draftLabels.hasMore)).toBeVisible();
    await expect(page.getByText("customer-1", { exact: false })).toBeVisible();
    await expect(page.locator(`a[href*="${HANDLE}"]`)).toHaveCount(0);
    await expect(page.getByRole("status")).not.toContainText("#");

    const row = page.getByRole("listitem").filter({ hasText: HANDLE });
    await row.locator("summary").click();
    await row.getByLabel(draftLabels.includedCount).fill("3");
    await row.getByRole("button", { name: draftLabels.savePricing }).click();
    await expect(row).toContainText(`${draftLabels.includedCount}: 3`);
    await expect(page.getByText(draftLabels.savedPricing)).toBeVisible();

    // Another administrator tab has already saved a later revision.
    drafts[0].revision += 1;
    drafts[0].pricing = { ...drafts[0].pricing, includedCount: 4 };
    await row.locator("summary").click();
    await row.getByLabel(draftLabels.includedCount).fill("5");
    await row.getByRole("button", { name: draftLabels.savePricing }).click();
    await expect(page.getByText(draftLabels.conflictPricing)).toBeVisible();
    await expect(row).toContainText(`${draftLabels.includedCount}: 4`);
  });

  test.beforeEach(async ({ page, browserName }) => {
    // WebKit does not store a Secure cookie over this harness's plain-HTTP
    // loopback origin (see `private-gallery-admin.spec.ts` and
    // `private-gallery-link.spec.ts`), so the administrator sign-in below
    // never lands on an authorized session there. A real deployment is HTTPS;
    // this is a harness limitation, not a product one, and desktop Chromium
    // already exercises this whole flow.
    test.skip(
      browserName === "webkit",
      "WebKit does not store a Secure cookie over the harness's plain-HTTP loopback origin.",
    );

    await page.goto(ADMIN_PATH);
    await page.getByLabel(adminLabels.secretLabel).fill(ADMIN_SECRET);
    await page.getByRole("button", { name: adminLabels.signIn }).click();
    await expect(
      page.getByRole("heading", { name: adminLabels.signedInHeading, level: 1 }),
    ).toBeVisible();
  });

  test("reports an open draft, and that resend and reopen refuse it", async ({ page }) => {
    await mockProofAdminApi(page);

    await page.getByLabel(labels.handleLabel).fill(HANDLE);
    await page.getByRole("button", { name: labels.lookUp }).click();

    await expect(page.getByText(labels.openLabel)).toBeVisible();
    const reopenButton = page.getByRole("button", { name: labels.reopenButton });
    const resendButton = page.getByRole("button", { name: labels.resendButton });
    await expect(reopenButton).toBeDisabled();
    await expect(resendButton).toBeDisabled();
  });

  test("reports a confirmed selection, resends, and reopens it", async ({ page }) => {
    const mock = await mockProofAdminApi(page);
    mock.confirm();

    await page.getByLabel(labels.handleLabel).fill(HANDLE);
    await page.getByRole("button", { name: labels.lookUp }).click();

    await expect(page.getByText(labels.confirmedLabel).first()).toBeVisible();

    const resendButton = page.getByRole("button", { name: labels.resendButton });
    await expect(resendButton).toBeEnabled();
    await resendButton.click();
    await expect(page.getByText(labels.resent)).toBeVisible();

    const reopenButton = page.getByRole("button", { name: labels.reopenButton });
    await reopenButton.click();
    await expect(page.getByText(labels.openLabel)).toBeVisible();
    await expect(page.getByRole("button", { name: labels.reopenButton })).toBeDisabled();
  });

  test("shows an unknown handle as not found", async ({ page }) => {
    await page.route("**/admin/proof/**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false }) }),
    );

    await page.getByLabel(labels.handleLabel).fill(HANDLE);
    await page.getByRole("button", { name: labels.lookUp }).click();

    await expect(page.getByText(labels.notFound)).toBeVisible();
  });
});

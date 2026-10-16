import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";

for (const locale of ["fi", "en-GB"]) {
  test(`proof setup distinguishes unpublished states in ${locale}`, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
    await page.context().addCookies(administratorCookies);
    const copy = getBuiltInLabels(locale).privateGalleryProofCreation;
    const base = { createdAt: "2026-10-16T12:00:00.000Z", revision: 1, pricing: { includedCount: 2, extraUnitPriceMinor: 100, currency: "EUR" } };
    await page.route("**/admin/proof", (route) => route.request().method() === "GET" ? route.fulfill({ json: { ok: true, hasMore: false, items: [
      { ...base, handle: "status-draft", state: "draft" },
      { ...base, handle: "status-preparing", state: "preparing", upload: { objectCount: 2, openedAt: base.createdAt, deadline: "2026-11-15T12:00:00.000Z", expired: false } },
      { ...base, handle: "status-ready", state: "ready", upload: { objectCount: 2, openedAt: base.createdAt, deadline: "2026-11-15T12:00:00.000Z", expired: true } },
    ] } }) : route.continue());
    await page.goto(`/admin?locale=${locale}`);
    const section = page.getByRole("region", { name: copy.heading, exact: true });
    const draft = section.getByRole("listitem").filter({ hasText: "status-draft" });
    const preparing = section.getByRole("listitem").filter({ hasText: "status-preparing" });
    const ready = section.getByRole("listitem").filter({ hasText: "status-ready" });
    await expect(draft).toContainText(copy.draftState);
    await expect(preparing).toContainText(copy.preparingState);
    await expect(preparing).toContainText(`${copy.objects}: 2`);
    await expect(preparing.locator('time[datetime="2026-11-15T12:00:00.000Z"]')).toHaveText("2026-11-15T12:00:00.000Z (UTC)");
    await expect(ready).toContainText(copy.readyState);
    await expect(ready).toContainText(copy.windowExpired);
    await expect(ready.getByText(copy.editPricing, { exact: true })).toHaveCount(0);
    await expect(preparing.getByText(copy.editPricing, { exact: true })).toBeVisible();
    await expect(section.locator('a[href*="status-"]')).toHaveCount(0);
  });
}

import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
for (const locale of ["fi", "en-GB"]) {
  test("delivery plan states, deadlines and frozen controls in " + locale, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
    await page.context().addCookies(administratorCookies);
    const copy = getBuiltInLabels(locale).privateGalleryDeliveryCreation;
    const base = { revision: 1, createdAt: "2026-10-16T12:00:00Z" };
    const upload = { plannedPreviewCount: 2, plannedZipCount: 1, openedAt: "2026-10-16T12:00:00Z", deadline: "2026-11-15T12:00:00.000Z", expired: false };
    const rows = [{ ...base, handle: "summary-draft", state: "draft" },
      { ...base, handle: "summary-preparing", state: "preparing", upload },
      { ...base, handle: "summary-ready", state: "ready", upload },
      { ...base, handle: "summary-expired", state: "ready", upload: { ...upload, expired: true } },
      { ...base, handle: "summary-unknown", state: "unknown" }];
    await page.route(/\/admin\/delivery(\?|$)/, (route) => route.request().method() === "GET"
      ? route.fulfill({ json: { ok: true, items: rows, hasMore: false } }) : route.continue());
    await page.goto("/admin?locale=" + locale);
    const section = page.getByRole("region", { name: copy.heading, exact: true });
    const row = (handle: string) => section.getByRole("listitem").filter({ hasText: handle });
    await expect(section.getByRole("listitem")).toHaveCount(5);
    await expect(row("summary-draft")).toContainText(copy.draftState);
    await expect(row("summary-draft").getByText(copy.editReferences, { exact: true })).toBeVisible();
    await expect(row("summary-preparing")).toContainText(copy.preparingState);
    for (const handle of ["summary-preparing", "summary-ready", "summary-expired"]) {
      await expect(row(handle)).toContainText(`${copy.plannedPreviews}: 2`);
      await expect(row(handle)).toContainText(`${copy.plannedZips}: 1`);
      await expect(row(handle)).toContainText(copy.statusSnapshot);
      await expect(row(handle).locator(`time[datetime="${upload.deadline}"]`)).toHaveText(upload.deadline);
      await expect(row(handle).getByText(copy.editReferences, { exact: true })).toHaveCount(0);
    }
    await expect(row("summary-ready")).toContainText(copy.readyState);
    await expect(row("summary-ready")).not.toContainText(copy.windowExpired);
    await expect(row("summary-expired")).toContainText(copy.windowExpired);
    await expect(row("summary-unknown").getByRole("alert")).toHaveText(copy.unavailable);
    await expect(row("summary-unknown").getByText(copy.editReferences, { exact: true })).toHaveCount(0);
    await expect(section.getByRole("link")).toHaveCount(0);
  });
  test("a stale delivery editor retains input until explicit state refresh in " + locale, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
    await page.context().addCookies(administratorCookies);
    const copy = getBuiltInLabels(locale).privateGalleryDeliveryCreation;
    const draft = { handle: "stale-summary-draft", state: "draft", revision: 0, createdAt: "2026-10-16T12:00:00Z", customerReference: "original" };
    let reads = 0;
    await page.route(/\/admin\/delivery(\?|$)/, (route) => {
      if (route.request().method() === "PATCH") {
        expect(route.request().postDataJSON().expectedRevision).toBe(0);
        return route.fulfill({ status: 409, json: { ok: false } });
      }
      if (route.request().method() !== "GET") return route.continue();
      const current = ++reads === 1 ? draft : { ...draft, revision: 1, state: "preparing", upload: {
        plannedPreviewCount: 1, plannedZipCount: 1, openedAt: draft.createdAt, deadline: "2026-11-15T12:00:00.000Z", expired: false } };
      return route.fulfill({ json: { ok: true, items: [current], hasMore: false } });
    });
    await page.goto("/admin?locale=" + locale);
    const section = page.getByRole("region", { name: copy.heading, exact: true });
    const row = section.getByRole("listitem");
    await row.getByText(copy.editReferences, { exact: true }).click();
    await row.getByLabel(copy.customerReference, { exact: true }).fill("unsaved-before-preparation");
    await row.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    await expect(row.getByRole("alert")).toHaveText(copy.conflictReferences);
    await expect(row.getByLabel(copy.customerReference, { exact: true })).toHaveValue("unsaved-before-preparation");
    expect(reads).toBe(1);
    await section.getByRole("button", { name: copy.refresh, exact: true }).click();
    await expect(row).toContainText(copy.preparingState);
    await expect(row.getByLabel(copy.customerReference, { exact: true })).toHaveCount(0);
    await expect(row.getByText(copy.editReferences, { exact: true })).toHaveCount(0);
  });
}

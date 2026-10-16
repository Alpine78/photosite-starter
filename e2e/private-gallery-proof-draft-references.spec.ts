import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { HARNESS_BASE_URL } from "./support/harness-environment";

for (const locale of ["fi", "en-GB"]) {
  test("proof references edit/clear and revision coordination in " + locale, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
    await page.context().addCookies(administratorCookies);
    const copy = getBuiltInLabels(locale).privateGalleryProofCreation;
    await page.goto("/admin?locale=" + locale);
    const section = page.getByRole("region", { name: copy.heading, exact: true });
    const form = section.locator("form").first();
    await form.getByLabel(copy.includedCount, { exact: true }).fill("2");
    await form.getByLabel(copy.extraUnitPriceMinor, { exact: true }).fill("100");
    await form.getByLabel(copy.currency, { exact: true }).fill("EUR");
    await form.getByLabel(copy.customerReference, { exact: true }).fill("original-fixture");
    const creation = page.waitForResponse((r) => new URL(r.url()).pathname === "/admin/proof" && r.request().method() === "POST");
    await form.getByRole("button", { name: copy.create, exact: true }).click();
    const draft = (await (await creation).json()).draft as { handle: string };
    let row = section.getByRole("listitem").filter({ hasText: draft.handle });
    await row.getByText(copy.editReferences, { exact: true }).click();
    const refs = row.locator("details").filter({ has: page.getByText(copy.editReferences, { exact: true }) });
    await refs.getByLabel(copy.customerReference, { exact: true }).fill("retained-while-pricing");
    await row.getByText(copy.editPricing, { exact: true }).click();
    await row.getByLabel(copy.includedCount, { exact: true }).fill("3");
    await row.getByRole("button", { name: copy.savePricing, exact: true }).click();
    await expect(section.getByRole("status").filter({ hasText: copy.savedPricing })).toBeVisible();
    await expect(refs.getByLabel(copy.customerReference, { exact: true })).toHaveValue("retained-while-pricing");
    await refs.getByLabel(copy.jobReference, { exact: true }).fill("job-fixture");
    await refs.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    await expect(section.getByRole("status").filter({ hasText: copy.savedReferences })).toBeVisible();
    await expect(row.getByText(copy.editReferences, { exact: true })).toBeFocused();
    await page.reload();
    row = page.getByRole("region", { name: copy.heading, exact: true }).getByRole("listitem").filter({ hasText: draft.handle });
    await expect(row).toContainText("retained-while-pricing");
    await row.getByText(copy.editReferences, { exact: true }).click();
    await row.getByLabel(copy.customerReference, { exact: true }).fill("unsaved-local");
    const other = await page.request.put("/admin/proof", { headers: { origin: HARNESS_BASE_URL,
      cookie: administratorCookies.map((c) => c.name + "=" + c.value).join("; ") },
      data: { handle: draft.handle, expectedRevision: 2, references: { jobReference: "other-tab" } } });
    expect(other.status()).toBe(200);
    await row.getByText(copy.editPricing, { exact: true }).click();
    await row.getByLabel(copy.includedCount, { exact: true }).fill("4");
    const pricingConflict = page.waitForResponse((r) => new URL(r.url()).pathname === "/admin/proof" && r.request().method() === "PATCH");
    await row.getByRole("button", { name: copy.savePricing, exact: true }).click();
    expect((await pricingConflict).status()).toBe(409);
    await expect(section.getByRole("alert").filter({ hasText: copy.conflictPricing })).toBeVisible();
    await expect(row.getByLabel(copy.customerReference, { exact: true })).toHaveValue("unsaved-local");
    await expect(row.getByLabel(copy.includedCount, { exact: true })).toHaveValue("4");
    const conflict = page.waitForResponse((r) => new URL(r.url()).pathname === "/admin/proof" && r.request().method() === "PUT");
    await row.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(row.getByRole("alert").filter({ hasText: copy.conflictReferences })).toBeVisible();
    await expect(row.getByLabel(copy.customerReference, { exact: true })).toHaveValue("unsaved-local");
    await section.getByRole("button", { name: copy.refresh, exact: true }).click();
    await expect(row).toContainText("other-tab");
    await row.getByText(copy.editReferences, { exact: true }).click();
    await row.getByLabel(copy.jobReference, { exact: true }).fill("");
    await row.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    await expect(row).not.toContainText("other-tab");
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: draft.handle })).not.toContainText("other-tab");
  });
}

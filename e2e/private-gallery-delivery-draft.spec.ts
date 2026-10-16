import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { HARNESS_BASE_URL } from "./support/harness-environment";
for (const locale of ["fi", "en-GB"]) {
  const labels = getBuiltInLabels(locale);
  const copy = labels.privateGalleryDeliveryCreation;
  test(`a failed initial list leaves delivery creation usable in ${locale}`, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on this harness's HTTP loopback origin.");
    let refusedInitialList = false;
    await page.route("**/admin/delivery", async (route) => {
      if (!refusedInitialList && route.request().method() === "GET") {
        refusedInitialList = true;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
      }
      return route.continue();
    });
    await page.context().addCookies(administratorCookies);
    await page.goto(`/admin?locale=${locale}`);
    const section = page.getByRole("region", { name: copy.heading });
    await expect(section.getByRole("status")).toHaveText(copy.unavailable);
    const create = section.getByRole("button", { name: copy.create, exact: true });
    await expect(create).toBeEnabled();
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/delivery" && response.request().method() === "POST");
    await create.click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { draft } = await response.json() as { draft: { handle: string } };
    await expect(section.getByRole("status")).toHaveText(copy.created);
    await expect(section.getByRole("listitem").filter({ hasText: draft.handle })).toBeVisible();
  });
  test(`creates and lists a private delivery draft in ${locale}`, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on this harness's HTTP loopback origin; route authorization is covered independently.");
    await page.context().addCookies(administratorCookies);
    await page.goto(`/admin?locale=${locale}`);
    const section = page.getByRole("region", { name: copy.heading });
    await expect(section).toBeVisible();
    const reference = `fixture-${locale}`;
    await section.getByLabel(copy.customerReference).fill(reference);
    await section.getByLabel(copy.jobReference).fill("job-fixture");
    const creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/delivery" && response.request().method() === "POST");
    await section.getByRole("button", { name: copy.create, exact: true }).click();
    const response = await creation;
    expect(response.status()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    const data = await response.json() as { draft: { handle: string } };
    await expect(section.getByRole("status")).toHaveText(copy.created);
    await expect(section.getByRole("listitem").filter({ hasText: data.draft.handle })).toContainText(reference);
    await expect(section.locator(`a[href*="${data.draft.handle}"]`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: copy.heading }).getByRole("listitem").filter({ hasText: data.draft.handle })).toBeVisible();
    // A created identifier is not a customer capability or a published gallery.
    const exchange = await page.request.post(`/private/${data.draft.handle}/exchange`, {
      headers: { origin: HARNESS_BASE_URL, "content-type": "application/json" },
      data: { capability: "A".repeat(43) },
    });
    expect(exchange.ok()).toBe(false);
  });
}

test.describe("delivery draft without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("disables creation and never serializes external references into native submission", async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on this harness's HTTP loopback origin.");
    await page.context().addCookies(administratorCookies);
    const labels = getBuiltInLabels("en-GB").privateGalleryDeliveryCreation;
    await page.goto("/admin?locale=en-GB");
    const section = page.getByRole("region", { name: labels.heading });
    await expect(section.getByLabel(labels.customerReference)).toBeDisabled();
    await expect(section.getByRole("button", { name: labels.create, exact: true })).toBeDisabled();
    await expect(section.locator("noscript p")).toHaveText(labels.javascriptRequired);
    const result = page.waitForResponse((entry) => new URL(entry.url()).pathname === "/admin/delivery" && entry.request().method() === "POST");
    await section.locator("form").evaluate((form: HTMLFormElement) => {
      const field = form.querySelector("input")!;
      field.disabled = false; field.value = "SYNTHETIC-REFERENCE-CANARY";
      form.submit();
    });
    const native = await result;
    expect(native.status()).toBe(400);
    expect(native.request().postData() ?? "").not.toContain("SYNTHETIC-REFERENCE-CANARY");
    expect(page.url()).not.toContain("SYNTHETIC-REFERENCE-CANARY");
  });
});

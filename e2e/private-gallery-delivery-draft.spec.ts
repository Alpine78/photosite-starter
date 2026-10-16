import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { HARNESS_BASE_URL } from "./support/harness-environment";

test("a simultaneous reference save cannot hide an acknowledged draft creation", async ({ page, browserName, administratorCookies }) => {
  test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
  await page.context().addCookies(administratorCookies);
  const copy = getBuiltInLabels("en-GB").privateGalleryDeliveryCreation;
  await page.goto("/admin?locale=en-GB");
  const section = page.getByRole("region", { name: copy.heading });
  const create = section.getByRole("button", { name: copy.create, exact: true });
  let creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/delivery" && response.request().method() === "POST");
  await create.click();
  const first = (await (await creation).json()).draft as { handle: string };
  const firstItem = section.getByRole("listitem").filter({ hasText: first.handle });
  await expect(firstItem).toBeVisible();
  // Creation now prepends locally and preserves any loaded older pages.
  await expect(create).toHaveAttribute("aria-disabled", "false");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const refreshing = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/admin/delivery", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    started();
    await held;
    await route.continue().catch(() => {}); // A successful save intentionally aborts this stale read.
  });
  try {
    creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/delivery" && response.request().method() === "POST");
    await create.click();
    const second = (await (await creation).json()).draft as { handle: string };
    await section.getByRole("button", { name: copy.refresh, exact: true }).click();
    await refreshing;
    await firstItem.getByText(copy.editReferences, { exact: true }).click();
    await firstItem.getByLabel(copy.jobReference).fill("parallel-edit-fixture");
    await firstItem.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    await expect(section.getByRole("status")).toHaveText(copy.savedReferences);
    await expect(section.getByRole("listitem").filter({ hasText: second.handle })).toBeVisible();
  } finally { release(); }
});

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
    await expect(section.getByRole("alert")).toHaveText(copy.unavailable);
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
    const creationForm = section.getByRole("form", { name: copy.create, exact: true });
    await creationForm.getByLabel(copy.customerReference).fill(reference);
    await creationForm.getByLabel(copy.jobReference).fill("job-fixture");
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
    let item = section.getByRole("listitem").filter({ hasText: data.draft.handle });
    await item.getByText(copy.editReferences, { exact: true }).click();
    await item.getByLabel(copy.customerReference).fill(`${reference}-edited`);
    await item.getByLabel(copy.jobReference).fill("");
    const saving = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/delivery" && response.request().method() === "PATCH");
    await item.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(section.getByRole("status")).toHaveText(copy.savedReferences);
    await expect(item.locator("summary")).toBeFocused();
    await expect(item.getByLabel(copy.customerReference)).toBeVisible();
    await expect(item).toContainText(`${reference}-edited`);
    await expect(item).not.toContainText("job-fixture");
    await page.reload();
    item = page.getByRole("region", { name: copy.heading }).getByRole("listitem").filter({ hasText: data.draft.handle });
    await expect(item).toContainText(`${reference}-edited`);
    // Another tab saves first; the current editor must not discard entered text.
    await item.getByText(copy.editReferences, { exact: true }).click();
    await item.getByLabel(copy.customerReference).fill("unsaved-fixture");
    const latest = await page.request.patch("/admin/delivery", { headers: { origin: HARNESS_BASE_URL,
      cookie: administratorCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") },
      data: { handle: data.draft.handle, expectedRevision: 1, references: { jobReference: "other-tab-fixture" } } });
    expect(latest.status()).toBe(200);
    const conflicting = page.waitForResponse((response) => new URL(response.url()).pathname === "/admin/delivery" && response.request().method() === "PATCH");
    await item.getByRole("button", { name: copy.saveReferences, exact: true }).click();
    expect((await conflicting).status()).toBe(409);
    await expect(item.getByLabel(copy.customerReference)).toHaveValue("unsaved-fixture");
    await expect(item.getByRole("alert")).toHaveText(copy.conflictReferences);
    await expect(item.getByRole("button", { name: copy.saveReferences, exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("region", { name: copy.heading }).getByRole("status")).not.toHaveText(copy.conflictReferences);
    await page.getByRole("button", { name: copy.refresh, exact: true }).click();
    await expect(item).toContainText("other-tab-fixture");
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

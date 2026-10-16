import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";

for (const locale of ["fi", "en-GB"]) for (const kind of ["proof", "delivery"] as const) {
  test(kind + " older drafts append, retry and refresh in " + locale, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
    await page.context().addCookies(administratorCookies);
    const labels = getBuiltInLabels(locale);
    const copy = kind === "proof" ? labels.privateGalleryProofCreation : labels.privateGalleryDeliveryCreation;
    const row = (i: number) => ({ handle: "draft-" + i, revision: 0, createdAt: "2026-10-16T12:00:00Z",
      state: "draft", customerReference: "customer-" + i, pricing: { includedCount: 2, extraUnitPriceMinor: 100, currency: "EUR" } });
    let moreCalls = 0;
    let firstCalls = 0;
    await page.route(new RegExp("/admin/" + kind + "(\\?|$)"), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) {
        expect(cursor).toBe("synthetic-next-page");
        moreCalls++;
        if (moreCalls === 1) return route.fulfill({ status: 503, json: { ok: false } });
        return route.fulfill({ json: { ok: true, hasMore: false, items: [row(99), row(100)] } });
      }
      firstCalls++;
      return route.fulfill({ json: { ok: true, hasMore: true, nextCursor: "synthetic-next-page",
        items: Array.from({ length: 100 }, (_, i) => row(i)) } });
    });
    await page.goto("/admin?locale=" + locale);
    const section = page.getByRole("region", { name: copy.heading, exact: true });
    await expect(section.getByRole("listitem")).toHaveCount(100);
    await section.getByRole("button", { name: copy.loadMore, exact: true }).click();
    await expect(section.getByRole("alert")).toContainText(copy.unavailable);
    await expect(section.getByRole("listitem")).toHaveCount(100);
    await section.getByRole("button", { name: copy.loadMore, exact: true }).click();
    await expect(section.getByRole("listitem")).toHaveCount(101);
    await expect(section.getByRole("listitem").last()).toContainText("customer-100");
    await expect(section.getByRole("button", { name: copy.loadMore, exact: true })).toHaveCount(0);
    const complete = section.getByRole("button", { name: copy.allLoaded, exact: true });
    await expect(complete).toBeFocused();
    await expect(complete).toHaveAttribute("aria-disabled", "true");
    await expect(section.locator('[aria-live="polite"]').filter({ hasText: copy.loadedCount })).toContainText(`${copy.loadedCount}: 101`);
    await section.getByRole("button", { name: copy.refresh, exact: true }).click();
    await expect(section.getByRole("listitem")).toHaveCount(100);
    await expect(section.getByRole("button", { name: copy.loadMore, exact: true })).toBeVisible();
    expect(moreCalls).toBe(2);
    expect(firstCalls).toBe(2);
  });
}

for (const kind of ["proof", "delivery"] as const) for (const initial of ["failed", "pending"] as const) {
  test(`${kind} creation recovers older rows after an initial ${initial} read`, async ({ page, browserName, administratorCookies }) => {
    test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
    await page.context().addCookies(administratorCookies);
    const labels = getBuiltInLabels("en-GB");
    const copy = kind === "proof" ? labels.privateGalleryProofCreation : labels.privateGalleryDeliveryCreation;
    const row = (handle: string) => ({ handle, revision: 0, createdAt: "2026-10-16T12:00:00Z", state: "draft",
      pricing: { includedCount: 2, extraUnitPriceMinor: 100, currency: "EUR" } });
    const created: ReturnType<typeof row>[] = [];
    let reads = 0;
    let initialStarted!: () => void;
    const requested = new Promise<void>((resolve) => { initialStarted = resolve; });
    let recoveryStarted!: () => void;
    const recovering = new Promise<void>((resolve) => { recoveryStarted = resolve; });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(new RegExp("/admin/" + kind + "(\\?|$)"), async (route) => {
      if (route.request().method() === "POST") {
        const draft = row("created-" + (created.length + 1)); created.unshift(draft);
        return route.fulfill({ status: 201, json: { ok: true, draft } });
      }
      if (route.request().method() !== "GET") return route.continue();
      const call = ++reads;
      if (call === 1) {
        initialStarted();
        if (initial === "pending") await held;
        return route.fulfill({ status: 503, json: { ok: false } }).catch(() => {});
      }
      if (initial === "pending" && call === 2) {
        recoveryStarted(); await held;
        return route.fulfill({ json: { ok: true, hasMore: false, items: [] } }).catch(() => {});
      }
      return route.fulfill({ json: { ok: true, hasMore: false, items: [...created, row("older-draft")] } });
    });
    await page.goto("/admin?locale=en-GB");
    await requested;
    const section = page.getByRole("region", { name: copy.heading, exact: true });
    if (initial === "failed") await expect(section.getByRole("alert")).toContainText(copy.unavailable);
    const form = section.locator("form").first();
    if (kind === "proof") {
      await form.getByLabel(labels.privateGalleryProofCreation.includedCount, { exact: true }).fill("2");
      await form.getByLabel(labels.privateGalleryProofCreation.extraUnitPriceMinor, { exact: true }).fill("100");
      await form.getByLabel(labels.privateGalleryProofCreation.currency, { exact: true }).fill("EUR");
    }
    await form.getByRole("button", { name: copy.create, exact: true }).click();
    if (initial === "pending") {
      await recovering;
      // No authoritative page has been read yet while the first recovery read is held.
      await expect(section.getByRole("button", { name: copy.allLoaded, exact: true })).toHaveCount(0);
      await form.getByRole("button", { name: copy.create, exact: true }).click();
    }
    await expect(section.getByRole("listitem").filter({ hasText: "older-draft" })).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(initial === "pending" ? 3 : 2);
    release();
    await expect(section.getByRole("button", { name: copy.allLoaded, exact: true })).toBeVisible();
    await expect(section.getByRole("listitem").filter({ hasText: "created-1" })).toBeVisible();
    if (initial === "pending") await expect(section.getByRole("listitem").filter({ hasText: "created-2" })).toBeVisible();
  });
}
test("a saved delivery revision cancels an older page read and creation preserves the loaded tail", async ({ page, browserName, administratorCookies }) => {
  test.skip(browserName === "webkit", "WebKit does not store Secure cookies on HTTP loopback.");
  await page.context().addCookies(administratorCookies);
  const copy = getBuiltInLabels("en-GB").privateGalleryDeliveryCreation;
  const first = { handle: "draft-first", revision: 0, createdAt: "2026-10-16T12:00:00Z", customerReference: "original" };
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/admin\/delivery(\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") return route.fulfill({ json: { ok: true, draft: { ...first, revision: 1, customerReference: "saved" } } });
    if (request.method() === "POST") return route.fulfill({ status: 201, json: { ok: true, draft: { handle: "draft-new", revision: 0, createdAt: first.createdAt } } });
    if (new URL(request.url()).searchParams.has("cursor")) {
      started!(); await held;
      return route.fulfill({ json: { ok: true, hasMore: false, items: [{ ...first, customerReference: "stale" }, { ...first, handle: "draft-tail" }] } }).catch(() => {});
    }
    return route.fulfill({ json: { ok: true, items: [first], hasMore: true, nextCursor: "next" } });
  });
  await page.goto("/admin?locale=en-GB");
  const section = page.getByRole("region", { name: copy.heading, exact: true });
  const item = section.getByRole("listitem").filter({ hasText: first.handle });
  await item.getByText(copy.editReferences, { exact: true }).click();
  await item.getByLabel(copy.customerReference, { exact: true }).fill("saved");
  await section.getByRole("button", { name: copy.loadMore, exact: true }).click();
  await requested;
  await item.getByRole("button", { name: copy.saveReferences, exact: true }).click();
  await expect(section.getByRole("status")).toHaveText(copy.savedReferences);
  release!();
  await expect(item.getByLabel(copy.customerReference, { exact: true })).toHaveValue("saved");
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await page.unroute(/\/admin\/delivery(\?|$)/);
  await page.route(/\/admin\/delivery(\?|$)/, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, hasMore: false,
      items: [{ ...first, handle: "draft-tail" }] } });
    if (route.request().method() === "POST") return route.fulfill({ status: 201, json: { ok: true,
      draft: { handle: "draft-new", revision: 0, createdAt: first.createdAt } } });
    return route.continue();
  });
  await section.getByRole("button", { name: copy.loadMore, exact: true }).click();
  await expect(section.getByRole("listitem")).toHaveCount(2);
  await section.getByRole("form", { name: copy.create }).getByRole("button", { name: copy.create, exact: true }).click();
  await expect(section.getByRole("listitem")).toHaveCount(3);
  await expect(section.getByRole("listitem").last()).toContainText("draft-tail");
  await expect(section.getByRole("listitem").first()).toContainText("draft-new");
});

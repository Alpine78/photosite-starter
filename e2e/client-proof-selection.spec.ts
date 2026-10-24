import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";

// ADR-0038 action item 3: selecting on the proof page with the key from the link's fragment.
// The harness store opens one synthetic selection per key, so every test uses fresh keys.
const route = `/client-proof/${"7".repeat(32)}`;
const freshKey = () => randomBytes(32).toString("base64url");
const refusedKey = () => `AAAA${freshKey().slice(4)}`;

for (const locale of [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix]) {
  const all = getBuiltInLabels(locale), labels = all.proofSelection;
  const proof = (reference: string) => all.proofGallery.reference.replace("{reference}", reference);
  const toggle = (page: Page, reference: string) => page.getByRole("button", { name: labels.toggle.replace("{reference}", proof(reference)) });
  const region = (page: Page) => page.getByRole("region", { name: labels.heading });

  test.describe(`proof selection ${locale}`, () => {
    test("saves with the keyboard, confirms deliberately and keeps the confirmed record", async ({ page, externalRequests }) => {
      await page.goto(`${route}?locale=${locale}#select=${freshKey()}`);
      await expect(region(page)).toContainText(labels.possession);
      await expect(page.getByRole("button", { name: labels.confirm })).toBeDisabled();
      await toggle(page, "014").focus();
      await page.keyboard.press("Enter");
      await expect(toggle(page, "014")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("status")).toHaveText(labels.saved);
      await toggle(page, "002").press("Space");
      await expect(toggle(page, "002")).toHaveAttribute("aria-pressed", "true");
      await expect(region(page)).toContainText(labels.counts.replace("{count}", "2").replace("{included}", "1"));
      await page.getByRole("button", { name: labels.confirm }).focus();
      await page.keyboard.press("Enter");
      await expect(region(page)).toContainText(labels.confirmReview.replace("{count}", "2"));
      const review = region(page).getByRole("heading", { name: labels.confirmReview.replace("{count}", "2") });
      await expect(review).toBeFocused();
      await expect(page.getByRole("heading", { name: labels.confirmedHeading })).toHaveCount(0);
      // The proofs being confirmed are listed before the record is locked.
      await expect(region(page).getByRole("list", { name: labels.confirmedList }).getByRole("listitem")).toHaveText([proof("002"), proof("014")]);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: labels.confirmFinal })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: labels.cancel })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: labels.confirm })).toBeFocused();
      await page.getByRole("button", { name: labels.confirm }).click();
      await expect(review).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: labels.confirmFinal })).toBeFocused();
      await page.keyboard.press("Enter");
      const confirmed = page.getByRole("heading", { name: labels.confirmedHeading });
      await expect(confirmed).toBeFocused();
      const list = page.getByRole("region", { name: labels.confirmedHeading }).getByRole("list");
      await expect(list.getByRole("listitem")).toHaveText([proof("002"), proof("014")]);
      await expect(toggle(page, "014")).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { name: labels.confirmedHeading })).toBeVisible();
      await expect(toggle(page, "002")).toHaveCount(0);
      expect(externalRequests).toEqual([]);
    });
  });
}

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).proofSelection;
const proofLabel = (reference: string) => getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).proofGallery.reference.replace("{reference}", reference);
const toggleOf = (page: Page, reference: string) => page.getByRole("button", { name: labels.toggle.replace("{reference}", proofLabel(reference)) });

test("without a key the page stays read-only, and a refused key shows one uniform message", async ({ page }) => {
  await page.goto(route);
  await expect(page.getByRole("main").locator("figcaption")).toHaveCount(2);
  await expect(page.getByRole("region", { name: labels.heading })).toHaveCount(0);
  await expect(toggleOf(page, "014")).toHaveCount(0);
  await page.goto(`${route}#select=${refusedKey()}`);
  await expect(page.getByRole("region", { name: labels.heading })).toContainText(labels.unavailable);
  await expect(toggleOf(page, "014")).toHaveCount(0);
});

test("a save from an outdated window adopts the newer selection instead of overwriting it", async ({ page, context }) => {
  const key = freshKey();
  const other = await context.newPage();
  await page.goto(`${route}#select=${key}`);
  await other.goto(`${route}#select=${key}`);
  await expect(toggleOf(other, "002")).toBeVisible();
  await toggleOf(page, "014").click();
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "true");
  await toggleOf(other, "002").click();
  await expect(other.getByRole("status")).toHaveText(labels.conflict);
  await expect(toggleOf(other, "014")).toHaveAttribute("aria-pressed", "true");
  await expect(toggleOf(other, "002")).toHaveAttribute("aria-pressed", "false");
});

test("changing language keeps the selection key and the saved selection", async ({ page }) => {
  const key = freshKey();
  await page.goto(`${route}#select=${key}`);
  await toggleOf(page, "002").click();
  await expect(toggleOf(page, "002")).toHaveAttribute("aria-pressed", "true");
  const finnish = getBuiltInLabels(PREFIXED_LOCALE.prefix);
  await page.getByRole("navigation", { name: getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).contentTree.languages }).getByRole("link").first().click();
  await expect(page).toHaveURL((url) => url.hash === `#select=${key}` && url.searchParams.get("locale") === PREFIXED_LOCALE.prefix);
  const finnishToggle = page.getByRole("button", { name: finnish.proofSelection.toggle.replace("{reference}", finnish.proofGallery.reference.replace("{reference}", "002")) });
  await expect(finnishToggle).toHaveAttribute("aria-pressed", "true");
});

test("a save whose answer is lost is read back, never replayed, and a failed read blocks changes until checked", async ({ page }) => {
  await page.goto(`${route}#select=${freshKey()}`);
  await expect(toggleOf(page, "014")).toBeVisible();
  let selects = 0, blockReads = false;
  await page.route("**/api/proof-selection", async (route) => {
    const operation = (route.request().postDataJSON() as { operation: string }).operation;
    if (operation === "select") {
      selects++;
      await route.fetch(); // the write reaches the server and commits…
      return route.abort("connectionreset"); // …but its answer never arrives
    }
    if (operation === "read" && blockReads) return route.abort("connectionreset");
    return route.continue();
  });
  await toggleOf(page, "014").click();
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "true");
  expect(selects).toBe(1);
  blockReads = true;
  await toggleOf(page, "002").click();
  const check = page.getByRole("button", { name: labels.checkAgain });
  await expect(check).toBeVisible();
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-disabled", "true");
  expect(selects).toBe(2);
  blockReads = false;
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(toggleOf(page, "002")).toHaveAttribute("aria-pressed", "true");
  expect(selects).toBe(2);
});

test("a new key in the fragment starts a fresh session", async ({ page }) => {
  await page.goto(`${route}#select=${freshKey()}`);
  await toggleOf(page, "014").click();
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate((key) => { window.location.hash = `select=${key}`; }, freshKey());
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => { window.location.hash = ""; });
  await expect(page.getByRole("region", { name: labels.heading })).toHaveCount(0);
});

test("a toggle keeps keyboard focus through its save, so it can be pressed again", async ({ page }) => {
  await page.goto(`${route}#select=${freshKey()}`);
  await toggleOf(page, "014").focus();
  await page.keyboard.press("Enter");
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "true");
  await expect(toggleOf(page, "014")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "false");
  await expect(toggleOf(page, "014")).toBeFocused();
});

test("a failed first read offers to try again", async ({ page }) => {
  let failReads = true;
  await page.route("**/api/proof-selection", (route) => failReads ? route.abort("connectionreset") : route.continue());
  await page.goto(`${route}#select=${freshKey()}`);
  const retry = page.getByRole("button", { name: labels.checkAgain });
  await expect(page.getByRole("region", { name: labels.heading })).toContainText(labels.loadFailed);
  failReads = false;
  await retry.click();
  await expect(toggleOf(page, "014")).toHaveAttribute("aria-pressed", "false");
});

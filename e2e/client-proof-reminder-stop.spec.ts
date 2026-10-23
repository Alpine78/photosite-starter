import { randomBytes } from "node:crypto";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { expect, test } from "./support/fixtures";
import { appUnderTestEnvironment, PREFIXED_LOCALE } from "./support/harness-environment";

// ADR-0038 amendment 2026-10-23: the customer's own reminder stop, on the harness store.
const route = `/client-proof/${"7".repeat(32)}/reminders`;
const freshKey = () => randomBytes(32).toString("base64url");
const hygiene = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

for (const locale of [appUnderTestEnvironment.SITE_LOCALE, PREFIXED_LOCALE.prefix]) {
  const labels = getBuiltInLabels(locale).proofReminderStop;
  test(`reminder stop ${locale}: opening changes nothing; only the button stops, repeatably`, async ({ page, externalRequests }) => {
    const posts: string[] = [];
    page.on("request", (request) => { if (request.method() === "POST") posts.push(request.url()); });
    const key = freshKey();
    const response = await page.goto(`${route}?locale=${locale}#select=${key}`);
    expect(response?.status()).toBe(200);
    for (const [name, value] of Object.entries(hygiene)) expect(response?.headers()[name]).toBe(value);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(labels.title);
    const button = page.getByRole("button", { name: labels.confirm });
    await expect(button).toBeVisible();
    await page.reload();
    await expect(button).toBeVisible();
    expect(posts).toEqual([]);
    // No gallery data on this page: no proofs, captions or images.
    await expect(page.getByRole("main").getByRole("img")).toHaveCount(0);
    await expect(page.getByRole("main").locator("figcaption")).toHaveCount(0);
    await button.click();
    await expect(page.getByRole("status")).toHaveText(labels.stopped);
    expect(posts).toHaveLength(1);
    await page.reload();
    await page.getByRole("button", { name: labels.confirm }).click();
    await expect(page.getByRole("status")).toHaveText(labels.stopped);
    expect(externalRequests).toEqual([]);
  });
}

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).proofReminderStop;

test("a refused key gets the uniform message, and a link without a key says it is incomplete", async ({ page }) => {
  await page.goto(`${route}#select=AAAA${freshKey().slice(4)}`);
  await page.getByRole("button", { name: labels.confirm }).click();
  await expect(page.getByRole("status")).toHaveText(labels.unavailable);
  await page.goto(route);
  await expect(page.getByRole("main")).toContainText(labels.incomplete);
  await expect(page.getByRole("button", { name: labels.confirm })).toHaveCount(0);
});

test("only the exact stop path renders; other subpaths are hygienic 404s", async ({ request }) => {
  for (const path of [`${route}/extra`, `/client-proof/${"7".repeat(32)}/other`, `/client-proof/short/reminders`]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  }
});

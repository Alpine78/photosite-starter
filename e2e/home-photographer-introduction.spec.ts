import { expect, test } from "./support/fixtures";
import { expectImageDelivered } from "./support/public-page";

/** AB#175: the optional introduction is complete, uncropped, and usable in both themes. */
test("home introduction keeps the portrait's full frame and links to contact and services", async ({ page, externalRequests }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const introduction = page.getByRole("region", { name: /hei, olen kuvaaja|hello, i am the person behind the camera/i });
  await expect(introduction.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(introduction.locator("dl dt")).toHaveCount(3);
  await expect(introduction.locator('a[href="/contact"]')).toBeVisible();
  await expect(introduction.locator('a[href="/services"]')).toBeVisible();

  const portrait = introduction.getByRole("img");
  await expectImageDelivered(portrait);
  const geometry = await portrait.evaluate((image: HTMLImageElement) => ({
    sourceWidth: Number(image.getAttribute("width")),
    sourceHeight: Number(image.getAttribute("height")),
    naturalRatio: image.naturalWidth / image.naturalHeight,
    renderedWidth: image.getBoundingClientRect().width,
    renderedHeight: image.getBoundingClientRect().height,
    fit: getComputedStyle(image).objectFit,
  }));
  expect(geometry.sourceWidth).toBe(1024);
  expect(geometry.sourceHeight).toBe(1536);
  expect(Math.abs(geometry.naturalRatio - 2 / 3)).toBeLessThan(0.01);
  expect(Math.abs(geometry.renderedWidth / geometry.renderedHeight - 2 / 3)).toBeLessThan(0.01);
  expect(geometry.fit).not.toBe("cover");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(introduction.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(introduction.locator('a[href="/contact"]')).toBeVisible();
  expect(externalRequests).toEqual([]);
});

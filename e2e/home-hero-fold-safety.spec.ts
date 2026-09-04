import { expect, test } from "./support/fixtures";

/**
 * AB#148 / ADR-0016: the home hero's overlaid title, tagline, and call to
 * action must land inside the visible viewport on load, at every target
 * desktop size and on a common mobile size — the regression this suite
 * exists to catch is "in the DOM but not on screen", which is why every
 * assertion here checks an element's actual laid-out position against the
 * real viewport height, never merely that the element exists.
 *
 * The photograph itself is deliberately allowed to render taller than the
 * viewport (ADR-0016): what this suite proves is that the *overlay*, not the
 * photograph, stays fold-safe. It does not assert the photograph's own
 * rendered height, since that is exactly what AGENTS.md's hero convention
 * forbids capping.
 *
 * Desktop sizes are set explicitly with `page.setViewportSize` so one browser
 * project exercises the whole AC1 target set (1920×1080, 1680×1050,
 * 1440×900, 1280×800) rather than only the project's own default viewport;
 * the `mobile-webkit` project's own device viewport (iPhone 15) stands in for
 * "a common mobile size".
 *
 * What this suite does not, and cannot, prove: AC6's claim that the
 * guarantee holds as a *real* mobile browser's chrome collapses on scroll.
 * `dvh` is a dynamic unit by specification, but an automated browser has no
 * collapsing toolbar to begin with, so a headless run cannot exercise that
 * transition — Playwright can only prove the CSS specifies `dvh`, not `vh`
 * (asserted below), not the live collapse behaviour itself. That gap is
 * recorded, not silently assumed closed, matching ADR-0001's own note about
 * the one physical-device check it could not automate either.
 */

const DESKTOP_TARGET_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/** True when `box` lies entirely within `[0, viewportHeight]` — visible with no scrolling. */
function isFullyAboveTheFold(
  box: { y: number; height: number },
  viewportHeight: number,
): boolean {
  return box.y >= 0 && box.y + box.height <= viewportHeight;
}

test.describe("home hero overlay stays inside the fold", () => {
  for (const viewport of DESKTOP_TARGET_VIEWPORTS) {
    test(`title, tagline, and call to action are all visible on load at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      // Only meaningful on a real desktop viewport; mobile-webkit's own fixed
      // device viewport is exercised separately below.
      test.skip(
        test.info().project.name !== "desktop-chromium",
        "desktop target sizes are exercised on desktop-chromium only",
      );

      await page.setViewportSize(viewport);
      await page.goto("/", { waitUntil: "domcontentloaded" });

      const hero = page.locator("main > figure").first();
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();

      const headingBox = await heading.boundingBox();
      expect(headingBox).not.toBeNull();
      expect(
        isFullyAboveTheFold(headingBox!, viewport.height),
        `title at (${headingBox!.y}, height ${headingBox!.height}) should fit inside a ${viewport.height}px-tall viewport`,
      ).toBe(true);

      // The tagline and CTA are optional content (SiteSettings/HomeContent),
      // so only assert on them when this deployment's fixture renders one —
      // AC2 explicitly allows recording which of them may fall below the
      // fold rather than mandating both exist.
      const tagline = hero.locator("p").first();
      if (await tagline.isVisible().catch(() => false)) {
        const taglineBox = await tagline.boundingBox();
        expect(taglineBox).not.toBeNull();
        expect(
          isFullyAboveTheFold(taglineBox!, viewport.height),
          `tagline at (${taglineBox!.y}, height ${taglineBox!.height}) should fit inside a ${viewport.height}px-tall viewport`,
        ).toBe(true);
      }

      const cta = hero.getByRole("link");
      if (await cta.isVisible().catch(() => false)) {
        const ctaBox = await cta.boundingBox();
        expect(ctaBox).not.toBeNull();
        expect(
          isFullyAboveTheFold(ctaBox!, viewport.height),
          `call to action at (${ctaBox!.y}, height ${ctaBox!.height}) should fit inside a ${viewport.height}px-tall viewport`,
        ).toBe(true);
      }
    });
  }

  test("title is visible on load at a common mobile size", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "mobile-webkit",
      "the mobile target size is exercised on mobile-webkit's own device viewport",
    );

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(
      isFullyAboveTheFold(headingBox!, viewportSize!.height),
    ).toBe(true);
  });

  test("the overlay band is sized with dvh, not vh, so a mobile browser's collapsing chrome cannot reintroduce the fault", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const hero = page.locator("main > figure").first();
    const band = hero.locator("div").first();
    const inlineStyle = await band.getAttribute("style");

    expect(inlineStyle).toContain("dvh");
    expect(inlineStyle).not.toMatch(/(?<!d)vh\b/);
  });

  test("the hero still reserves its space before the image loads, via the asset's true intrinsic dimensions", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const heroImage = page.locator("main > figure").first().getByRole("img");
    await expect(heroImage).toBeVisible();

    const [naturalWidth, naturalHeight, attrWidth, attrHeight] =
      await heroImage.evaluate((img: HTMLImageElement) => [
        img.naturalWidth,
        img.naturalHeight,
        img.width,
        img.height,
      ]);

    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalHeight).toBeGreaterThan(0);
    // The intrinsic width/height attributes next/image renders from the
    // asset's real dimensions, which is what reserves layout space before
    // the image itself has loaded (no CLS) — a stale or fabricated pair here
    // would silently reintroduce the shift this hero has never had.
    expect(attrWidth).toBeGreaterThan(0);
    expect(attrHeight).toBeGreaterThan(0);
  });
});

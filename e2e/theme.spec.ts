import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { firstMixedRatioGalleryPath } from "./support/gallery";
import { openLightbox } from "./support/lightbox";

/**
 * The semantic-token theme contract (AB#36), proven against a production build.
 *
 * The browser-free `src/lib/theme-contract.test.ts` already checks the token
 * values and their contrast arithmetic. This suite covers what only a real
 * rendered page shows:
 *
 *  - `color-scheme` is set for real in both palettes (AC4), so native controls
 *    match rather than staying light under a dark page.
 *  - The `data-theme` pin actually overrides the OS preference in the running
 *    document (AC4).
 *  - Text, the accent action, and the keyboard focus ring clear WCAG AA once
 *    composited by the browser (AC5).
 *  - The always-black lightbox keeps a light focus indicator — the base focus
 *    rule must not leak the site's dark ink onto it.
 *
 * Colours are resolved to sRGB by the browser itself (a 2D canvas paints any
 * CSS colour — `oklab()`, `color-mix()`, a hex custom property — and the pixel
 * is read back), then compared with the relative-luminance formula WCAG
 * defines. Nothing here depends on a screenshot baseline.
 */

type Rgb = [number, number, number];

/** Flatten one opaque CSS colour (`#fff`, `oklab(...)`, `rgb(...)`) to sRGB. */
async function toRgb(page: Page, value: string): Promise<Rgb> {
  const rgb = await page.evaluate((input) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = input;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, value);
  if (!rgb) throw new Error(`could not resolve colour: ${value}`);
  return rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The opaque colour actually painted behind an element: every ancestor's
 * `background-color` composited over the body's, so a semi-transparent
 * `bg-surface-muted` in the chain contributes its real, blended contribution
 * rather than being taken as opaque or skipped.
 */
async function backgroundColor(element: Locator): Promise<string> {
  return element.evaluate((node) => {
    const layers: string[] = [];
    for (let current: Element | null = node; current; current = current.parentElement) {
      layers.push(getComputedStyle(current).backgroundColor);
    }
    layers.push(getComputedStyle(document.body).backgroundColor);

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    for (const layer of layers.reverse()) {
      context.fillStyle = layer;
      context.fillRect(0, 0, 1, 1);
    }
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
}

async function textColor(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).color);
}

async function outlineColor(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).outlineColor);
}

/**
 * Contrast of `foreground` as it actually renders — composited over the opaque
 * `background` — against that background. `text-muted` / `text-subtle` carry an
 * alpha, so measuring the un-composited colour would let a too-light role pass.
 */
async function contrastOf(
  page: Page,
  foreground: string,
  background: string,
): Promise<number> {
  const pixels = await page.evaluate(
    ({ fg, bg }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = bg;
      context.fillRect(0, 0, 1, 1);
      const backdrop = Array.from(context.getImageData(0, 0, 1, 1).data);
      context.fillStyle = fg;
      context.fillRect(0, 0, 1, 1);
      const composited = Array.from(context.getImageData(0, 0, 1, 1).data);
      return { backdrop, composited };
    },
    { fg: foreground, bg: background },
  );
  if (!pixels) throw new Error("no 2d context");
  const bg = pixels.backdrop.slice(0, 3) as Rgb;
  const fg = pixels.composited.slice(0, 3) as Rgb;
  return contrast(fg, bg);
}

async function rootColorScheme(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.documentElement).colorScheme,
  );
}

test.describe("theme contract", () => {
  test("declares color-scheme for real in both palettes", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    expect(await rootColorScheme(page)).toBe("light");

    await page.emulateMedia({ colorScheme: "dark" });
    expect(await rootColorScheme(page)).toBe("dark");
  });

  test("the data-theme pin overrides the OS preference", async ({ page }) => {
    await page.goto("/");

    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
    expect(await rootColorScheme(page)).toBe("light");
    expect(await toRgb(page, await backgroundColor(page.locator("body")))).toEqual(
      [255, 255, 255],
    );

    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    expect(await rootColorScheme(page)).toBe("dark");
    expect(await toRgb(page, await backgroundColor(page.locator("body")))).toEqual(
      [10, 10, 10],
    );
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`body text clears WCAG AA (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/contact");

      // The direct-address list is `text-muted`; its links are the secondary
      // text role at its most-used weight.
      const mutedLink = page
        .getByRole("main")
        .getByRole("list")
        .first()
        .getByRole("link")
        .first();
      await expect(mutedLink).toBeVisible();
      expect(
        await contrastOf(
          page,
          await textColor(mutedLink),
          await backgroundColor(mutedLink),
        ),
      ).toBeGreaterThanOrEqual(4.5);

      // The footer copyright line is the tertiary `text-subtle` role.
      const subtleLine = page.getByRole("contentinfo").getByText(/©/);
      await expect(subtleLine).toBeVisible();
      expect(
        await contrastOf(
          page,
          await textColor(subtleLine),
          await backgroundColor(subtleLine),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });

    test(`the accent action clears WCAG AA (${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/contact");

      const submit = page.getByRole("main").locator("button[type=submit]");
      // `disabled:opacity-60` would skew the reading before hydration.
      await expect(submit).toBeEnabled();

      expect(
        await contrastOf(
          page,
          await textColor(submit),
          await backgroundColor(submit),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });

    test(`the keyboard focus ring clears 3:1 (${colorScheme})`, async ({
      page,
    }, testInfo) => {
      // Tab-driven `:focus-visible` needs a desktop keyboard model. The mobile
      // project emulates a touch device with none, so this assertion belongs to
      // the desktop engine; the focus token itself is checked engine-free in
      // `src/lib/theme-contract.test.ts`.
      test.skip(
        testInfo.project.name === "mobile-webkit",
        "keyboard focus is a desktop interaction",
      );
      await page.emulateMedia({ colorScheme });
      await page.goto("/");

      // Tab to the first focusable chrome control; `:focus-visible` then
      // applies the base `outline-color: var(--color-focus)` rule.
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus-visible");
      await expect(focused).toBeVisible();

      expect(
        await contrastOf(
          page,
          await outlineColor(focused),
          await backgroundColor(focused),
        ),
      ).toBeGreaterThanOrEqual(3);
    });
  }

  test("the black lightbox keeps a light focus indicator", async ({ page }) => {
    const galleryPath = await firstMixedRatioGalleryPath();
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(galleryPath);

    const dialog = page.getByRole("dialog");
    await openLightbox(dialog, async () => {
      await page
        .getByRole("main")
        .getByRole("button")
        .first()
        .click({ timeout: 3_000 });
    });

    // The site's focus token is re-pointed to white for the viewer's subtree.
    const focusToken = await dialog.evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--color-focus").trim(),
    );
    expect(await toRgb(page, focusToken || "#fff")).toEqual([255, 255, 255]);

    // And a real focused control inside it gets a light ring, not dark ink.
    await page.keyboard.press("Tab");
    const ring = await toRgb(
      page,
      await outlineColor(dialog.locator(":focus-visible").first()),
    );
    expect(luminance(ring)).toBeGreaterThan(0.5);
  });
});

import type { Page } from "@playwright/test";

import { getBuiltInLabels } from "@/lib/deployment-config";
import { THEME_STORAGE_KEY } from "../src/lib/theme-preference";
import { appUnderTestEnvironment, HARNESS_BASE_URL } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The site menu's light/dark toggle (AB#173): Kivi (light) or Grafiitti
 * (dark), following the device until a visitor presses it. Proven against a
 * production build:
 *
 *  - pressing it pins the other theme, which persists across navigation and
 *    reload, in both directions against the device setting;
 *  - before the first press the device decides, even when it changes while the
 *    page is open; after it, a device change no longer does;
 *  - with storage blocked, the toggle still works for the page it is on;
 *  - a stored pin is applied before the application's JavaScript runs — the
 *    page is measured while every script bundle is held back, so a broken
 *    bootstrap cannot be masked by hydration;
 *  - without JavaScript the toggle is absent and the site follows the device,
 *    even with a pin stored from an earlier visit.
 *
 * The toggle is found by its application-owned name; its state is
 * `aria-pressed`. Colours are compared with the palettes' own grounds as the
 * browser resolves them. Whichever layout the project renders — the bar, or
 * the compact header beside the menu button — only one toggle is displayed.
 */

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).theme;
const KIVI = "rgb(236, 233, 227)";
const GRAFIITTI = "rgb(27, 28, 30)";

function darkToggle(page: Page) {
  return page.getByRole("banner").getByRole("button", { name: labels.darkTheme });
}

async function pageGround(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function pin(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY);
}

test.describe("theme toggle", () => {
  test("pressing it on a light device pins dark across navigation and reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(darkToggle(page)).toHaveCount(1);
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await pageGround(page)).toBe(KIVI);

    await darkToggle(page).click();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(await pin(page)).toBe("dark");
    expect(await stored(page)).toBe("dark");
    await expect.poll(() => pageGround(page)).toBe(GRAFIITTI);

    await page.goto("/contact");
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(await pageGround(page)).toBe(GRAFIITTI);

    await page.reload();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(await pageGround(page)).toBe(GRAFIITTI);
  });

  test("the device decides until the first press, and not after it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pageGround(page)).toBe(GRAFIITTI);

    // Pressing it while dark shows pins light, which then holds on a dark device.
    await darkToggle(page).click();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => pageGround(page)).toBe(KIVI);
    expect(await stored(page)).toBe("light");

    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await pageGround(page)).toBe(KIVI);
    await page.reload();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await pageGround(page)).toBe(KIVI);
  });

  test("with storage blocked the toggle still works for the page it is on", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await darkToggle(page).click();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pageGround(page)).toBe(GRAFIITTI);
  });

  test("a stored choice is applied before any application script runs", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await darkToggle(page).click();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");

    // Hold back every script bundle for the next document, so nothing but the
    // inline bootstrap can have set the theme when it is measured.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_next/static/**/*.js", async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/services", { waitUntil: "domcontentloaded" });
    expect(await pin(page)).toBe("dark");
    expect(await pageGround(page)).toBe(GRAFIITTI);
    // The bootstrap sits in <head>, ahead of anything the body paints.
    expect(
      await page.evaluate(
        (key) =>
          [...document.head.querySelectorAll("script:not([src])")].some((script) =>
            script.textContent?.includes(key),
          ),
        THEME_STORAGE_KEY,
      ),
    ).toBe(true);

    release();
    await expect(darkToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("the page is set in the self-hosted Instrument Sans", async ({ page }) => {
    await page.goto("/");
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toContain("Instrument Sans");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].some(
            (face) => face.family.includes("Instrument Sans") && face.status === "loaded",
          );
        }),
      )
      .toBe(true);
  });

  test.describe("without JavaScript, with a dark choice stored by an earlier visit", () => {
    test.use({
      javaScriptEnabled: false,
      storageState: {
        cookies: [],
        origins: [
          { origin: HARNESS_BASE_URL, localStorage: [{ name: THEME_STORAGE_KEY, value: "dark" }] },
        ],
      },
    });

    test("the toggle is absent and the device decides", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/");
      expect(await pin(page)).toBeNull();
      expect(await pageGround(page)).toBe(KIVI);
      await expect(darkToggle(page)).toHaveCount(0);

      await page.emulateMedia({ colorScheme: "dark" });
      expect(await pageGround(page)).toBe(GRAFIITTI);
    });
  });
});

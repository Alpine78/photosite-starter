import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { HeroOverlay } from "../src/components/hero-overlay";
import { projectPublicImageMedia } from "../src/lib/media";
import { expect, test } from "./support/fixtures";

const title = "Photographs from the northern coast and the people who call it home";
const description = "A photographic journey through changing seasons, quiet villages and the everyday lives of people along the northern coastline.";
const byline = "By Alex Rivers and the coastal photography collective";
const date = "7 September 2026";
const action = { label: "Explore the northern coast collection", href: "/" };

// Component integration coverage with the production app's CSS and real header.
// Render the real HeroOverlay, next/image included, with synthetic editorial
// inputs rather than copying its markup or changing the site's demo content.
// The image response alone is stubbed: a pure-white frame is the worst contrast
// case, with the exact intrinsic dimensions passed to the component.
test.describe("AB#155: hero text stays on its contrast surface", () => {
  test.use({ javaScriptEnabled: false });

  for (const height of [900, 500]) {
    for (const withByline of [false, true]) {
      test(`${1600}:${height} pale cover, long lead, date${withByline ? " and byline" : ""}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const src = `/gallery/hero-overflow-${height}.abcdef123456.webp`;
        const media = projectPublicImageMedia({
          mediaId: "hero-overflow-test",
          publiclyRenderable: true,
          rendition: {
            src, version: "abcdef123456", width: 1600, height,
            sourceKind: "public-web-derivative",
          },
          alt: "White test frame",
        });
        let paleImageServed = false;
        await page.route("**/_next/image?**", async (route) => {
          if (new URL(route.request().url()).searchParams.get("url") !== src) {
            await route.fallback();
            return;
          }
          paleImageServed = true;
          await route.fulfill({
            contentType: "image/svg+xml",
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}"><rect width="100%" height="100%" fill="white"/></svg>`,
          });
        });
        await page.goto("/", { waitUntil: "load" });
        const markup = renderToStaticMarkup(createElement(HeroOverlay, {
          media, title, description,
          titleClassName: "text-3xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-4xl",
          meta: { dateTime: "2026-09-07", label: date, ...(withByline ? { byline } : {}) },
          action,
        }));
        await page.getByRole("main").evaluate((main, html) => {
          main.innerHTML = html + '<p data-following-content>Following content</p>';
        }, markup);
        await page.evaluate(() => document.fonts.ready);

        const heading = page.getByRole("heading", { level: 1 });
        await expect(heading).toHaveText(title);
        const hero = page.locator("main > figure");
        await expect.poll(() => hero.getByRole("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        expect(paleImageServed).toBe(true);
        await expect(hero.locator("time")).toHaveText(date);
        await expect(hero.locator("time")).toHaveAttribute("datetime", "2026-09-07");
        await expect(hero.locator("p").last()).toHaveText(description);
        await expect(hero.getByRole("link", { name: action.label })).toBeVisible();
        if (withByline) await expect(hero.locator("p").first()).toHaveText(byline);

        const geometry = await hero.evaluate((figure) => {
          const rect = (element: Element) => {
            const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
            return { x, y, width, height, bottom, right };
          };
          const heading = figure.querySelector("h1")!;
          // Parent of the constrained text column owns the contrast surface.
          const surface = heading.parentElement!.parentElement!;
          // Normalize CSS Color 4 serialization through the browser's canvas,
          // then measure actual compositing over a worst-case white photograph.
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          const background = getComputedStyle(surface).backgroundColor;
          // Composite the given layers, bottom to top, over the white frame.
          const composite = (...layers: string[]) => {
            context.fillStyle = "white";
            context.fillRect(0, 0, 1, 1);
            for (const layer of [background, ...layers]) {
              context.fillStyle = layer;
              context.fillRect(0, 0, 1, 1);
            }
            return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const luminance = (...layers: string[]) => {
            const rgb = composite(...layers).map((v) => {
              const s = v / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const contrast = (a: number, b: number) =>
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const surfaceLuminance = luminance();
          // Text on the surface itself is measured against the surface; the
          // CTA carries its own background, so it is measured against that.
          const textContrast = (el: Element) => {
            const { color, backgroundColor } = getComputedStyle(el);
            const own = el.tagName === "A" ? [backgroundColor] : [];
            return contrast(luminance(...own, color), own.length ? luminance(...own) : surfaceLuminance);
          };
          return {
            figure: rect(figure),
            image: rect(figure.querySelector("img")!),
            surface: rect(surface),
            surfaceOverWhite: composite(),
            texts: [...figure.querySelectorAll("h1, p, time, a")].map((el) => ({
              ...rect(el),
              contrast: textContrast(el),
              scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
            })),
            header: rect(document.querySelector("header")!),
            following: rect(document.querySelector("[data-following-content]")!),
            documentWidth: document.documentElement.scrollWidth,
          };
        });
        for (const text of geometry.texts) {
          expect(text.y).toBeGreaterThanOrEqual(geometry.surface.y);
          expect(text.y).toBeGreaterThanOrEqual(geometry.header.bottom);
          expect(text.bottom).toBeLessThanOrEqual(geometry.surface.bottom + 1);
          expect(text.x).toBeGreaterThanOrEqual(geometry.surface.x);
          expect(text.right).toBeLessThanOrEqual(geometry.surface.right + 1);
          expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight + 1);
          expect(text.contrast).toBeGreaterThanOrEqual(4.5);
        }
        // AB#171: a veil the photograph shows through, not the old 80%-black
        // bar (#333 over white). 60% black over white composites to #666.
        expect(geometry.surfaceOverWhite[0]).toBeGreaterThan(0x55);
        expect(geometry.image.width).toBe(390);
        expect(geometry.image.height).toBeCloseTo(390 * height / 1600, 1);
        expect(geometry.image.y).toBe(geometry.figure.y);
        expect(geometry.following.y).toBeGreaterThanOrEqual(geometry.surface.bottom);
        expect(geometry.following.y).toBeGreaterThanOrEqual(geometry.image.bottom);
        expect(geometry.documentWidth).toBe(390);
        await test.info().attach("hero-geometry", {
          body: JSON.stringify(geometry, null, 2), contentType: "application/json",
        });
        if (height === 900 && withByline) {
          await test.info().attach("long-hero", {
            body: await page.screenshot(), contentType: "image/png",
          });
        }
      });
    }
  }
});

// AB#171: the surface must read as laid over the photograph. At a desktop
// size with short copy there is photograph above and below the surface, so
// both feathered edges are measured in real pixels over a pure-white frame:
// no hard edge at the top, none at the bottom, and the photograph untouched
// beyond them.
test.describe("AB#171: hero text surface fades into the photograph", () => {
  test.use({ javaScriptEnabled: false });

  test("short copy at 1920×1080 over a pale 16:9 cover", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const src = "/gallery/hero-feather.abcdef123456.webp";
    const media = projectPublicImageMedia({
      mediaId: "hero-feather-test",
      publiclyRenderable: true,
      rendition: {
        src, version: "abcdef123456", width: 1600, height: 900,
        sourceKind: "public-web-derivative",
      },
      alt: "White test frame",
    });
    await page.route("**/_next/image?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("url") !== src) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="100%" height="100%" fill="white"/></svg>',
      });
    });
    await page.goto("/", { waitUntil: "load" });
    const markup = renderToStaticMarkup(createElement(HeroOverlay, {
      media, title: "Coastal light",
      meta: { dateTime: "2026-09-07", label: date },
    }));
    await page.getByRole("main").evaluate((main, html) => {
      main.innerHTML = html;
    }, markup);
    await page.evaluate(() => document.fonts.ready);
    const hero = page.locator("main > figure");
    await expect.poll(() => hero.getByRole("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    const geometry = await hero.evaluate((figure) => {
      const surface = figure.querySelector("h1")!.parentElement!.parentElement!;
      const spacer = surface.nextElementSibling!;
      const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
      const bottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY;
      return {
        figureTop: top(figure),
        imageBottom: bottom(figure.querySelector("img")!),
        surfaceTop: top(surface),
        surfaceBottom: bottom(surface),
        spacerBottom: bottom(spacer),
        fadeHeight: parseFloat(getComputedStyle(surface, "::before").height),
      };
    });
    // The whole top fade lies over the photograph, and the band ends inside it.
    expect(geometry.fadeHeight).toBeGreaterThan(0);
    expect(geometry.surfaceTop - geometry.fadeHeight).toBeGreaterThanOrEqual(geometry.figureTop);
    expect(geometry.spacerBottom - geometry.surfaceBottom).toBeGreaterThan(0);
    expect(geometry.imageBottom - geometry.spacerBottom).toBeGreaterThan(20);

    // Sample a column at the left edge, clear of the centred text.
    const { data, info } = await sharp(await page.screenshot({ fullPage: true, scale: "css" }))
      .raw().toBuffer({ resolveWithObject: true });
    const red = (y: number) => data[(Math.round(y) * info.width + 4) * info.channels];
    const veil = red(geometry.surfaceTop + 4);
    expect(Math.abs(veil - 0x66)).toBeLessThanOrEqual(4);
    // Top edge: photograph above the fade, a soft ramp, no seam into the veil.
    expect(red(geometry.surfaceTop - geometry.fadeHeight - 4)).toBeGreaterThanOrEqual(250);
    const midTop = red(geometry.surfaceTop - geometry.fadeHeight / 2);
    expect(midTop).toBeGreaterThan(veil + 20);
    expect(midTop).toBeLessThan(245);
    expect(Math.abs(red(geometry.surfaceTop - 1) - veil)).toBeLessThanOrEqual(6);
    // Bottom edge: the same, mirrored, back to the untouched photograph.
    expect(Math.abs(red(geometry.surfaceBottom + 1) - veil)).toBeLessThanOrEqual(6);
    const midBottom = red((geometry.surfaceBottom + geometry.spacerBottom) / 2);
    expect(midBottom).toBeGreaterThan(veil + 20);
    expect(midBottom).toBeLessThan(245);
    expect(red(geometry.spacerBottom + 4)).toBeGreaterThanOrEqual(250);
  });
});

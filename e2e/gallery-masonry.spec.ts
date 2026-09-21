import type { Locator, Page } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import { galleryItems, STORY_ROOT } from "./support/gallery";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { openLightbox } from "./support/lightbox";

/**
 * The order-preserving masonry (AB#157), measured in a real browser.
 *
 * Four things have to hold together, and each is asserted here rather than
 * assumed from the placement proof in `gallery-masonry.test.ts`:
 *
 * 1. **Progression.** Items read by top edge; tops within a pixel read left to
 *    right. That order is the DOM order, the keyboard order, and the lightbox
 *    sequence — at every column band, including right at its thresholds.
 * 2. **Append stability.** At an unchanged viewport width, appending a slice
 *    leaves every photograph already placed at the same position and size.
 * 3. **Long captions**, in both placements: contained, clamped, revealed on
 *    focus without moving anything.
 * 4. **No JavaScript**: the server render is already laid out.
 *
 * Items are identified by the result identity the grid carries, never by alt
 * text or caption: the fixture reuses six photographs across thirty placements.
 */

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const galleryLabels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).gallery;

const MASONRY_GALLERIES = [
  { contentId: "content-masonry-below", captionPlacement: "below" },
  { contentId: "content-masonry-overlay", captionPlacement: "overlay" },
] as const;

/** Viewports either side of each container threshold, plus ordinary sizes. */
const VIEWPORT_WIDTHS = [390, 575, 576, 800, 943, 944, 1280] as const;

/** One CSS pixel: the tie tolerance the progression rule is defined with. */
const TIE_PX = 1;
/** Sub-pixel slack for comparing two layouts of the same geometry. */
const SAME_PX = 0.5;

type Rect = { top: number; left: number; bottom: number; right: number };

type MeasuredItem = {
  itemId: string;
  /** Hovered or holding focus: its caption is deliberately shown in full. */
  revealed: boolean;
  box: Rect;
  image: Rect;
  caption:
    | (Rect & {
        /** The visible text is cut short: more lines exist than are shown. */
        overflowsVertically: boolean;
        overflowsHorizontally: boolean;
        /**
         * The element that clips the text, measured: its padding and height.
         * WebKit paints the lines after a clamp and clips them only at the
         * padding edge, so a clip inside padding shows the top of the next
         * line. Pixel output is not measurable here; this structure is.
         */
        clipPaddingPx: number;
        clipHeightPx: number;
        lineHeightPx: number;
      })
    | null;
};

async function galleryPath(contentId: string): Promise<string> {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) throw new Error(`[e2e] no mock tree for ${language}`);
  const path = getCanonicalContentPath(buildContentTree(treeInput), contentId);
  if (path === null) throw new Error(`[e2e] ${contentId} has no canonical path`);
  return `${STORY_ROOT}/${path.join("/")}`;
}

async function firstPageItemIds(contentId: string): Promise<string[]> {
  const result = await getMockGalleryResult(language, contentId, {
    cursorCodec: harnessCursorCodec,
  });
  if (result === undefined || !result.page.hasNextPage) {
    throw new Error(`[e2e] ${contentId} must be longer than one page`);
  }
  return result.items.map((item) => item.itemId);
}

/** Every item's geometry, relative to the list, plus the list's own size. */
async function measure(main: Locator): Promise<{
  items: MeasuredItem[];
  listWidth: number;
  listHeight: number;
}> {
  return galleryItems(main).evaluateAll((elements) => {
    const list = elements[0].parentElement!.getBoundingClientRect();
    const relative = (rect: DOMRect) => ({
      top: rect.top - list.top,
      left: rect.left - list.left,
      bottom: rect.bottom - list.top,
      right: rect.right - list.left,
    });

    return {
      listWidth: list.width,
      listHeight: list.height,
      items: elements.map((element) => {
        const caption = element.querySelector("figcaption");
        const text = caption?.firstElementChild ?? null;
        return {
          itemId: element.querySelector("[data-item-id]")?.getAttribute("data-item-id") ?? "",
          revealed: element.matches(":hover, :focus-within"),
          box: relative(element.getBoundingClientRect()),
          image: relative(element.querySelector("img")!.getBoundingClientRect()),
          caption:
            caption === null
              ? null
              : {
                  ...relative(caption.getBoundingClientRect()),
                  overflowsVertically:
                    caption.scrollHeight > caption.clientHeight + 1 ||
                    (text !== null && text.scrollHeight > text.clientHeight + 1),
                  overflowsHorizontally:
                    caption.scrollWidth > caption.clientWidth + 1 ||
                    (text !== null && text.scrollWidth > text.clientWidth + 1),
                  clipPaddingPx:
                    text === null
                      ? Number.NaN
                      : ["paddingTop", "paddingBottom"].reduce(
                          (sum, side) =>
                            sum +
                            Number.parseFloat(
                              getComputedStyle(text)[side as "paddingTop" | "paddingBottom"],
                            ),
                          0,
                        ),
                  clipHeightPx: text?.clientHeight ?? Number.NaN,
                  lineHeightPx: Number.parseFloat(getComputedStyle(caption).lineHeight),
                },
        };
      }),
    };
  });
}

/** How many columns the masonry's own container thresholds give this list width. */
function expectedColumns(listWidthPx: number): number {
  const rem = listWidthPx / 16;
  if (rem >= 56) return 3;
  if (rem >= 34) return 2;
  return 1;
}

/** Every consecutive pair that does not read in DOM order. */
function progressionBreaks(items: readonly MeasuredItem[]): string[] {
  const breaks: string[] = [];
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1].box;
    const current = items[index].box;
    const delta = current.top - previous.top;
    const readsNext =
      delta > TIE_PX || (Math.abs(delta) <= TIE_PX && current.left > previous.left + TIE_PX);
    if (!readsNext) {
      breaks.push(
        `item ${index} (${items[index].itemId}) top ${current.top.toFixed(2)} left ${current.left.toFixed(2)} after top ${previous.top.toFixed(2)} left ${previous.left.toFixed(2)}`,
      );
    }
  }
  return breaks;
}

function intersects(first: Rect, second: Rect): boolean {
  return (
    first.left < second.right - SAME_PX &&
    second.left < first.right - SAME_PX &&
    first.top < second.bottom - SAME_PX &&
    second.top < first.bottom - SAME_PX
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.top >= outer.top - SAME_PX &&
    inner.left >= outer.left - SAME_PX &&
    inner.bottom <= outer.bottom + SAME_PX &&
    inner.right <= outer.right + SAME_PX
  );
}

/** The layout-level guarantees every measured masonry must satisfy. */
function expectSoundLayout(
  measured: Awaited<ReturnType<typeof measure>>,
  _captionPlacement: "below" | "overlay",
  context: string,
): void {
  const { items, listWidth, listHeight } = measured;

  expect(progressionBreaks(items), `progression ${context}`).toEqual([]);

  expect(
    new Set(items.map((item) => Math.round(item.box.left))).size,
    `column count ${context}`,
  ).toBe(expectedColumns(listWidth));

  const overlaps: string[] = [];
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      if (intersects(items[first].box, items[second].box)) {
        overlaps.push(`${items[first].itemId} / ${items[second].itemId}`);
      }
    }
  }
  expect(overlaps, `overlapping items ${context}`).toEqual([]);

  for (const item of items) {
    // The list encloses its items, so nothing after it can sit on top of them.
    expect(item.box.bottom, `${item.itemId} inside the list ${context}`).toBeLessThanOrEqual(
      listHeight + SAME_PX,
    );
    expect(contains(item.box, item.image), `${item.itemId} image inside its item ${context}`).toBe(
      true,
    );

    if (item.caption === null) continue;
    expect(item.revealed || contains(item.box, item.caption), `${item.itemId} caption contained ${context}`).toBe(
      true,
    );
    // A clamped box is exactly two lines plus padding, whatever it says. A revealed
    // one is allowed to grow, within its own item (asserted above).
    if (!item.revealed) {
      expect(
        item.caption.bottom - item.caption.top,
        `${item.itemId} caption clamped ${context}`,
      ).toBeLessThanOrEqual(56 + SAME_PX);
      // The clip edge is the content edge, at a whole number of lines — so no
      // engine can show part of the line after the clamp.
      expect(item.caption.clipPaddingPx, `${item.itemId} clip has no padding ${context}`).toBe(0);
      const lines = item.caption.clipHeightPx / item.caption.lineHeightPx;
      expect(
        Math.abs(lines - Math.round(lines)),
        `${item.itemId} clip ends on a line boundary ${context}`,
      ).toBeLessThan(0.05);
    }
    expect(item.caption.overflowsHorizontally, `${item.itemId} caption wraps ${context}`).toBe(
      false,
    );
  }
}

async function openAtWidth(page: Page, path: string, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const main = page.getByRole("main");
  await expect(galleryItems(main).first()).toBeVisible();
  return main;
}

for (const { contentId, captionPlacement } of MASONRY_GALLERIES) {
  test.describe(`masonry, captions ${captionPlacement}`, () => {
    let path: string;
    let expectedIds: string[];

    test.beforeAll(async () => {
      path = await galleryPath(contentId);
      expectedIds = await firstPageItemIds(contentId);
    });

    for (const javaScriptEnabled of [true, false]) {
      test.describe(javaScriptEnabled ? "with JavaScript" : "without JavaScript", () => {
        test.use({ javaScriptEnabled });

        test("reads in result order at every column band", async ({ page }) => {
          for (const width of VIEWPORT_WIDTHS) {
            const main = await openAtWidth(page, path, width);
            const measured = await measure(main);

            expect(
              measured.items.map((item) => item.itemId),
              `DOM order at ${width}px`,
            ).toEqual(expectedIds);
            expectSoundLayout(measured, captionPlacement, `at ${width}px`);
          }
        });
      });
    }

    test.describe("without JavaScript", () => {
      test.use({ javaScriptEnabled: false });

      test("the continuation page is laid out on its own", async ({ page }) => {
        const main = await openAtWidth(page, path, 1280);
        await main.locator('a[rel="next"]').click();
        await expect(page).toHaveURL(/[?&]cursor=/);
        await expect(galleryItems(main).first()).toBeVisible();
        expectSoundLayout(await measure(main), captionPlacement, "on the continuation page");
      });

      test("a long caption opens natively without script or moving images", async ({
        page,
      }) => {
        const main = await openAtWidth(page, path, 1280);
        const before = await measure(main);
        const clampedIndex = before.items.findIndex(
          (item) => item.caption?.overflowsVertically === true,
        );
        expect(clampedIndex, "the fixture needs a caption longer than two lines").toBeGreaterThan(
          -1,
        );

        const trigger = galleryItems(main).nth(clampedIndex).locator("[data-item-id]");
        await trigger.click();
        const popover = page.getByRole("dialog");
        await expect(popover).toBeVisible();
        await expect(popover.locator("p")).toHaveText(await galleryItems(main).nth(clampedIndex).locator("figcaption").innerText());
        expect(await popover.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.keyboard.press("Escape");
        await expect(popover).toHaveCount(0);

        const after = await measure(main);
        for (const [index, item] of after.items.entries()) {
          expect(item.box, `${item.itemId} did not move`).toEqual(before.items[index].box);
        }


      });
    });

    test.describe("with JavaScript", () => {
      test.use({ javaScriptEnabled: true });

      for (const width of [1280, 800, 390] as const) {
        test(`an append at ${width}px keeps every placed photograph where it was`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path, { waitUntil: "domcontentloaded" });
          const main = page.getByRole("main");
          await expect(galleryItems(main)).toHaveCount(expectedIds.length);

          const before = await measure(main);
          await page.getByRole("link", { name: galleryLabels.showMore }).click();
          await expect(galleryItems(main)).toHaveCount(30);
          // A tap leaves :hover wherever the control was — now over an appended
          // item on a touch profile. Hover never moves geometry, but moving the
          // pointer away keeps the clamp assertions about the resting state.
          await page.mouse.move(0, 0);
          const after = await measure(main);

          const moved: string[] = [];
          for (const [index, placed] of before.items.entries()) {
            const now = after.items[index];
            expect(now.itemId).toBe(placed.itemId);
            for (const [name, rect, previous] of [
              ["box", now.box, placed.box],
              ["image", now.image, placed.image],
            ] as const) {
              for (const edge of ["top", "left", "bottom", "right"] as const) {
                if (Math.abs(rect[edge] - previous[edge]) > SAME_PX) {
                  moved.push(`${placed.itemId} ${name}.${edge} ${previous[edge]} -> ${rect[edge]}`);
                }
              }
            }
          }
          expect(moved, "photographs already on screen moved").toEqual([]);
          expectSoundLayout(after, captionPlacement, `after the append at ${width}px`);
        });
      }

      test("the lightbox and the keyboard follow the same order", async ({
        page,
        browserName,
      }) => {
        const main = await openAtWidth(page, path, 1280);
        const triggers = main.locator("[data-item-id]");
        const focusedItemId = () =>
          page.evaluate(() => document.activeElement?.getAttribute("data-item-id") ?? null);

        if (browserName === "chromium") {
          await triggers.first().focus();
          for (let index = 1; index <= 6; index += 1) {
            await page.keyboard.press("Tab");
            await expect.poll(focusedItemId).toBe(expectedIds[index]);
          }
        }

        // The viewer walks its own sequence; closing returns focus to the trigger of
        // the slide on screen, which names where that sequence actually arrived.
        const dialog = page.getByRole("dialog");
        await openLightbox(dialog, () => triggers.first().click());
        const steps = 7;
        for (let step = 0; step < steps; step += 1) {
          await page.keyboard.press("ArrowRight");
        }
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect.poll(focusedItemId).toBe(expectedIds[steps]);
      });
    });
  });
}

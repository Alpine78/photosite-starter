import { test, expect } from "./support/fixtures";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";

const codec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);
const variants = [
  { id: "large-archive", nativeCaptions: false },
  { id: "grid-overlay", nativeCaptions: true },
  { id: "masonry-below", nativeCaptions: true },
  { id: "masonry-overlay", nativeCaptions: true },
  { id: "justified-below", nativeCaptions: false },
  { id: "justified-overlay", nativeCaptions: true },
] as const;

test.describe("honest curated controls without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const language of ["en", "fi"]) for (const fixture of variants) {
    test(`${language} ${fixture.id}: only actual native caption actions enter the keyboard sequence`, async ({ page }) => {
      const tree = buildContentTree(mockContentTreeInputs[language]);
      const parts = getCanonicalContentPath(tree, `content-${fixture.id}`);
      if (!parts) throw new Error(`Missing ${language} gallery ${fixture.id}`);
      const root = language === "fi" ? `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` : `/${DEFAULT_STORY_NAMESPACE}`;
      const expected = await getMockGalleryResult(language, `content-${fixture.id}`, { cursorCodec: codec });
      if (!expected) throw new Error("Missing first-page gallery result");
      const nativeIds = expected.items.filter(item => fixture.nativeCaptions && item.media.caption).map(item => item.itemId);
      const passiveIds = expected.items.filter(item => !nativeIds.includes(item.itemId)).map(item => item.itemId);
      expect(passiveIds.length, "the first page must exercise a genuinely passive photograph").toBeGreaterThan(0);
      if (fixture.nativeCaptions) expect(nativeIds.length).toBeGreaterThan(0);

      await page.goto(`${root}/${parts.join("/")}`, { waitUntil: "domcontentloaded" });
      const gallery = page.getByRole("main").locator("#gallery");
      const occurrences = gallery.locator("[data-item-id]");
      await expect(occurrences).toHaveCount(24);
      expect(await occurrences.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-item-id")))).toEqual(expected.items.map(item => item.itemId));

      // The continuation link is after the complete curated list. Walk backward
      // using real browser keyboard input, so a passive image cannot quietly
      // remain a tab stop even if its visible presentation looks unchanged.
      const nextPage = page.getByRole("main").locator('a[rel="next"]');
      await nextPage.focus();
      await expect(nextPage).toBeFocused();
      const visited: string[] = [];
      for (let index = 0; index <= nativeIds.length; index += 1) {
        await page.keyboard.press("Shift+Tab");
        const activeId = await page.evaluate(() => document.activeElement?.getAttribute("data-item-id") ?? null);
        expect(passiveIds).not.toContain(activeId);
        if (activeId !== null) visited.push(activeId);
        if (index === 0 && nativeIds.length > 0) {
          const focused = gallery.locator(`[data-item-id="${activeId}"]`);
          const target = await focused.getAttribute("popovertarget");
          expect(target).toBeTruthy();
          const caption = page.getByRole("dialog");
          const fullText = await focused.locator("..").locator("figcaption").textContent();
          await page.keyboard.press("Enter");
          await expect(caption).toBeVisible();
          await expect(caption.locator("p")).toHaveText(fullText!);
          await page.keyboard.press("Escape");
          await expect(caption).toBeHidden();
          await expect(focused).toBeFocused();
        }
      }
      expect(visited).toEqual([...nativeIds].reverse());
      for (const itemId of passiveIds) {
        const occurrence = gallery.locator(`[data-item-id="${itemId}"]`);
        expect(await occurrence.evaluate(node => ({
          tag: node.tagName, tabIndex: node.getAttribute("tabindex"),
          role: node.getAttribute("role"), promise: node.getAttribute("aria-haspopup"),
          cursor: getComputedStyle(node).cursor,
        }))).toEqual({ tag: "DIV", tabIndex: null, role: null, promise: null, cursor: "auto" });
        await expect(occurrence.locator("img")).toHaveCount(1);
      }
      await expect(gallery.locator("button[data-item-id]")).toHaveCount(nativeIds.length);

    });
  }
});

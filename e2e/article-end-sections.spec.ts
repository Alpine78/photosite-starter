import { test, expect } from "./support/fixtures";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { FILTER_ARTICLE_ID } from "../src/lib/mock-article-end-sections";
import { listContentHeadings } from "../src/lib/content-headings";
import { READING_POSITIONS_KEY } from "../src/lib/reading-position-store";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
} from "./support/harness-environment";
import { openLightbox } from "./support/lightbox";
const fixtures = [
  {
    locale: appUnderTestEnvironment.SITE_LOCALE,
    prefix: "",
    namespace: DEFAULT_STORY_NAMESPACE,
  },
  {
    locale: PREFIXED_LOCALE.prefix,
    prefix: `/${PREFIXED_LOCALE.prefix}`,
    namespace: PREFIXED_LOCALE.storyNamespace,
  },
].map(({ locale, prefix, namespace }) => {
  const language = new Intl.Locale(locale).language;
  const content = mockContentPages[language].get(FILTER_ARTICLE_ID)!;
  if (content.variant !== "article" || !content.endGallerySections?.length)
    throw new Error("Sectioned article fixture missing");
  const parts = getCanonicalContentPath(
    buildContentTree(mockContentTreeInputs[language]),
    FILTER_ARTICLE_ID,
  )!;
  return {
    locale,
    path: `${prefix}/${namespace}/${parts.join("/")}`,
    content,
    labels: getBuiltInLabels(locale),
    sections: content.endGallerySections,
  };
});
for (const f of fixtures) {
  test(`${f.locale}: selected source, append, viewer, result status and indexing remain scoped`, async ({
    page,
  }) => {
    const [selected] = f.sections;
    // Supported older Safari lacks this getter; exercise real hydrated links.
    await page.addInitScript(() => {
      Reflect.deleteProperty(URLSearchParams.prototype, "size");
    });
    await page.goto(`${f.path}?section=${selected.slug}&keep=one&keep=two`);
    const gallery = page.locator("[data-article-end-gallery]");
    const controls = gallery.getByRole("navigation", {
      name: f.content.endGallerySectionHeading,
      exact: true,
    });
    const triggers = gallery.locator("button[data-item-id]");
    await expect(triggers).toHaveCount(24);
    await expect(controls.getByRole("link", { name: f.labels.gallery.allSections, exact: true }))
      .toHaveAttribute("href", `${f.path}?keep=one&keep=two`);
    await expect(controls.getByRole("link", { name: f.sections[1].label, exact: true }))
      .toHaveAttribute("href", `${f.path}?section=${f.sections[1].slug}&keep=one&keep=two`);
    await expect(triggers.last()).toHaveAttribute(
      "data-item-id",
      "image-note-27",
    );
    await expect(
      controls.getByRole("link", { name: selected.label, exact: true }),
    ).toHaveAttribute("aria-current", "true");
    await expect(controls.getByRole("status")).toContainText(
      f.labels.gallery.loadedSummary.replace("{count}", "24"),
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${f.path}$`),
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      new RegExp(`${f.path}$`),
    );
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    const more = gallery.getByRole("link", {
      name: f.labels.gallery.showMore,
      exact: true,
    });
    const request = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/article-gallery",
    );
    await more.click();
    expect(new URL((await request).url()).searchParams.get("section")).toBe(
      selected.slug,
    );
    await expect(triggers).toHaveCount(27);
    await expect(controls.getByRole("status")).toContainText(
      f.labels.gallery.loadedSummary.replace("{count}", "27"),
    );
    await expect(controls.getByRole("status")).toContainText(
      f.labels.gallery.sectionAllLoaded,
    );
    expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
    const dialog = page.getByRole("dialog", { name: f.labels.lightbox.viewer });
    await openLightbox(dialog, () => triggers.first().click());
    await expect(
      dialog.getByText(`1${f.labels.lightbox.indexSeparator}27`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // Body images keep independent groups even though the ending is selected.
    const standalone = page
      .locator("[data-content-body] button[data-item-id]")
      .first();
    await openLightbox(dialog, () => standalone.click());
    await expect(dialog.locator(".pswp__counter")).toBeHidden();
    await page.keyboard.press("Escape");
    for (const image of await gallery.locator("img").all()) {
      expect(
        await image.evaluate((el) => getComputedStyle(el).objectFit),
      ).not.toBe("cover");
    }
  });
  test(`${f.locale}: keyboard filters preserve unrelated query, current reading hash and viewport`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${f.path}?keep=one&keep=two`);
    const heading = listContentHeadings(f.content.body).find(
      (x) => x.level === 4,
    )!;
    await page
      .locator(`[id='${heading.id}']`)
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.keyboard.press("ArrowDown");
    // The reading-chapter tracker can publish an intermediate chapter before it
    // settles (CI-load trace, AB#377: "-1" first, then "-5" at an unchanged
    // viewport). Snapshot only once the reading contents mark a current chapter
    // and the URL hash matches its link, so the assertion below is about the
    // filter change, not the tracker settling.
    const currentChapter = page
      .getByRole("link", { includeHidden: true })
      .filter({ has: page.locator('[aria-current="location"]') })
      .first();
    await expect.poll(async () => {
      // No current chapter yet is "not settled", not a reason to block this poll.
      const href = await currentChapter.getAttribute("href", { timeout: 500 }).catch(() => null);
      return href !== null && new URL(page.url()).hash === href;
    }).toBe(true);
    const hash = new URL(page.url()).hash;
    const controls = page.locator("[data-article-section-controls]");
    const target = controls.getByRole("link", {
      name: f.sections[1].label,
      exact: true,
    });
    await expect(target).toHaveAttribute("href", new RegExp(`${hash}$`));
    await target.focus();
    await expect(controls).toHaveClass(/translate-y-0/);
    const before = (await controls.boundingBox())!.y;
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`section=${f.sections[1].slug}`));
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(2);
    await expect(target).toBeFocused();
    expect(new URL(page.url()).hash).toBe(hash);
    expect(new URL(page.url()).searchParams.getAll("keep")).toEqual([
      "one",
      "two",
    ]);
    expect(Math.abs((await controls.boundingBox())!.y - before)).toBeLessThan(
      5,
    );
    await controls
      .getByRole("link", { name: f.sections[2].label, exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(controls.getByRole("status")).toHaveText(
      `${f.sections[2].label}. ${f.labels.gallery.emptySection} ${f.labels.gallery.sectionAllLoaded}`,
    );
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(0);
    await page.goBack();
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(2);
  });
  test.describe(`${f.locale} without JavaScript`, () => {
    test.use({ javaScriptEnabled: false });
    test("real selector and continuation links work with exact selected membership", async ({
      page,
    }) => {
      await page.goto(`${f.path}?keep=1&keep=2`);
      const controls = page.locator("[data-article-section-controls]");
      await controls
        .getByRole("link", { name: f.sections[0].label, exact: true })
        .click();
      await expect(page.locator("[data-article-end-gallery] img")).toHaveCount(
        24,
      );
      await page
        .locator("[data-article-end-gallery]")
        .getByRole("link", { name: f.labels.gallery.showMore })
        .click();
      await expect(page.locator("[data-article-end-gallery] img")).toHaveCount(
        3,
      );
      await expect(page.locator("[data-content-body]")).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await expect(page.locator("link[hreflang]")).toHaveCount(0);
      await controls
        .getByRole("link", { name: f.sections[1].label, exact: true })
        .click();
      await expect(page.locator("[data-article-end-gallery] img")).toHaveCount(
        2,
      );
      expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
      await controls
        .getByRole("link", { name: f.labels.gallery.allSections, exact: true })
        .click();
      await expect(page.locator("link[hreflang]")).not.toHaveCount(0);
      await expect(
        page.locator('meta[name="robots"][content*="noindex"]'),
      ).toHaveCount(0);
    });
  });
  test(`${f.locale}: invalid selectors never normalize and API cursor scopes never widen`, async ({
    page,
    request,
  }) => {
    for (const suffix of [
      "?section=missing",
      "?section=a&section=b",
      "?section=UPPER",
    ]) {
      const response = await request.get(f.path.toUpperCase() + suffix, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(404);
      expect(response.headers().location).toBeUndefined();
    }
    await page.goto(f.path);
    const next = page
      .locator("[data-article-end-gallery]")
      .getByRole("link", { name: f.labels.gallery.showMore });
    const allCursor = new URL(
      (await next.getAttribute("href"))!,
      page.url(),
    ).searchParams.get("cursor")!;
    await page.goto(`${f.path}?section=${f.sections[0].slug}`);
    const selectedCursor = new URL(
      (await next.getAttribute("href"))!,
      page.url(),
    ).searchParams.get("cursor")!;
    for (const [cursor, section] of [
      [allCursor, f.sections[0].slug],
      [selectedCursor, undefined],
    ] as const) {
      const params = new URLSearchParams({ path: f.path, cursor });
      if (section) params.set("section", section);
      const response = await request.get(`/api/article-gallery?${params}`);
      expect(response.status()).toBe(404);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
    const crossOrigin = await request.get(
      `/api/article-gallery?${new URLSearchParams({ path: f.path, cursor: allCursor })}`,
      { headers: { origin: "https://outside.example" } },
    );
    expect(crossOrigin.status()).toBe(403);
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).not.toContain("section=");
  });
}
const f = fixtures[0];
test("continuation-to-initial replacement preserves the controls over a saved reading position", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${f.path}?section=${f.sections[0].slug}`);
  const next = (await page
    .locator("[data-article-end-gallery]")
    .getByRole("link", { name: f.labels.gallery.showMore })
    .getAttribute("href"))!;
  const saved = JSON.stringify([
    {
      contentId: FILTER_ARTICLE_ID,
      locale: f.locale,
      headingId: listContentHeadings(f.content.body).find(
        (heading) => heading.level === 4,
      )!.id,
      savedAt: Date.now(),
    },
  ]);
  await page.evaluate(({ key, saved }) => localStorage.setItem(key, saved), {
    key: READING_POSITIONS_KEY,
    saved,
  });
  await page.goto(next);
  const controls = page.locator("[data-article-section-controls]");
  const all = controls.getByRole("link", {
    name: f.labels.gallery.allSections,
    exact: true,
  });
  await all.focus();
  await controls.evaluate((el) =>
    el.setAttribute("data-original-instance", "yes"),
  );
  const before = (await controls.boundingBox())!.y;
  const stateKeys = await page.evaluate(() =>
    Object.keys(history.state).sort(),
  );
  const session = await page.evaluate(() =>
    JSON.stringify(Object.entries(sessionStorage)),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-content-body]")).toHaveCount(1);
  await expect(
    page.locator("[data-article-end-gallery] button[data-item-id]"),
  ).toHaveCount(24);
  await expect(controls).not.toHaveAttribute("data-original-instance", "yes");
  await expect(all).toBeFocused();
  expect(Math.abs((await controls.boundingBox())!.y - before)).toBeLessThan(5);
  expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
  expect(new URL(page.url()).hash).toBe("");
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      READING_POSITIONS_KEY,
    ),
  ).toBe(saved);
  expect(
    await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage))),
  ).toBe(session);
  expect(await page.evaluate(() => Object.keys(history.state).sort())).toEqual(
    stateKeys,
  );
});

test("a late append cannot alter the newly selected grid or focus", async ({
  page,
}) => {
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hit = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route("**/api/article-gallery?**", async (route) => {
    received();
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(`${f.path}?section=${f.sections[0].slug}`);
    await page
      .locator("[data-article-end-gallery]")
      .getByRole("link", { name: f.labels.gallery.showMore })
      .click();
    await hit;
    const target = page
      .locator("[data-article-section-controls]")
      .getByRole("link", { name: f.sections[1].label, exact: true });
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(2);
    release();
    await expect(target).toBeFocused();
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(2);
  } finally {
    release();
  }
});

test("rapid delayed server selections settle on the final intent", async ({
  page,
}) => {
  let release!: () => void,
    received!: () => void,
    blocked = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hit = new Promise<void>((resolve) => {
    received = resolve;
  });
  try {
    await page.goto(f.path);
    await page.route(
      (url) => url.pathname === f.path && url.searchParams.has("_rsc"),
      async (route) => {
        const url = new URL(route.request().url());
        if (
          !blocked &&
          url.searchParams.get("section") === f.sections[0].slug
        ) {
          blocked = true;
          received();
          await gate;
        }
        await route.continue().catch(() => {});
      },
    );
    const controls = page.locator("[data-article-section-controls]");
    const a = controls.getByRole("link", {
      name: f.sections[0].label,
      exact: true,
    });
    const b = controls.getByRole("link", {
      name: f.sections[1].label,
      exact: true,
    });
    await a.focus();
    await page.keyboard.press("Enter");
    await hit;
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(2);
    release();
    await a.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`section=${f.sections[0].slug}`));
    await expect(
      page.locator("[data-article-end-gallery] button[data-item-id]"),
    ).toHaveCount(24);
    await expect(a).toBeFocused();
  } finally {
    release();
  }
});

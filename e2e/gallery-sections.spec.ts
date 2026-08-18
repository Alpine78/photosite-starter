import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import type { GallerySectionSummary } from "../src/lib/gallery-sections";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The gallery section journey: AB#115's URL-driven, accessible section
 * controls composed with the shared grid, pagination, and lightbox.
 *
 * Fixture properties are discovered rather than named, the same way
 * `gallery-continuation.spec.ts` finds its paginated gallery: a clone
 * authors its own galleries and section labels, so what this suite depends
 * on is "a gallery with a multi-page section and an empty one", not which
 * fixture currently has that shape.
 */

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

async function mockPage(
  language: string,
  contentId: string,
  sectionSlug?: string,
) {
  return getMockGalleryResult(language, contentId, {
    ...(sectionSlug === undefined ? {} : { sectionSlug }),
    cursorCodec: harnessCursorCodec,
  });
}

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const galleryLabels = labels.gallery;

type SectionedGallery = {
  readonly contentId: string;
  readonly path: string;
  readonly pageSize: number;
  readonly multiPageSection: GallerySectionSummary;
  readonly emptySection: GallerySectionSummary;
};

async function sectionedDefaultLocaleGallery(): Promise<SectionedGallery> {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await mockPage(language, contentId);
    if (path === null || result === undefined || result.sections.length === 0) {
      continue;
    }

    let multiPageSection: GallerySectionSummary | undefined;
    let emptySection: GallerySectionSummary | undefined;
    for (const section of result.sections) {
      const sectionResult = await mockPage(language, contentId, section.slug);
      if (sectionResult === undefined) continue;
      if (sectionResult.items.length === 0) {
        emptySection ??= section;
      } else if (sectionResult.page.hasNextPage) {
        multiPageSection ??= section;
      }
    }

    if (multiPageSection !== undefined && emptySection !== undefined) {
      return {
        contentId,
        path: `${STORY_ROOT}/${path.join("/")}`,
        pageSize: result.page.size,
        multiPageSection,
        emptySection,
      };
    }
  }

  throw new Error(
    "[e2e] The harness needs one gallery with a multi-page section and an empty one.",
  );
}

/** A published gallery with no declared sections, for the "no controls" case. */
async function unsectionedDefaultLocaleGallery(): Promise<string> {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(treeInput);
  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await mockPage(language, contentId);
    if (path !== null && result !== undefined && result.sections.length === 0) {
      return `${STORY_ROOT}/${path.join("/")}`;
    }
  }

  throw new Error("[e2e] The harness needs one gallery with no declared sections.");
}

let GALLERY: SectionedGallery;
let UNSECTIONED_PATH: string;

test.beforeAll(async () => {
  GALLERY = await sectionedDefaultLocaleGallery();
  UNSECTIONED_PATH = await unsectionedDefaultLocaleGallery();
});

async function presentedItemIds(
  page: import("@playwright/test").Page,
  expectedCount: number,
) {
  const items = page.getByRole("main").locator("[data-item-id]");
  await expect(items).toHaveCount(expectedCount);

  return items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-item-id") ?? ""),
  );
}

function sectionsNav(page: import("@playwright/test").Page) {
  return page.getByRole("navigation", { name: galleryLabels.sectionsNav });
}

test("a gallery without sections renders no section controls", async ({
  page,
}) => {
  await page.goto(UNSECTIONED_PATH, { waitUntil: "domcontentloaded" });
  await expect(sectionsNav(page)).toHaveCount(0);
});

test("section controls expose keyboard operation and selected state", async ({
  page,
}) => {
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });

  const nav = sectionsNav(page);
  await expect(nav).toBeVisible();

  const allOption = nav.getByRole("link", { name: galleryLabels.allSections });
  await expect(allOption).toHaveAttribute("aria-current", "true");

  const sectionOption = nav.getByRole("link", {
    name: GALLERY.multiPageSection.label,
    exact: true,
  });
  await expect(sectionOption).not.toHaveAttribute("aria-current", "true");

  // Ordinary anchor keyboard contract: Tab to focus, Enter to activate.
  await sectionOption.focus();
  await expect(sectionOption).toBeFocused();
  await page.keyboard.press("Enter");

  await page.waitForURL(
    (url) => url.searchParams.get("section") === GALLERY.multiPageSection.slug,
  );
  await expect(
    sectionsNav(page).getByRole("link", {
      name: GALLERY.multiPageSection.label,
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    sectionsNav(page).getByRole("link", { name: galleryLabels.allSections }),
  ).not.toHaveAttribute("aria-current", "true");
});

test("a scrolled-down control that keeps focus stays visible", async ({
  page,
}) => {
  // ADR-0003 decision 3: "keyboard focus within or moving to the controls
  // keeps or makes them visible" — the "keeps" half specifically, since a
  // mouse wheel or trackpad gesture scrolls the page without moving focus
  // away from a control a visitor already tabbed to.
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });

  const sectionOption = sectionsNav(page).getByRole("link", {
    name: GALLERY.multiPageSection.label,
    exact: true,
  });
  await sectionOption.focus();

  // `window.scrollBy` rather than `page.mouse.wheel`: a real wheel gesture
  // isn't supported in every project this suite runs (mobile WebKit), and
  // what's under test is the scroll *listener*'s behavior, not gesture
  // emulation — a programmatic scroll fires the same native `scroll` event.
  await page.evaluate(() => window.scrollBy(0, 1200));
  await expect(sectionOption).toBeFocused();
  await expect(sectionsNav(page)).not.toHaveClass(/-translate-y-full/);
});

test("a reduced-motion visitor still gets the functional hide-on-scroll-down", async ({
  page,
}) => {
  // ADR-0003 decision 3 lists "motion respects reduced-motion" alongside,
  // not instead of, "scrolling down moves the controls just outside the
  // viewport to preserve image space" — a functional layout behavior, not a
  // decorative animation. Only the CSS transition is skipped.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });

  const nav = sectionsNav(page);
  await expect(nav).toBeVisible();
  await expect(nav).not.toHaveClass(/-translate-y-full/);

  await page.evaluate(() => window.scrollBy(0, 1200));
  await expect(nav).toHaveClass(/-translate-y-full/);
});

test("the selected section restores from a reload, a shared link, and back/forward", async ({
  page,
}) => {
  const url = `${GALLERY.path}?section=${GALLERY.multiPageSection.slug}`;

  // A shared link.
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(
    sectionsNav(page).getByRole("link", {
      name: GALLERY.multiPageSection.label,
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "true");

  // A reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    sectionsNav(page).getByRole("link", {
      name: GALLERY.multiPageSection.label,
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "true");

  // Back to the unfiltered view, then forward again. `goBack`/`goForward`
  // settle once the browser's own history transition starts, which can race
  // Next.js's client-side router actually applying it — so the address is
  // awaited explicitly rather than trusted immediately after the call, the
  // same way a client-side navigation is awaited elsewhere in this suite.
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });
  await page.goBack();
  await page.waitForURL(
    (current) => current.searchParams.get("section") === GALLERY.multiPageSection.slug,
  );

  await page.goForward();
  await page.waitForURL(
    (current) =>
      current.pathname === GALLERY.path && !current.searchParams.has("section"),
  );
});

test("changing section replaces the grid and drops a stale cursor", async ({
  page,
}) => {
  // Reached by following the real "show more" link rather than independently
  // minting a cursor in this process — every other spec in this suite reads a
  // cursor from the server-rendered page rather than re-deriving one, and
  // that is the only construction proven to match what the running server
  // itself validates a token against.
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });
  const nextHref = await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .getAttribute("href");
  expect(nextHref).toBeTruthy();

  await page.goto(new URL(nextHref ?? "", page.url()).href, {
    waitUntil: "domcontentloaded",
  });
  expect(new URL(page.url()).searchParams.get("cursor")).toBeTruthy();
  const cursoredItems = await presentedItemIds(page, GALLERY.pageSize);

  await sectionsNav(page)
    .getByRole("link", { name: GALLERY.multiPageSection.label, exact: true })
    .click();
  await page.waitForURL(
    (url) => url.searchParams.get("section") === GALLERY.multiPageSection.slug,
  );

  // The cursor did not survive the section switch.
  expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);

  // A different, freshly rendered result set.
  const sectionItems = await presentedItemIds(page, GALLERY.pageSize);
  expect(sectionItems).not.toEqual(cursoredItems);
});

test("a delayed in-flight continuation is ignored once a section switch begins", async ({
  page,
}) => {
  // The outgoing `GalleryGrid` instance stays mounted for as long as the
  // section navigation is pending, not just until the click that started it —
  // so an append already in flight has to be discarded the moment that
  // navigation *begins*, not only once the old instance actually unmounts.
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("main").locator("[data-item-id]"),
  ).toHaveCount(GALLERY.pageSize);

  // Both the stale continuation *and* the section's own navigation are gated,
  // so the continuation can be released while the section switch is
  // *certainly* still pending — otherwise a fast local server can settle the
  // navigation before the continuation response even arrives, which would
  // pass regardless of whether the stale response is actually discarded.
  let releaseContinuation: () => void = () => {};
  const continuationGate = new Promise<void>((resolve) => {
    releaseContinuation = resolve;
  });
  await page.route("**/api/gallery**", async (route) => {
    await continuationGate;
    await route.fallback();
  });

  let releaseNavigation: () => void = () => {};
  const navigationGate = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  await page.route(
    (url) =>
      url.pathname === GALLERY.path &&
      url.searchParams.get("section") === GALLERY.multiPageSection.slug,
    async (route) => {
      await navigationGate;
      await route.fallback();
    },
  );

  await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .click();
  await sectionsNav(page)
    .getByRole("link", { name: GALLERY.multiPageSection.label, exact: true })
    .click();

  // Release only the stale continuation. The section navigation is still
  // gated, so the outgoing "All" instance is *certainly* still the one on
  // screen at this moment — this is the one window where the bug is
  // observable at all: once the navigation is later allowed to complete, the
  // new section's own tree replaces this one regardless of what happened to
  // it, which would hide a focus glitch that already came and went.
  releaseContinuation();
  await page.waitForTimeout(300);

  // The old, still-mounted instance's own continuation control must not have
  // taken focus back — that is the concrete "steals focus" failure mode a
  // stale in-flight response can cause while a different navigation is
  // already underway. Matched by `rel="next"` rather than by name: a stale
  // response that skips the merge (correctly) never resets the control's own
  // "loading" label back either, so its accessible name at this exact moment
  // is not the one to key off of.
  await expect(
    page.getByRole("main").locator("a[rel='next']"),
  ).not.toBeFocused();

  releaseNavigation();
  await page.waitForURL(
    (url) => url.searchParams.get("section") === GALLERY.multiPageSection.slug,
  );

  const sectionItems = await presentedItemIds(page, GALLERY.pageSize);
  // Exactly one page of the new section, never doubled by a stale append.
  expect(sectionItems).toHaveLength(GALLERY.pageSize);
});

test("re-selecting the active section does not disable its own continuation", async ({
  page,
}) => {
  // A click on the section's own already-active link causes no navigation at
  // all — the target URL is the one already on screen — so it must not mark
  // this instance stale the way a click that actually leaves it does.
  await page.goto(
    `${GALLERY.path}?section=${GALLERY.multiPageSection.slug}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(
    page.getByRole("main").locator("[data-item-id]"),
  ).toHaveCount(GALLERY.pageSize);

  await sectionsNav(page)
    .getByRole("link", { name: GALLERY.multiPageSection.label, exact: true })
    .click();

  await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .click();
  await expect(
    page.getByRole("main").locator("[data-item-id]"),
  ).toHaveCount(GALLERY.pageSize * 2);
});

// Continuation deliberately leaves the address bar alone once JavaScript
// appends in place (`gallery-grid.tsx`'s own doc comment), so proving the
// cursor a continuation issues is actually section-scoped needs the
// unenhanced link itself — the same reason `gallery-continuation.spec.ts`
// runs its primary walk with JavaScript disabled.
test.describe("continuation stays within the active section", () => {
  test.use({ javaScriptEnabled: false });

  test("the continuation link carries the active section alongside its cursor", async ({
    page,
  }) => {
    const url = `${GALLERY.path}?section=${GALLERY.multiPageSection.slug}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const continueLink = page
      .getByRole("main")
      .getByRole("link", { name: galleryLabels.showMore });
    await expect(continueLink).toHaveAttribute(
      "href",
      new RegExp(`section=${GALLERY.multiPageSection.slug}.*cursor=`),
    );

    await continueLink.click();

    const nextUrl = new URL(page.url());
    expect(nextUrl.pathname).toBe(GALLERY.path);
    expect(nextUrl.searchParams.get("section")).toBe(
      GALLERY.multiPageSection.slug,
    );
    expect(nextUrl.searchParams.get("cursor")).toBeTruthy();

    // A full page of the *section's* items, not the unfiltered gallery's.
    await presentedItemIds(page, GALLERY.pageSize);
    await expect(
      sectionsNav(page).getByRole("link", {
        name: GALLERY.multiPageSection.label,
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("a cursor scoped to one section is refused when replayed against another", async ({
    page,
  }) => {
    await page.goto(
      `${GALLERY.path}?section=${GALLERY.multiPageSection.slug}`,
      { waitUntil: "domcontentloaded" },
    );
    const nextHref = await page
      .getByRole("main")
      .getByRole("link", { name: galleryLabels.showMore })
      .getAttribute("href");
    const cursor = new URL(nextHref ?? "", page.url()).searchParams.get(
      "cursor",
    );
    expect(cursor).toBeTruthy();

    const response = await page.goto(
      `${GALLERY.path}?section=${GALLERY.emptySection.slug}&cursor=${encodeURIComponent(
        cursor ?? "",
      )}`,
      { waitUntil: "domcontentloaded" },
    );

    expect(response?.status()).toBe(404);
  });
});

test("a named section's first page shows its heading, cursored or not", async ({
  page,
}) => {
  await page.goto(
    `${GALLERY.path}?section=${GALLERY.multiPageSection.slug}`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: GALLERY.multiPageSection.label,
    }),
  ).toBeVisible();
});

test("an empty section renders its accessible empty state with controls present", async ({
  page,
}) => {
  await page.goto(
    `${GALLERY.path}?section=${GALLERY.emptySection.slug}`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.getByText(galleryLabels.empty)).toBeVisible();
  await expect(sectionsNav(page)).toBeVisible();
  await expect(
    sectionsNav(page).getByRole("link", {
      name: GALLERY.emptySection.label,
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "true");
});

test("a named section is noindex and canonicalizes to the parameter-free page", async ({
  page,
}) => {
  await page.goto(
    `${GALLERY.path}?section=${GALLERY.multiPageSection.slug}`,
    { waitUntil: "domcontentloaded" },
  );

  const robots = await page
    .locator("meta[name='robots']")
    .getAttribute("content");
  expect(robots).toContain("noindex");

  const canonical = await page
    .locator("link[rel='canonical']")
    .getAttribute("href");
  expect(new URL(canonical ?? "").pathname).toBe(GALLERY.path);
  expect(new URL(canonical ?? "").search).toBe("");
});

test("the unfiltered view carries no noindex directive", async ({ page }) => {
  await page.goto(GALLERY.path, { waitUntil: "domcontentloaded" });

  await expect(page.locator("meta[name='robots']")).toHaveCount(0);
});

for (const [caseName, alias] of [
  ["the reserved all token", "all"],
  ["an empty value", ""],
] as const) {
  test(`?section= as ${caseName} redirects to the parameter-free gallery`, async ({
    page,
  }) => {
    const response = await page.goto(`${GALLERY.path}?section=${alias}`, {
      waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(GALLERY.path);
    expect(new URL(page.url()).searchParams.has("section")).toBe(false);
    const redirectedFrom = response?.request().redirectedFrom();
    expect(redirectedFrom).not.toBeNull();
  });
}

test.describe("an unknown gallery section", () => {
  test("404s without a cursor, still offering the way back", async ({
    page,
  }) => {
    const response = await page.goto(
      `${GALLERY.path}?section=no-such-section`,
      { waitUntil: "load" },
    );
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: galleryLabels.backToStart }),
    ).toHaveAttribute("href", GALLERY.path);
  });

  test("404s alongside a cursor too", async ({ page }) => {
    const response = await page.goto(
      `${GALLERY.path}?section=no-such-section&cursor=not-a-token-this-deployment-minted`,
      { waitUntil: "load" },
    );
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: galleryLabels.backToStart }),
    ).toHaveAttribute("href", GALLERY.path);
  });
});

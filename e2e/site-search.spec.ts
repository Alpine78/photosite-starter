import type { Locator, Page } from "@playwright/test";

import { applyMockEndDateGate } from "../src/lib/content";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { mockContentListingRecords } from "../src/lib/mock-content-listing";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { searchWords } from "../src/lib/site-search-query";
import { expect, test } from "./support/fixtures";
import {
  DEFAULT_SEARCH_NAMESPACE,
  DEFAULT_STORY_NAMESPACE,
  PREFIXED_LOCALE,
  REDUNDANT_DEFAULT_PREFIX,
  appUnderTestEnvironment,
} from "./support/harness-environment";

/**
 * The site search (ADR-0033) against the production build the harness serves:
 * the dialog the header opens, the no-JavaScript results page it upgrades, the
 * localized route, and the endpoint behind it.
 *
 * What the assertions may name is limited on purpose. Titles are content a clone
 * replaces, so each journey derives its search term and the expected public path
 * from the same fixtures and content tree the harness serves, and everything
 * else is located by role, accessible name, or an application-owned route.
 */

type Target = {
  readonly title: string;
  /** One word that starts the title of this story and of no other. */
  readonly term: string;
  readonly path: string;
};

/**
 * A public story whose title has a word no other searchable title starts with,
 * so the journey asserts that exact story is found rather than that something
 * is.
 */
function pickTarget(
  language: string,
  routePrefix: string,
): Target {
  const tree = buildContentTree(
    applyMockEndDateGate(mockContentTreeInputs[language]!, language, new Date()),
  );
  const records = [...mockContentListingRecords[language]!.values()].filter(
    (record) => getCanonicalContentPath(tree, record.contentId) !== null,
  );
  const wordsOf = (title: string) => searchWords(title);
  for (const record of records) {
    const term = wordsOf(record.title).find(
      (word) =>
        word.length >= 5 &&
        !/\d/.test(word) &&
        records.filter((other) =>
          wordsOf(other.title).some((candidate) => candidate.startsWith(word)),
        ).length === 1,
    );
    if (term === undefined) continue;
    const segments = getCanonicalContentPath(tree, record.contentId)!;
    return {
      title: record.title,
      term,
      path: `${routePrefix}/${segments.join("/")}`,
    };
  }
  throw new Error(`[e2e] no uniquely searchable ${language} story in the fixtures`);
}

const defaultLanguage = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const otherLanguage = new Intl.Locale(PREFIXED_LOCALE.prefix).language;

const defaultTarget = pickTarget(defaultLanguage, `/${DEFAULT_STORY_NAMESPACE}`);
const otherTarget = pickTarget(
  otherLanguage,
  `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}`,
);

const copy = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).search;
const otherCopy = getBuiltInLabels(PREFIXED_LOCALE.prefix).search;

const SEARCH_PATH = `/${DEFAULT_SEARCH_NAMESPACE}`;
const OTHER_SEARCH_PATH = `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.searchNamespace}`;

/**
 * The header control. Two layouts render one each and only one is displayed, so
 * the visible one is the one a visitor can use.
 */
function searchTrigger(page: Page): Locator {
  return page
    .getByRole("banner")
    .getByRole("link", { name: copy.open })
    .filter({ visible: true });
}

function searchDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: copy.title });
}

/**
 * Opens the dialog. The header is server-rendered before its script has run,
 * and until then the control is a plain link to the results page — correct for
 * a visitor without script, but not what this journey is about. The header marks
 * hydration by becoming sticky, so wait for that rather than race it.
 */
async function openSearch(page: Page): Promise<Locator> {
  await expect(page.getByRole("banner")).toHaveClass(/sticky/);
  await searchTrigger(page).click();
  const dialog = searchDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("the search dialog", () => {
  test("finds a story by a word of its title and links to its public page", async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    const field = dialog.getByRole("searchbox", { name: copy.fieldLabel });
    await expect(field).toBeFocused();

    await field.fill(defaultTarget.term);

    const hit = dialog.getByRole("link").filter({ hasText: defaultTarget.title });
    await expect(hit).toHaveCount(1);
    await expect(hit).toHaveAttribute("href", defaultTarget.path);
    // The term is highlighted without HTML: a `mark` holding text only.
    await expect(hit.locator("mark").first()).toContainText(
      new RegExp(`^${defaultTarget.term}`, "i"),
    );
    // A settled search is announced once, in the polite live region.
    await expect(dialog.getByRole("status")).toHaveText(/\S/);

    await hit.click();
    await expect(page).toHaveURL(new RegExp(`${defaultTarget.path}$`));
    await expect(searchDialog(page)).toBeHidden();
  });

  test("closes on Escape and returns focus to the control that opened it", async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = searchTrigger(page);
    const dialog = await openSearch(page);

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("closes from its own Close button", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("button", { name: copy.close }).click();
    await expect(dialog).toBeHidden();
  });

  test("keeps keyboard focus inside while open", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("searchbox", { name: copy.fieldLabel }).fill(defaultTarget.term);
    await expect(dialog.getByRole("link").first()).toBeVisible();

    // A modal dialog makes the page behind it inert. Tab may leave the document
    // for the browser's own chrome, which shows as `body`, but it must never land
    // on a control of the page underneath.
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press("Tab");
      const landedBehind = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active !== null &&
          active !== document.body &&
          active.closest("dialog") === null
        );
      });
      expect(landedBehind).toBe(false);
    }
  });

  test("asks for more than one letter and says so when nothing matches", async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    const field = dialog.getByRole("searchbox", { name: copy.fieldLabel });
    await expect(dialog.getByText(copy.prompt)).toBeVisible();

    await field.fill("a");
    await expect(dialog.getByText(copy.prompt)).toBeVisible();

    await field.fill("zzzzqqqq");
    const none = copy.noResults.replace("{query}", "zzzzqqqq");
    // Said once visibly and once to a screen reader, in the polite live region.
    await expect(dialog.getByRole("status")).toHaveText(none);
    await expect(dialog.getByText(none).first()).toBeVisible();
  });

  test("closes when it leads to a results page that differs only in its query", async ({
    page,
  }) => {
    // From the results page itself, "show all" changes nothing but `?q=`, so the
    // header sees no new path; the dialog must still step aside, not stay modal
    // over the page it just loaded.
    await page.goto(`${SEARCH_PATH}?q=zzzzqqqq`);
    const dialog = await openSearch(page);
    await dialog
      .getByRole("searchbox", { name: copy.fieldLabel })
      .fill(defaultTarget.term);
    await dialog
      .getByRole("link", { name: copy.showAll.replace("{query}", defaultTarget.term) })
      .click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(
      new RegExp(`${SEARCH_PATH}\\?q=${encodeURIComponent(defaultTarget.term)}$`),
    );
    const hit = page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: defaultTarget.title });
    await expect(hit).toHaveAttribute("href", defaultTarget.path);
    // The page is usable again: the field answers the keyboard.
    await page.getByRole("searchbox", { name: copy.fieldLabel }).click();
  });

  test("offers the results page for the same term", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog
      .getByRole("searchbox", { name: copy.fieldLabel })
      .fill(defaultTarget.term);
    const all = dialog.getByRole("link", {
      name: copy.showAll.replace("{query}", defaultTarget.term),
    });
    await expect(all).toHaveAttribute(
      "href",
      `${SEARCH_PATH}?q=${encodeURIComponent(defaultTarget.term)}`,
    );
  });

  test("sends the term in a POST body, never in any URL", async ({ page }) => {
    const requests: { url: string; method: string; body: string | null }[] = [];
    page.on("request", (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
      });
    });

    await page.goto("/");
    const dialog = await openSearch(page);
    const before = requests.length;
    await dialog
      .getByRole("searchbox", { name: copy.fieldLabel })
      .fill(defaultTarget.term);
    await expect(dialog.getByRole("link").first()).toBeVisible();
    // Let any speculative request a rendered link could trigger (a prefetch) happen.
    await page.waitForLoadState("networkidle");

    const typed = requests.slice(before);
    const searches = typed.filter((request) => request.url.includes("/api/search"));
    expect(searches.length).toBeGreaterThan(0);
    for (const request of searches) {
      expect(request.method).toBe("POST");
      expect(request.body).toContain(defaultTarget.term);
    }
    // No request of any kind, to any URL, carries the term: not the results page,
    // not a result's prefetch, not a query string.
    for (const request of typed) {
      expect(request.url.toLowerCase()).not.toContain(defaultTarget.term.toLowerCase());
    }
  });
});

test.describe("the results page", () => {
  test.describe("without script", () => {
    test.use({ javaScriptEnabled: false });

    test("serves a plain GET form and its results", async ({ page }) => {
      await page.goto("/");
      // Without script the header control is just a link to the results page.
      await searchTrigger(page).click();
      await expect(page).toHaveURL(new RegExp(`${SEARCH_PATH}$`));
      await expect(
        page.getByRole("heading", { level: 1, name: copy.title }),
      ).toBeVisible();

      const field = page.getByRole("searchbox", { name: copy.fieldLabel });
      await field.fill(defaultTarget.term);
      await field.press("Enter");

      await expect(page).toHaveURL(
        new RegExp(`${SEARCH_PATH}\\?q=${encodeURIComponent(defaultTarget.term)}$`),
      );
      const hit = page
        .getByRole("main")
        .getByRole("link")
        .filter({ hasText: defaultTarget.title });
      await expect(hit).toHaveAttribute("href", defaultTarget.path);
    });
  });

  test("is not indexed and names no canonical page", async ({ page }) => {
    await page.goto(`${SEARCH_PATH}?q=${encodeURIComponent(defaultTarget.term)}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  });

  test("states the count, the empty state and the too-short prompt", async ({ page }) => {
    await page.goto(`${SEARCH_PATH}?q=${encodeURIComponent(defaultTarget.term)}`);
    await expect(
      page.getByRole("main").getByText(/^\d+ results?$/),
    ).toBeVisible();

    // The closed dialog in the header carries the same copy, so look in `main`.
    const main = page.getByRole("main");
    await page.goto(`${SEARCH_PATH}?q=zzzzqqqq`);
    await expect(
      main.getByText(copy.noResults.replace("{query}", "zzzzqqqq")),
    ).toBeVisible();

    await page.goto(`${SEARCH_PATH}?q=a`);
    await expect(main.getByText(copy.prompt)).toBeVisible();
    await page.goto(SEARCH_PATH);
    await expect(main.getByText(copy.prompt)).toBeVisible();
  });

  test("shows a hostile query as text, never as markup", async ({ page }) => {
    const hostile = "<img src=x onerror=alert(1)>";
    await page.goto(`${SEARCH_PATH}?q=${encodeURIComponent(hostile)}`);
    await expect(page.getByRole("main")).toContainText(hostile);
    await expect(page.locator("main img[src='x']")).toHaveCount(0);
  });

  test("normalizes the namespace casing in one redirect that keeps the query", async ({
    page,
  }) => {
    await page.goto(`/${DEFAULT_SEARCH_NAMESPACE.toUpperCase()}?q=${defaultTarget.term}`);
    await expect(page).toHaveURL(new RegExp(`${SEARCH_PATH}\\?q=${defaultTarget.term}$`));
  });

  test("a non-empty keywords selection wins over q, and an invalid one is never redirected", async ({
    page,
  }) => {
    const term = encodeURIComponent(defaultTarget.term);
    // No keyword taxonomy exists yet, so every selection is an unknown keyword.
    expect((await page.goto(`${SEARCH_PATH}?keywords=unknown&q=${term}`))?.status()).toBe(404);
    const variant = `/${DEFAULT_SEARCH_NAMESPACE.toUpperCase()}`;
    expect((await page.goto(`${variant}?keywords=unknown&q=${term}`))?.status()).toBe(404);
    // The 404 is answered where it was asked: no redirect to the canonical path.
    expect(new URL(page.url()).pathname).toBe(variant);

    // The same holds behind the redundant default-locale prefix, which would
    // otherwise redirect first and only then 404.
    const redundant = `/${REDUNDANT_DEFAULT_PREFIX}${SEARCH_PATH}`;
    expect((await page.goto(`${redundant}?keywords=unknown&q=${term}`))?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe(redundant);
  });

  test("redirects the redundant default-locale prefix once, carrying the query", async ({
    page,
  }) => {
    const term = encodeURIComponent(defaultTarget.term);
    await page.goto(`/${REDUNDANT_DEFAULT_PREFIX}${SEARCH_PATH}?q=${term}`);
    await expect(page).toHaveURL(new RegExp(`${SEARCH_PATH}\\?q=${term}$`));
    expect(new URL(page.url()).pathname).toBe(SEARCH_PATH);
  });

  test("an empty keywords selection leaves the text query in charge", async ({ page }) => {
    const term = encodeURIComponent(defaultTarget.term);
    for (const keywords of ["", "%20,%20,"]) {
      await page.goto(`${SEARCH_PATH}?keywords=${keywords}&q=${term}`);
      await expect(
        page.getByRole("main").getByRole("link").filter({ hasText: defaultTarget.title }),
      ).toHaveAttribute("href", defaultTarget.path);
    }
  });

  test("owns no sub-paths", async ({ page }) => {
    const response = await page.goto(`${SEARCH_PATH}/anything`);
    expect(response?.status()).toBe(404);
  });

  test("is localized, with its own namespace and the locale's own stories", async ({
    page,
  }) => {
    await page.goto(`${OTHER_SEARCH_PATH}?q=${encodeURIComponent(otherTarget.term)}`);
    await expect(
      page.getByRole("heading", { level: 1, name: otherCopy.title }),
    ).toBeVisible();
    const hit = page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: otherTarget.title });
    await expect(hit).toHaveAttribute("href", otherTarget.path);

    // A word found in the other locale is not found here: no cross-language hit.
    await page.goto(`${OTHER_SEARCH_PATH}?q=${encodeURIComponent(defaultTarget.term)}`);
    await expect(
      page.getByRole("main").getByRole("link").filter({ hasText: defaultTarget.title }),
    ).toHaveCount(0);
  });

  test("switches language to the other locale's search page", async ({ page }) => {
    await page.goto(SEARCH_PATH);
    const switcher = page
      .getByRole("main")
      .locator(`a[hreflang="${PREFIXED_LOCALE.prefix}"]`);
    await expect(switcher).toHaveAttribute("href", OTHER_SEARCH_PATH);
  });
});

test.describe("the search endpoint", () => {
  const endpoint = "/api/search";

  test("answers a same-origin JSON POST with grouped results, uncached", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(endpoint, {
      headers: { origin: baseURL! },
      data: { q: defaultTarget.term, lang: appUnderTestEnvironment.SITE_LOCALE },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await response.json()) as {
      status: string;
      results: { stories: { hits: { href: string }[] } };
    };
    expect(body.status).toBe("ok");
    expect(body.results.stories.hits.map((hit) => hit.href)).toContain(
      defaultTarget.path,
    );
  });

  test("refuses a foreign origin, a non-JSON body, an unknown locale and a GET", async ({
    request,
    baseURL,
  }) => {
    const sameOrigin = { origin: baseURL! };
    expect(
      (
        await request.post(endpoint, {
          headers: { origin: "https://evil.example" },
          data: { q: "rally", lang: "en-GB" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(endpoint, {
          headers: { ...sameOrigin, "content-type": "text/plain" },
          data: "q=rally",
        })
      ).status(),
    ).toBe(415);
    expect(
      (
        await request.post(endpoint, {
          headers: sameOrigin,
          data: { q: "rally", lang: "sv" },
        })
      ).status(),
    ).toBe(422);
    expect((await request.get(`${endpoint}?q=rally`)).status()).toBe(405);
  });

  test("searches only the requested locale's stories", async ({ request, baseURL }) => {
    const response = await request.post(endpoint, {
      headers: { origin: baseURL! },
      data: { q: otherTarget.term, lang: PREFIXED_LOCALE.prefix },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      results: { stories: { hits: { href: string }[] } };
    };
    const hrefs = body.results.stories.hits.map((hit) => hit.href);
    expect(hrefs).toContain(otherTarget.path);
    expect(hrefs.every((href) => href.startsWith(`/${PREFIXED_LOCALE.prefix}/`))).toBe(true);
  });
});

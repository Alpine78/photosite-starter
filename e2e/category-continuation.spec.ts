import { getBuiltInLabels } from "@/lib/deployment-config";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The category branch listing continuation journey (AB#140, ADR-0013).
 *
 * Everything here runs **without JavaScript**, which is the point rather than a
 * severity setting: ADR-0003 decision 8 requires the continuation control to be
 * a real `href` that renders a bounded page on its own, so a continuation URL
 * can be reloaded, shared, and crawled. Progressive in-place append is
 * deliberately not built for category listings, so the unenhanced path is the
 * only path and this proves it.
 *
 * Items are compared by the listing card's link target (one canonical detail
 * route per page), never by title — a clone rewrites every title, and "page two
 * is not page one again" is a claim about identity anyway.
 */

test.use({ javaScriptEnabled: false });

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const treeLabels = labels.contentTree;

/**
 * `cat-gear` in the default-locale mock tree: it holds one authored article and
 * a child (`cat-gear-notebook`) filled with generated notes, so its aggregated
 * branch listing runs past one page. A clone renames the slug; the journey
 * depends on the property (more content than one page holds), so if this ever
 * needs to move, move it — do not add a second brittle constant.
 */
const BRANCH_PATH = `${STORY_ROOT}/gear`;
/** Its child leaf, which accepts `?cursor=` but issues none of its own. */
const CHILD_BRANCH_PATH = `${STORY_ROOT}/gear/notebook`;

/** Every listing card's detail-route href, in document order. */
function cardHrefs(page: import("@playwright/test").Page) {
  return page
    .getByRole("main")
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { level: 3 }) });
}

async function hrefsOn(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  const links = cardHrefs(page);
  const count = await links.count();
  const hrefs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    hrefs.push((await links.nth(index).getAttribute("href")) ?? "");
  }
  return hrefs;
}

test("walks a large category branch page by page with no duplicates or gaps", async ({
  page,
}) => {
  // The project fixture already fails a test that reaches a third-party origin.
  await page.goto(BRANCH_PATH, { waitUntil: "domcontentloaded" });

  const seen: string[] = [];
  let hop = 0;

  for (;;) {
    hop += 1;
    expect(hop).toBeLessThan(20);

    const pageHrefs = await hrefsOn(page);
    expect(pageHrefs.length).toBeGreaterThan(0);
    seen.push(...pageHrefs);

    const more = page
      .getByRole("main")
      .getByRole("link", { name: treeLabels.showMoreContent });

    if ((await more.count()) === 0) break;

    const nextUrl = await more.getAttribute("href");
    expect(nextUrl).toContain("?cursor=");
    await page.goto(nextUrl!, { waitUntil: "domcontentloaded" });
  }

  // More than one page was actually walked.
  expect(hop).toBeGreaterThan(1);
  // No card appeared twice across the whole walk.
  expect(new Set(seen).size).toBe(seen.length);
  // The whole aggregated branch was covered — well past one page.
  expect(seen.length).toBeGreaterThan(24);
});

test("a continuation page is compact, self-canonical, and links back to the first page", async ({
  page,
}) => {
  await page.goto(BRANCH_PATH, { waitUntil: "domcontentloaded" });
  const nextUrl = await page
    .getByRole("main")
    .getByRole("link", { name: treeLabels.showMoreContent })
    .getAttribute("href");
  expect(nextUrl).toContain("?cursor=");

  await page.goto(nextUrl!, { waitUntil: "domcontentloaded" });

  await test.step("its heading marks it as a continuation", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      treeLabels.continued,
    );
  });

  await test.step("it does not repeat the story-root introduction", async () => {
    await expect(page.getByText(treeLabels.storyRootIntroduction)).toHaveCount(
      0,
    );
  });

  await test.step("it is self-canonical at its own cursor URL", async () => {
    const canonical = await page
      .locator("link[rel='canonical']")
      .getAttribute("href");
    expect(canonical).toContain("?cursor=");
    expect(new URL(canonical!).searchParams.get("cursor")).toBe(
      new URL(nextUrl!, page.url()).searchParams.get("cursor"),
    );
  });

  await test.step("it names no hreflang alternates", async () => {
    await expect(page.locator("link[rel='alternate']")).toHaveCount(0);
  });

  await test.step("its link back returns to the parameter-free branch", async () => {
    const back = page
      .getByRole("main")
      .getByRole("link", { name: treeLabels.backToStart });
    await expect(back).toHaveAttribute("href", BRANCH_PATH);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`${BRANCH_PATH}$`));
  });
});

/**
 * The 404 journey — the one place this suite allows JavaScript.
 *
 * The 404 *status* is a server response and is checked with JS disabled below.
 * The 404 *document*, however, has the same site-wide limitation the gallery
 * continuation 404s document (ADR-0007, AB#132): on this Next.js version the
 * not-found boundary's semantic heading and its link back arrive only in the
 * RSC payload, so `javaScriptEnabled: false` sees an empty shell. When the 404
 * document renders as HTML, `javaScriptEnabled: false` belongs here too.
 */
test.describe("an unspendable category continuation token is a 404 with a way back", () => {
  test.use({ javaScriptEnabled: true });

  test("404s, and the 404 links back to the branch", async ({ page }) => {
    await page.goto(BRANCH_PATH, { waitUntil: "domcontentloaded" });
    const nextUrl = await page
      .getByRole("main")
      .getByRole("link", { name: treeLabels.showMoreContent })
      .getAttribute("href");
    const token = new URL(nextUrl!, page.url()).searchParams.get("cursor")!;

    await test.step("a tampered token 404s", async () => {
      const response = await page.goto(`${BRANCH_PATH}?cursor=${token}x`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(404);
    });

    await test.step("a token minted for another branch 404s", async () => {
      // The cat-gear token, replayed against its own child leaf, is wrong-scope.
      const response = await page.goto(`${CHILD_BRANCH_PATH}?cursor=${token}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(404);
    });

    await test.step("a repeated cursor parameter 404s", async () => {
      const response = await page.goto(
        `${BRANCH_PATH}?cursor=${token}&cursor=${token}`,
        { waitUntil: "domcontentloaded" },
      );
      expect(response?.status()).toBe(404);
    });

    await test.step("the 404 carries a link back to the branch", async () => {
      await expect(
        page
          .getByRole("main")
          .getByRole("link", { name: treeLabels.backToStart }),
      ).toHaveAttribute("href", BRANCH_PATH);
    });
  });
});

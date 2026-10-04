import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const tree = buildContentTree(mockContentTreeInputs[language]);
const path = getCanonicalContentPath(tree, "content-choosing-a-telephoto-lens");
if (!path) throw new Error("Missing inline-link fixture route");
const articlePath = `/${DEFAULT_STORY_NAMESPACE}/${path.join("/")}`;

for (const javaScriptEnabled of [true, false]) {
  test.describe(`inline links, JavaScript ${javaScriptEnabled}`, () => {
    test.use({javaScriptEnabled});
    test("preserves paragraph/list text and supports native keyboard navigation without external requests", async ({page}) => {
      const externalRequests: string[] = [];
      page.on("request", request => {
        if (new URL(request.url()).hostname === "example.org") externalRequests.push(request.url());
      });
      await page.goto(articlePath);
      const link = page.getByRole("link", {name: "checklist below", exact: true});
      await expect(link.locator("..")).toHaveText("Read the checklist below, or visit the example reference.");
      const external = page.getByRole("link", {name: "example reference", exact: true});
      await expect(external).toHaveAttribute("href", "https://example.org/reference");
      await expect(external).toHaveAttribute("rel", "noreferrer");
      await expect(external).not.toHaveAttribute("target");
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#section-key-specifications-to-evaluate$/);
      await expect(page.locator("#section-key-specifications-to-evaluate")).toBeInViewport();
      const listLink = page.getByRole("link", {name: "specifications", exact: true});
      await expect(listLink.locator("xpath=ancestor::li[1]")).toHaveText("Review the specifications.");
      await listLink.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#section-key-specifications-to-evaluate")).toBeInViewport();
      expect(externalRequests).toEqual([]);
    });
  });
}

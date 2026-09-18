import { expect, test } from "./support/fixtures";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { mockPolls } from "../src/lib/mock-polls";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).poll;
const path = `/${DEFAULT_STORY_NAMESPACE}/${getCanonicalContentPath(buildContentTree(mockContentTreeInputs.en), "content-choosing-a-telephoto-lens")!.join("/")}`;
const open = mockPolls[0]!, closed = mockPolls[1]!, empty = mockPolls[2]!;

// WebKit refuses Secure cookies on this harness's HTTP loopback origin.
// Assert the real wire attribute, then adapt only the browser's local transport;
// the server's receipt, count, retry and form paths are still exercised intact.
test.beforeEach(async ({ context, browserName, baseURL }) => {
  if (browserName !== "webkit") return;
  await context.route(`${baseURL}/api/poll-vote**`, async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["set-cookie"]) {
      expect(headers["set-cookie"]).toContain("Secure");
      const pair = headers["set-cookie"].split(";")[0]!;
      const eq = pair.indexOf("=");
      await context.addCookies([{ name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: new URL(baseURL!).hostname, path: "/api/poll-vote", httpOnly: true, secure: false, sameSite: "Lax" }]);
      delete headers["set-cookie"];
    }
    await route.fulfill({ response, headers });
  });
});

test("keyboard voting records one vote and remembers it on reload", async ({ page, context, browserName }) => {
  await page.goto(path);
  const poll = page.getByRole("region", { name: open.question });
  await expect(poll.getByRole("button", { name: labels.submit })).toBeEnabled();
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith("poll_voter_"))).toBe(false);
  await poll.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(poll.getByRole("status")).toHaveText(labels.voted);
  await expect(poll.getByRole("status")).toBeFocused();
  await expect(poll.getByRole("radio")).toHaveCount(0);
  const cookies = await context.cookies();
  const voter = cookies.find((c) => c.name.startsWith("poll_voter_"));
  expect(voter).toMatchObject({ httpOnly: true, secure: browserName !== "webkit", path: "/api/poll-vote" });
  await page.reload();
  await expect(poll.getByRole("status")).toHaveText(labels.voted);
  await expect(poll.getByRole("radio")).toHaveCount(0);
});

test("closed and unanswered polls show their results without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(path);
    const historical = page.getByRole("region", { name: closed.question });
    await expect(historical.getByRole("status")).toHaveText(labels.closed);
    await expect(historical).toContainText("75.0% (3)");
    await expect(historical.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("region", { name: empty.question })).toContainText(labels.noVotes);
    const ongoing = page.getByRole("region", { name: open.question });
    await expect(ongoing.getByRole("button", { name: labels.submit })).toBeDisabled();
    await expect(ongoing).toContainText(labels.javascript);
  } finally { await context.close(); }
});

test("a double submit while the response is pending sends only one POST", async ({ page }) => {
  let posts = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/poll-vote", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    await pending; await route.continue();
  });
  await page.goto(path);
  const poll = page.getByRole("region", { name: open.question });
  const button = poll.getByRole("button", { name: labels.submit });
  await expect(button).toBeEnabled();
  await poll.getByRole("radio").first().check();
  await poll.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(poll.getByRole("button", { name: labels.submitting })).toBeDisabled();
  await expect.poll(() => posts).toBe(1);
  release();
  await expect(poll.getByRole("status")).toHaveText(labels.voted);
  expect(posts).toBe(1);
});

test("a lost POST response retries the same receipt and preserves the result", async ({ page, context, browserName }) => {
  let posts = 0;
  await page.route("**/api/poll-vote", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    if (posts === 1) {
      const response = await route.fetch();
      if (browserName === "webkit") {
        const pair = response.headers()["set-cookie"]!.split(";")[0]!;
        const eq = pair.indexOf("=");
        await context.addCookies([{ name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: new URL(page.url()).hostname, path: "/api/poll-vote", httpOnly: true, secure: false, sameSite: "Lax" }]);
      }
      await route.abort("failed");
    }
    else await route.continue();
  });
  await page.goto(path);
  const poll = page.getByRole("region", { name: open.question });
  await expect(poll.getByRole("button", { name: labels.submit })).toBeEnabled();
  await poll.getByRole("radio").first().check();
  await poll.getByRole("button", { name: labels.submit }).click();
  await expect(poll.getByRole("status")).toHaveText(labels.error);
  await poll.getByRole("button", { name: labels.retry }).click();
  await expect(poll.getByRole("status")).toHaveText(labels.voted);
  expect(posts).toBe(1); // Preparation sees the existing receipt, so no second write is needed.
});

test("a failed initial results read offers a reachable retry", async ({ page }) => {
  let fail = true;
  await page.route(`**/api/poll-vote?pollId=${open.pollId}`, async (route) => {
    if (fail) { fail = false; await route.fulfill({ status: 503, contentType: "application/json", body: '{"status":"failed"}' }); }
    else await route.continue();
  });
  await page.goto(path);
  const poll = page.getByRole("region", { name: open.question });
  await expect(poll.getByRole("status")).toHaveText(labels.error);
  await poll.getByRole("button", { name: labels.retry }).click();
  await expect(poll.getByRole("button", { name: labels.submit })).toBeEnabled();
});

test("a narrow viewport keeps the poll controls within the page", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(path);
  const poll = page.getByRole("region", { name: open.question });
  await expect(poll.getByRole("button", { name: labels.submit })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await poll.screenshot({ path: test.info().outputPath("poll-mobile.png") });
});

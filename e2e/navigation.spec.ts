import type { Locator, Page } from "@playwright/test";
import {
  buildContentTree,
  getCategoryPath,
  getPublicChildCategories,
} from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { expect, test } from "./support/fixtures";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { headerMenuToggle, openHeaderNavigation } from "./support/public-page";

/**
 * The site menu: how the configured static routes and the public content tree
 * compose into one navigation, and how it behaves under a keyboard, a pointer,
 * and a narrow viewport.
 *
 * Nothing here names a menu label or a category. A clone rebrands both, and the
 * second locale renders them differently, so the journey discovers the menu
 * from the running page and asserts what a clone must keep: one owner per
 * route, links that work by keyboard with visible focus, a disclosure that says
 * whether it is expanded and hands focus back when dismissed, ancestry a
 * visitor can see, and a compact panel that neither covers the page nor holds a
 * visitor inside itself.
 *
 * Both browser projects run it. The wide and compact layouts are different
 * navigation rather than one list made narrower, and the parts that exist in
 * only one of them say so instead of quietly passing.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;

/**
 * A category the menu deliberately does not show, with the branch above it that
 * has to lead there. Derived from the same adapter data the harness serves, so
 * the journey states the rule — the menu stops at two levels and the landing
 * page carries on — without writing a category path into the test.
 */
function branchBelowTheMenu(): { readonly parent: string; readonly child: string } {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const input = mockContentTreeInputs[language];
  if (input === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }

  const tree = buildContentTree(input);
  const path = (categoryId: string) =>
    `${STORY_ROOT}/${getCategoryPath(tree, categoryId).join("/")}`;

  for (const top of getPublicChildCategories(tree, null)) {
    for (const second of getPublicChildCategories(tree, top.categoryId)) {
      const [third] = getPublicChildCategories(tree, second.categoryId);
      if (third === undefined) continue;
      return {
        parent: path(second.categoryId),
        child: path(third.categoryId),
      };
    }
  }

  throw new Error("[e2e] The harness needs a category deeper than the menu shows.");
}

const DEEP_BRANCH = branchBelowTheMenu();

/**
 * The first menu entry that has a submenu, as the control and the panel it
 * names.
 *
 * Both are re-anchored to that panel's id once found, rather than kept as
 * "whatever is in the visible menu": in the compact layout a tap outside closes
 * the whole menu, and a locator that went looking inside it again would fail to
 * resolve at exactly the moment the test wants to assert that it closed.
 */
async function firstSubmenu(page: Page): Promise<{
  readonly navigation: Locator;
  readonly toggle: Locator;
  readonly panel: Locator;
}> {
  const navigation = await openHeaderNavigation(page);
  const id = await navigation
    .getByRole("button")
    .first()
    .getAttribute("aria-controls");
  expect(id, "a submenu control must name the panel it opens").toBeTruthy();

  const toggle = page.locator(`button[aria-controls="${id}"]`);

  // Opened and closed once with a pointer before anything is asserted, for the
  // same reason `openHeaderNavigation` retries its own click: a key pressed at
  // a control whose script has not run yet reaches nothing, and the journeys
  // below are about the menu's behaviour rather than about hydration timing.
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  return { navigation, toggle, panel: page.locator(`[id="${id}"]`) };
}

async function hrefOf(link: Locator): Promise<string> {
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  return href as string;
}

/**
 * Presses Tab until the control has focus. Bounded, so a menu that cannot be
 * reached by keyboard fails the test rather than pressing Tab forever, and
 * counted in presses rather than in a fixed number, which the two layouts and a
 * clone's own link count would all disagree about.
 */
async function tabTo(page: Page, target: Locator, presses = 25): Promise<void> {
  for (let press = 0; press < presses; press += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }

  throw new Error("[e2e] The control was not reachable by Tab.");
}

test("the menu composes the static routes with the content tree", async ({
  page,
  externalRequests,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { navigation, toggle, panel } = await firstSubmenu(page);

  await expect(navigation).toHaveAttribute("aria-label", /\S/);
  expect(
    await navigation.locator(":scope > ul > li").count(),
  ).toBeGreaterThan(1);

  // One owner per route: the tree supplies the content section, so a configured
  // link into that namespace never survives beside it as a second entry.
  await expect(navigation.locator(`a[href="${STORY_ROOT}"]`)).toHaveCount(1);

  await expect(toggle).toHaveAccessibleName(/\S/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();

  const branches = panel.getByRole("link");
  expect(await branches.count()).toBeGreaterThan(0);

  const paths = await branches.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  for (const path of paths) {
    // Every entry is a branch of the tree the section owns, and every one of
    // them is a link: the menu opens pages, not more menu.
    expect(path.startsWith(`${STORY_ROOT}/`)).toBe(true);
  }
  expect(new Set(paths).size).toBe(paths.length);

  expect(externalRequests).toEqual([]);
});

test("a submenu opens and closes by keyboard, and focus comes back", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { toggle, panel } = await firstSubmenu(page);

  await test.step("Enter opens it", async () => {
    // The deliberate keyboard-only path: focus arrives at the control before
    // the key does. The pointer-then-keyboard path is a separate test, because
    // an explicit `focus()` here would hide whether the menu still answers
    // Escape when a pointer opened it and left focus elsewhere.
    await toggle.focus();
    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
  });

  await test.step("Escape closes it and hands focus back to the control", async () => {
    await page.keyboard.press("Escape");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    // Not the top of the document: a visitor who dismissed a submenu has not
    // left the menu, and re-reaching their place is the cost of getting this
    // wrong on every page of the site.
    await expect(toggle).toBeFocused();
  });
});

test("a submenu opened with a pointer still closes with Escape", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { toggle, panel } = await firstSubmenu(page);

  // No `focus()` anywhere in this test, on purpose. WebKit does not focus a
  // button a pointer activated — the active element stays `document.body` — so
  // a menu that listened for Escape on its own markup would answer in Chromium
  // and stay stubbornly open in Safari. This is the path of a visitor who opens
  // the menu with a thumb or a mouse and then reaches for the keyboard.
  await toggle.click();
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  // Focus lands on the control the visitor used, which after a pointer
  // activation is also the first place it should have been.
  await expect(toggle).toBeFocused();
});

test("Escape unwinds the compact menu one level at a time", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const menuToggle = headerMenuToggle(page);
  test.skip(
    !(await menuToggle.isVisible()),
    "the wide layout renders the menu inline, with no panel to unwind",
  );

  // Both levels opened by pointer and dismissed by keyboard, again with no
  // `focus()` call: this is the nesting the two listeners have to agree about.
  const { toggle, panel } = await firstSubmenu(page);
  await toggle.click();
  await expect(panel).toBeVisible();

  await test.step("the first Escape dismisses the submenu only", async () => {
    await page.keyboard.press("Escape");

    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    // The panel around it keeps its place. Collapsing the whole menu under one
    // key would throw away where in the tree the visitor had got to.
    await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  });

  await test.step("the next one dismisses the panel", async () => {
    await page.keyboard.press("Escape");

    await expect(menuToggle).toHaveAttribute("aria-expanded", "false");
    await expect(menuToggle).toBeFocused();
  });
});

test("the menu is reachable by Tab and shows where the keyboard is", async ({
  page,
  browserName,
}) => {
  // WebKit does not put a `<button>` in the default Tab order on either
  // platform this suite runs on, unless the OS-level "Full Keyboard Access"
  // setting is on — off by default, and not something a CI agent enables. A
  // probe that presses Tab once and checks whether focus moved at all is not a
  // stand-in for this: it is true on one platform, because Tab still walks the
  // page's links, and false on another, because the touch-device profile stops
  // Tab from doing anything — so it skipped in one place and let this test hang
  // on a `<button>` it was never going to reach in the other. Skipping by engine
  // is the honest statement of what is actually being tested: real keyboard
  // reachability of a control WebKit does not expose to Tab by default, on any
  // platform.
  test.skip(
    browserName === "webkit",
    "WebKit does not tab to a button by default on any platform this suite runs on",
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { toggle, panel } = await firstSubmenu(page);

  // `firstSubmenu` warms up hydration with a pointer click, and on Chromium a
  // mouse click focuses the button it lands on. Left alone, `tabTo` below would
  // find the toggle already focused and return without pressing a single Tab —
  // and `:focus-visible` never matches a click-driven focus, so the ring
  // assertion would be checking the wrong kind of focus entirely. Blurring
  // first means the Tab walk that follows is the only thing that can focus it.
  await toggle.evaluate((node) => node.blur());

  await test.step("a keyboard reaches the control, and it shows where it is", async () => {
    await tabTo(page, toggle);

    const ring = await toggle.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThan(0);
  });

  await test.step("Tab carries on into the submenu it opened", async () => {
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link").first()).toBeFocused();
  });
});

test("a pointer landing outside the menu closes the submenu", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { toggle, panel } = await firstSubmenu(page);

  await toggle.click();
  await expect(panel).toBeVisible();

  // The footer's closing line: page content that carries no link of its own,
  // so dismissing the menu cannot turn into a navigation.
  await page.getByRole("contentinfo").locator("p").last().click();

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

test("the menu marks the branch that holds the page a visitor is on", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { toggle, panel } = await firstSubmenu(page);

  await toggle.click();
  const branch = panel.getByRole("link").first();
  const branchPath = await hrefOf(branch);

  await branch.click();
  await page.waitForURL(`**${branchPath}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // Reopened rather than reused: navigating closes the menu, so the state has
  // to be read from the header of the page the visitor actually arrived on.
  const navigation = await openHeaderNavigation(page);

  // The section holds the page without being it, and the branch is the page
  // itself. One current page, and an ancestry a visitor can see.
  await expect(navigation.locator(`a[href="${STORY_ROOT}"]`)).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(navigation.locator(`a[href="${branchPath}"]`)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.locator("[aria-current='page']")).toHaveCount(1);
});

test("a branch below the menu stays reachable through its landing page", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const { toggle, panel } = await firstSubmenu(page);
  await toggle.click();

  // The menu carries two category levels by design. That is only acceptable
  // while the level above the rest leads there, which is what this asserts.
  await expect(panel.locator(`a[href="${DEEP_BRANCH.child}"]`)).toHaveCount(0);
  const parent = panel.locator(`a[href="${DEEP_BRANCH.parent}"]`);
  await expect(parent).toHaveCount(1);

  await parent.click();
  await page.waitForURL(`**${DEEP_BRANCH.parent}`);

  const deeper = page.getByRole("main").locator(`a[href="${DEEP_BRANCH.child}"]`);
  await expect(deeper).toHaveCount(1);

  await deeper.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${DEEP_BRANCH.child}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("the compact panel neither locks nor hides the page behind it", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const toggle = headerMenuToggle(page);
  test.skip(
    !(await toggle.isVisible()),
    "the wide layout renders the menu inline, with no panel to open",
  );

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // A disclosure, not a dialog: the page stays visible, stays scrollable, and
  // nothing behind the menu is made unreachable while it is open.
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("[aria-modal='true'], [inert]")).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const { overflow } = getComputedStyle(document.body);
      return overflow === "hidden" || overflow === "clip";
    }),
  ).toBe(false);

  await test.step("Escape closes it and returns focus to the control", async () => {
    // The panel was opened by pointer and is dismissed by keyboard, with no
    // `focus()` in between: in WebKit the active element is still the document
    // body at this point.
    await page.keyboard.press("Escape");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });
});

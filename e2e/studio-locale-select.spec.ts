import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { test, expect } from "./support/fixtures";
import type { LocaleNavbarSelectProps } from "../studio/locale-navbar-select";

type Scheme = "light" | "dark";
let server: ViteDevServer, render: (props: LocaleNavbarSelectProps, scheme?: Scheme) => string;
const studioRequire = createRequire(resolve("studio/package.json"));
// The installed reset imported by sanity/lib/index.js -> ui5/styles.css, without its remote fonts.
const reset = readFileSync(resolve(dirname(studioRequire.resolve("ui5/package.json")), "src/css/global/reset.css"), "utf8");
const uiStyles = readFileSync(resolve(dirname(studioRequire.resolve("@sanity/ui/package.json")), "dist/styles.css"), "utf8");
test.beforeAll(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  render = (await server.ssrLoadModule("/studio/test-support/render-studio-markup.tsx")).renderLocaleNavbarSelect;
});
test.afterAll(async () => { await server?.close(); });

const props = (currentLocale: string, extra: Partial<LocaleNavbarSelectProps> = {}): LocaleNavbarSelectProps => ({
  selectId: "locale-fixture", currentLocale, changing: false, failed: false, onSelect() {},
  locales: [{ id: "en-US", title: "English (US)" }, { id: "fi-FI", title: "Finnish" }], ...extra,
});
async function show(page: Page, locale: string, markup: string) {
  await page.setContent(`<!doctype html><html lang="${locale}"><head><style>${reset}${uiStyles}</style></head><body>${markup}<select aria-label="Raw reset witness"></select></body></html>`);
  // Negative control: the installed reset strips a raw select of all native chrome.
  const witness = page.getByRole("combobox", { name: "Raw reset witness" });
  await expect(witness).toHaveCSS("appearance", "none"); await expect(witness).toHaveCSS("border-top-width", "0px");
  await witness.evaluate((node) => node.remove());
}

for (const [locale, label, selected] of [["fi-FI", "Käyttöliittymän kieli", "Suomi"], ["en-US", "Interface language", "English"]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`the interface language select keeps visible chrome and keyboard focus ${locale} ${scheme}`, async ({ page }) => {
      await show(page, locale, render(props(locale), scheme));
      const select = page.getByRole("combobox", { name: label, exact: true });
      await expect(select.locator("option:checked")).toHaveText(selected);
      await expect(select).not.toHaveCSS("box-shadow", "none");
      const size = await select.boundingBox();
      expect(size?.width).toBeGreaterThan(80);
      const rest = await select.evaluate((node) => getComputedStyle(node).boxShadow);
      await page.keyboard.press("Tab");
      await expect(select).toBeFocused();
      await expect.poll(() => select.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(rest);
      await select.evaluate((node) => (node as HTMLElement).blur());
      await page.getByText(label, { exact: true }).click();
      await expect(select).toBeFocused();
    });
  }
}

test("the select is disabled while the language changes and a failure is announced", async ({ page }) => {
  await show(page, "fi-FI", render(props("fi-FI", { changing: true })));
  await expect(page.getByRole("combobox")).toBeDisabled();
  await show(page, "en-US", render(props("en-US", { failed: true })));
  await expect(page.getByRole("combobox")).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveText("Unable to change the language. Try again.");
});

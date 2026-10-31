import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { test, expect } from "./support/fixtures";
import { existingImageViewFixture } from "../test-support/existing-client-web-images-fixture";

let server: ViteDevServer;
let renderView: (props: ReturnType<typeof existingImageViewFixture>, scheme?: "light" | "dark") => string;
const studioRequire = createRequire(resolve("studio/package.json"));
// The installed reset imported by sanity/lib/index.js -> ui5/styles.css, without its remote fonts.
const reset = readFileSync(resolve(dirname(studioRequire.resolve("ui5/package.json")), "src/css/global/reset.css"), "utf8");
const uiStyles = readFileSync(resolve(dirname(studioRequire.resolve("@sanity/ui/package.json")), "dist/styles.css"), "utf8");
function studioDocument(locale: string, props: ReturnType<typeof existingImageViewFixture>, scheme: "light" | "dark" = "light") {
  return `<!doctype html><html lang="${locale}"><head><style>${reset}${uiStyles}</style></head><body>${renderView(props, scheme)}</body></html>`;
}
let copy: (locale: string) => { opener: string; close: string; clear: string; add: string; retry: string; more: string; cutoff: string; cutoffHelp: string; search: string; cleared: string; image: (i: number, n: number, row: ReturnType<typeof existingImageViewFixture>["state"]["rows"][number]) => string };
test.beforeAll(async () => {
  // The installed Vitest toolchain already includes Vite. Its real SSR loader
  // avoids Playwright turning TSX nodes into component-testing descriptors.
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  const loaded = await server.ssrLoadModule("/studio/existing-client-web-images-view.tsx");
  copy = loaded.existingImageText;
  renderView = (await server.ssrLoadModule("/studio/test-support/render-studio-markup.tsx")).renderExistingImages;
});
test.afterAll(async () => { await server?.close(); });

// Actual control markup, installed Studio reset and UI theme only: no hydration, Studio auth, controller state or focus-return claim.
for (const locale of ["fi-FI", "en-GB"]) for (const scheme of ["light", "dark"] as const) {
  test(`existing Studio image chooser native keyboard semantics ${locale} ${scheme}`, async ({ page }) => {
    const props = existingImageViewFixture(locale), text = copy(locale);
    await page.setContent(studioDocument(locale, props, scheme).replace("</body>", `<input type="checkbox" aria-label="Raw reset witness"></body>`));
    // Negative control: the installed reset strips a raw checkbox of all native chrome.
    const witness = page.getByRole("checkbox", { name: "Raw reset witness" });
    await expect(witness).toHaveCSS("appearance", "none"); await expect(witness).toHaveCSS("border-top-width", "0px");
    await witness.evaluate((node) => node.remove());
    const opener = page.getByRole("button", { name: text.opener, exact: true }), boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(2); await expect(boxes.nth(0)).toHaveAccessibleName(text.image(1, 2, props.state.rows[0]));
    await expect(boxes.nth(1)).toHaveAccessibleName(text.image(2, 2, props.state.rows[1]));
    for (const box of await boxes.all()) {
      // Sanity paints the adjacent span; the native input itself is transparent.
      const mark = box.locator("+ span");
      await expect(mark).toBeVisible(); expect(await mark.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(10);
      await expect(mark).not.toHaveCSS("box-shadow", "none");
    }
    await expect(opener).toHaveAttribute("aria-expanded", "true"); await expect(page.getByRole("status")).toHaveCount(1);
    await opener.focus(); await page.keyboard.press("Tab");
    const cutoff = page.getByLabel(text.cutoff, { exact: true });
    await expect(cutoff).toBeFocused(); await expect(cutoff).toHaveAccessibleDescription(text.cutoffHelp);
    await expect(cutoff.locator("+ span")).not.toHaveCSS("box-shadow", "none");
    await cutoff.fill("2025-03-01T12:30"); await expect(cutoff).toHaveValue("2025-03-01T12:30");
    expect(await cutoff.evaluate(input => (input as HTMLInputElement).validity.badInput)).toBe(false);
    const search = page.getByRole("button", { name: text.search, exact: true });
    await search.focus(); await expect(search).toBeFocused(); await expect(search).toHaveAttribute("aria-disabled", "false");
    await page.keyboard.press("Space"); // Native button activation; no React-hydration claim.
    await page.keyboard.press("Tab");
    const retry = page.getByRole("button", { name: text.retry, exact: true });
    await expect(retry).toBeFocused(); await expect(retry).toHaveAttribute("aria-disabled", "true");
    const boxRest = await boxes.nth(0).locator("+ span").evaluate((node) => getComputedStyle(node).boxShadow);
    await page.keyboard.press("Tab"); await expect(boxes.nth(0)).toBeFocused();
    await expect.poll(() => boxes.nth(0).locator("+ span").evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(boxRest);
    await page.keyboard.press("Space"); await expect(boxes.nth(0)).toBeChecked();
    await page.keyboard.press("Tab"); await expect(boxes.nth(1)).toBeFocused(); await page.keyboard.press("Space"); await expect(boxes.nth(1)).toBeChecked();
    // Unavailable Clear/Add stay real, focusable buttons (aria-disabled, never `disabled`).
    const clear = page.getByRole("button", { name: text.clear, exact: true }), add = page.getByRole("button", { name: text.add, exact: true });
    // Playwright's toBeDisabled() also honours aria-disabled, so assert the native property directly.
    await expect(clear).toHaveJSProperty("disabled", false); await expect(clear).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveJSProperty("disabled", false); await expect(add).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Tab");
    const more = page.getByRole("button", { name: text.more, exact: true });
    await expect(more).toBeFocused(); await expect(more).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Tab"); await expect(clear).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: text.close, exact: true })).toBeFocused();
    const addRest = await add.evaluate((node) => getComputedStyle(node).boxShadow);
    await page.keyboard.press("Tab"); await expect(add).toBeFocused(); await expect(add).toHaveAttribute("data-ui", "Button");
    await expect.poll(() => add.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(addRest);
  });
}

for (const locale of ["fi-FI", "en-GB"]) {
  test(`existing Studio cutoff keeps invalid/cleared feedback accessible ${locale}`, async ({ page }) => {
    const props = existingImageViewFixture(locale, { phase: "idle", rows: [], cutoff: "", badInput: true, selectionCleared: true, error: "cutoff" }), text = copy(locale);
    await page.setContent(studioDocument(locale, props));
    const cutoff = page.getByLabel(text.cutoff, { exact: true });
    await expect(cutoff).toHaveAttribute("aria-invalid", "true"); await expect(page.getByRole("alert")).toBeVisible();
    await expect(cutoff).toHaveAccessibleDescription(new RegExp("UTC")); await expect(page.getByRole("status")).toHaveText(text.cleared);
    await cutoff.focus(); await expect(cutoff).toBeFocused();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
}

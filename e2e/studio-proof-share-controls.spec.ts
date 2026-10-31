import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "vite";
import { test, expect } from "./support/fixtures";
import { proofPublishCopy } from "../studio/proof-publish";
import { clientGalleryShareCopy } from "../studio/client-gallery-share";
import type { FixtureOptions, mount, state, answer, copyDone } from "../studio/test-support/proof-share-browser";

declare global {
  interface Window { StudioDialogFixture: { mount: typeof mount; state: typeof state; answer: typeof answer; copyDone: typeof copyDone } }
}
const studioRequire = createRequire(resolve("studio/package.json"));
const reset = readFileSync(resolve(dirname(studioRequire.resolve("ui5/package.json")), "src/css/global/reset.css"), "utf8");
const uiStyles = readFileSync(resolve(dirname(studioRequire.resolve("@sanity/ui/package.json")), "dist/styles.css"), "utf8");
let script: string;
test.beforeAll(async () => {
  // Library mode leaves process.env in the bundle; development React reports markup errors to the console.
  const result = await build({ configFile: false, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("development") }, build: { write: false,
    lib: { entry: resolve("studio/test-support/proof-share-browser.tsx"), name: "StudioDialogFixture", formats: ["iife"] },
  } });
  const outputs = Array.isArray(result) ? result : [result];
  script = outputs.flatMap((output) => "output" in output ? output.output : []).filter((entry) => entry.type === "chunk").map((entry) => entry.code).join("\n");
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  // No navigation, remote fonts, clipboard API or publication endpoint is contacted.
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<html><head><style>${reset}${uiStyles}</style></head><body><div id="fixture"></div><input type="checkbox" aria-label="Raw reset witness"></body></html>`);
  // Negative control: the installed reset strips a raw checkbox of all native chrome, as in AB#413.
  const witness = page.getByRole("checkbox", { name: "Raw reset witness" });
  await expect(witness).toHaveCSS("appearance", "none"); await expect(witness).toHaveCSS("border-top-width", "0px");
  await witness.evaluate((node) => node.remove());
  await page.addScriptTag({ content: script });
  // Assert console errors after each test, including React markup/context failures.
  consoleErrors.set(page, errors);
});
const consoleErrors = new WeakMap<object, string[]>();
function mountFixture(page: Page, options: FixtureOptions) {
  return page.evaluate((value) => window.StudioDialogFixture.mount(value), options);
}
test.afterEach(async ({ page, externalRequests }) => { expect(consoleErrors.get(page)).toEqual([]); expect(externalRequests).toEqual([]); });

for (const locale of ["fi-FI", "en-US"]) for (const scheme of ["light", "dark"] as const) {
  const config = { locale, scheme, clipboard: "manual" } satisfies Omit<FixtureOptions, "kind">;
  test(`proof controls, validation and pending publication ${locale} ${scheme}`, async ({ page }) => {
    const copy = proofPublishCopy(locale);
    await mountFixture(page, { ...config, kind: "first" });
    const reminder = page.getByRole("checkbox", { name: copy.fields.reminder, exact: true });
    await expect(reminder).toBeChecked();
    const mark = reminder.locator("+ span");
    await expect(mark).toBeVisible();
    expect(await mark.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(10);
    await expect(mark).not.toHaveCSS("box-shadow", "none");
    const rest = await mark.evaluate((node) => getComputedStyle(node).boxShadow);
    await page.keyboard.press("Tab"); await reminder.focus();
    await expect.poll(() => mark.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(rest);
    await page.keyboard.press("Space"); await expect(reminder).not.toBeChecked();
    await expect(page.getByRole("textbox", { name: copy.fields.customerEmail, exact: true })).toHaveCount(0);
    await page.getByText(copy.fields.reminder, { exact: true }).click(); await expect(reminder).toBeChecked();
    await expect(page.getByRole("textbox", { name: copy.fields.reminderDays, exact: true })).toHaveValue("7");
    const included = page.getByRole("textbox", { name: copy.fields.includedCount, exact: true });
    await expect(included.locator("+ span")).not.toHaveCSS("box-shadow", "none");
    const inputRest = await included.locator("+ span").evaluate((node) => getComputedStyle(node).boxShadow);
    await page.keyboard.press("Tab"); await included.focus();
    await expect.poll(() => included.locator("+ span").evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(inputRest);
    const currency = page.getByRole("combobox", { name: copy.fields.currency, exact: true });
    await expect(currency).not.toHaveCSS("box-shadow", "none");
    const selectRest = await currency.evaluate((node) => getComputedStyle(node).boxShadow);
    // Real keyboard order from the included-count field to the currency select.
    await page.keyboard.press("Tab"); await expect(currency).toBeFocused(); await expect.poll(() => currency.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(selectRest);
    const publish = page.getByRole("button", { name: copy.send, exact: true });
    await publish.click(); await expect(included).toHaveAttribute("aria-invalid", "true");
    expect(await page.evaluate(() => window.StudioDialogFixture.state().requests)).toBe(0);
    await included.fill("2");
    await page.getByRole("textbox", { name: copy.fields.extraUnitPrice, exact: true }).fill("10");
    await page.getByRole("textbox", { name: copy.fields.jobReference, exact: true }).fill("synthetic-job");
    await reminder.uncheck();
    await publish.click();
    await expect(page.getByRole("button", { name: copy.sending, exact: true })).toBeDisabled();
    for (const role of ["textbox", "combobox", "checkbox"] as const) for (const control of await page.getByRole(role).all()) await expect(control).toBeDisabled();
    expect(await page.evaluate(() => window.StudioDialogFixture.state().requests)).toBe(1);
    await page.evaluate(() => window.StudioDialogFixture.answer("success"));
    const url = page.getByRole("textbox", { name: copy.url, exact: true });
    await expect(url).toHaveAttribute("readonly", ""); await expect(url).toBeFocused();
    await expect.poll(() => url.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart! === node.value.length)).toBe(true);
    await page.getByRole("combobox", { name: copy.language, exact: true }).selectOption("en");
    await expect(url).toHaveValue(/\?locale=en#select=/u);
    await page.getByRole("button", { name: copy.copy, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: copy.manual })).toBeVisible();
    await expect(url).toBeFocused();
    expect(await url.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart! === node.value.length)).toBe(true);
    expect(await page.evaluate(() => window.StudioDialogFixture.state().copiedMatches)).toBe(true);
  });

  test(`gallery link focus, language, copy and missing link ${locale} ${scheme}`, async ({ page }) => {
    const copy = clientGalleryShareCopy(locale);
    await mountFixture(page, { ...config, kind: "share" });
    const url = page.getByRole("textbox", { name: copy.url, exact: true });
    await expect(url).toHaveAttribute("readonly", ""); await expect(url).toBeFocused();
    await expect(url.locator("+ span")).not.toHaveCSS("box-shadow", "none");
    await expect.poll(() => url.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart! === node.value.length)).toBe(true);
    const language = page.getByRole("combobox", { name: copy.language, exact: true });
    await expect(language).not.toHaveCSS("box-shadow", "none"); await language.selectOption("en");
    await expect(url).toHaveValue(/\?locale=en$/u);
    const button = page.getByRole("button", { name: copy.copy, exact: true });
    await expect(button).toHaveAttribute("data-ui", "Button");
    const rest = await button.evaluate((node) => getComputedStyle(node).boxShadow);
    await language.focus(); await page.keyboard.press("Tab"); await expect(url).toBeFocused();
    await page.keyboard.press("Tab"); await expect(button).toBeFocused();
    await expect.poll(() => button.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(rest);
    await button.click(); await expect(page.getByRole("status")).toHaveText(copy.manual);
    await expect(url).toBeFocused();
    expect(await url.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart! === node.value.length)).toBe(true);
    await mountFixture(page, { ...config, clipboard: "pending", kind: "share" });
    await page.getByRole("button", { name: copy.copy, exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(copy.copying); await expect(page.getByRole("button", { name: copy.copy, exact: true })).toBeDisabled();
    await page.evaluate(() => window.StudioDialogFixture.copyDone()); await expect(page.getByRole("status")).toHaveText(copy.copied);
    expect(await page.evaluate(() => window.StudioDialogFixture.state().copiedMatches)).toBe(true);
    await mountFixture(page, { ...config, kind: "missing" });
    await expect(page.getByRole("status")).toHaveText(copy.unavailable); await expect(page.getByRole("button", { name: copy.copy, exact: true })).toBeDisabled();
  });
}

test("rotation and unknown publication keep their existing one-request boundary", async ({ page }) => {
  const copy = proofPublishCopy("en-US");
  await mountFixture(page, { kind: "rotate", locale: "en-US", scheme: "light", clipboard: "copied" });
  await page.getByRole("button", { name: copy.rotateConfirm, exact: true }).click();
  await expect(page.getByRole("button", { name: copy.rotating, exact: true })).toBeDisabled();
  await page.evaluate(() => window.StudioDialogFixture.answer("unknown"));
  await expect(page.getByRole("alert")).toHaveText(copy.unknown.rotate);
  await expect(page.getByRole("button", { name: copy.rotateConfirm, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.StudioDialogFixture.state().requests)).toBe(1);
});

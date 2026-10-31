import type { Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { test, expect } from "./support/fixtures";
import type { ProofDeleteDialogProps } from "../studio/proof-delete-dialog";
import type { ProofReopenDialogProps } from "../studio/proof-reopen-dialog";
import type { ProofReminderSettingsDialogProps } from "../studio/proof-reminder-settings-dialog";
import { proofDeleteCopy } from "../studio/proof-delete";
import { proofReopenCopy } from "../studio/proof-reopen";
import { proofReminderSettingsCopy } from "../studio/proof-reminder-settings";

type Scheme = "light" | "dark";
type Renderers = {
  renderProofDelete(props: ProofDeleteDialogProps, scheme?: Scheme): string;
  renderProofReopen(props: ProofReopenDialogProps, scheme?: Scheme): string;
  renderProofReminderSettings(props: ProofReminderSettingsDialogProps, scheme?: Scheme): string;
};
let server: ViteDevServer, render: Renderers;
const studioRequire = createRequire(resolve("studio/package.json"));
// The installed reset imported by sanity/lib/index.js -> ui5/styles.css, without its remote fonts.
const reset = readFileSync(resolve(dirname(studioRequire.resolve("ui5/package.json")), "src/css/global/reset.css"), "utf8");
const uiStyles = readFileSync(resolve(dirname(studioRequire.resolve("@sanity/ui/package.json")), "dist/styles.css"), "utf8");
test.beforeAll(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  render = await server.ssrLoadModule("/studio/test-support/render-studio-markup.tsx") as Renderers;
});
test.afterAll(async () => { await server?.close(); });

async function show(page: Page, locale: string, markup: string) {
  await page.setContent(`<!doctype html><html lang="${locale}"><head><style>${reset}${uiStyles}</style></head><body>${markup}<input type="checkbox" aria-label="Raw reset witness"></body></html>`);
  // Negative control: the installed reset strips a raw checkbox of all native chrome.
  const witness = page.getByRole("checkbox", { name: "Raw reset witness" });
  await expect(witness).toHaveCSS("appearance", "none"); await expect(witness).toHaveCSS("border-top-width", "0px");
  await witness.evaluate((node) => node.remove());
}
const shadow = (target: Locator) => target.evaluate((node) => getComputedStyle(node).boxShadow);
/** Tab from the current focus to `target` and see Studio's focus ring change on `ring`. */
async function tabTo(page: Page, target: Locator, ring: Locator = target) {
  await expect(ring).not.toHaveCSS("box-shadow", "none");
  const rest = await shadow(ring);
  await page.keyboard.press("Tab"); await expect(target).toBeFocused();
  await expect.poll(() => shadow(ring)).not.toBe(rest);
}
async function allDisabled(page: Page) {
  for (const role of ["textbox", "combobox", "checkbox", "button"] as const) {
    for (const control of await page.getByRole(role).all()) await expect(control).toBeDisabled();
  }
}

const noop = () => {};
const galleryId = "synthetic-proof";
const record = (id: string) => ({ id, revision: `r-${id}` });
const inventory = { galleryId, published: record(galleryId), terms: record("terms"), versions: [record("v1")], notices: [], reminders: [record("m1")],
  assets: [record("image-a")], sharedAssets: ["image-shared"] };
const deleteProps = (locale: string, extra: Partial<ProofDeleteDialogProps> = {}): ProofDeleteDialogProps => ({
  locale, galleryId, inputId: "delete-fixture", readiness: { ready: inventory }, typed: "", pending: false,
  onTyped: noop, onRemove: noop, onReload: noop, onClose: noop, ...extra,
});
const reminderProps = (locale: string, extra: Partial<ProofReminderSettingsDialogProps> = {}): ProofReminderSettingsDialogProps => ({
  locale, formId: "reminder-fixture", state: "ready", form: { on: true, delayDays: "7", customerEmail: "customer@example.test", locale: "" },
  invalid: [], pending: false, locales: ["fi", "en"], onForm: noop, onSave: noop, onClose: noop, ...extra,
});

// Actual components, installed UI theme/styles and Studio reset. No hydration, Studio session or hosted acceptance claim.
for (const locale of ["fi-FI", "en-GB"]) for (const scheme of ["light", "dark"] as const) {
  test(`reminder settings controls keep visible chrome and keyboard focus ${locale} ${scheme}`, async ({ page }) => {
    const copy = proofReminderSettingsCopy(locale);
    await show(page, locale, render.renderProofReminderSettings(reminderProps(locale, { invalid: ["customerEmail"] }), scheme));
    const on = page.getByRole("checkbox", { name: copy.on, exact: true });
    await expect(on).toBeChecked();
    const mark = on.locator("+ span");
    await expect(mark).toBeVisible(); expect(await mark.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(10);
    const delay = page.getByRole("textbox", { name: copy.delayDays, exact: true });
    const email = page.getByRole("textbox", { name: copy.customerEmail, exact: true });
    const language = page.getByRole("combobox", { name: copy.locale, exact: true });
    await expect(delay).toHaveValue("7"); await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription(copy.fieldError);
    await expect(language).toHaveValue(""); await expect(language.locator("option").first()).toHaveText("—");
    await on.focus(); await expect(on).toBeFocused();
    await tabTo(page, delay, delay.locator("+ span"));
    await tabTo(page, email, email.locator("+ span"));
    await tabTo(page, language);
    const save = page.getByRole("button", { name: copy.save, exact: true });
    await expect(save).toHaveAttribute("data-ui", "Button");
    await tabTo(page, save);
    await tabTo(page, page.getByRole("button", { name: copy.cancel, exact: true }));
    // Native checkbox activation on the static markup; React state is not hydrated here.
    await on.focus(); await page.keyboard.press("Space"); await expect(on).not.toBeChecked();
    await page.getByText(copy.on, { exact: true }).click(); await expect(on).toBeChecked();
    await show(page, locale, render.renderProofReminderSettings(reminderProps(locale, { pending: true }), scheme));
    await expect(page.getByRole("button", { name: copy.saving, exact: true })).toBeVisible();
    await allDisabled(page);
    await show(page, locale, render.renderProofReminderSettings(reminderProps(locale, { form: { on: false, delayDays: "", customerEmail: "", locale: "" } }), scheme));
    await expect(page.getByRole("textbox")).toHaveCount(0); await expect(page.getByRole("combobox")).toHaveCount(0);
    await show(page, locale, render.renderProofReminderSettings(reminderProps(locale, { state: "unreadable" }), scheme));
    await expect(page.getByRole("alert")).toHaveText(copy.unreadable);
    await expect(page.getByRole("button", { name: copy.close, exact: true })).toHaveAttribute("data-ui", "Button");
    await show(page, locale, render.renderProofReminderSettings(reminderProps(locale, { outcome: "saved" }), scheme));
    await expect(page.getByRole("status")).toHaveText(copy.saved); await expect(page.getByRole("button")).toHaveCount(1);
  });

  test(`proof deletion keeps its typed gate and visible controls ${locale} ${scheme}`, async ({ page }) => {
    const copy = proofDeleteCopy(locale);
    await show(page, locale, render.renderProofDelete(deleteProps(locale), scheme));
    const typed = page.getByRole("textbox", { name: copy.typeId.replace("{id}", galleryId), exact: true });
    const confirm = page.getByRole("button", { name: copy.confirm, exact: true });
    await expect(confirm).toBeDisabled(); await expect(confirm).toHaveAttribute("data-ui", "Button");
    await expect(typed.locator("+ span")).not.toHaveCSS("box-shadow", "none");
    const rest = await shadow(typed.locator("+ span"));
    await page.keyboard.press("Tab"); await expect(typed).toBeFocused();
    await expect.poll(() => shadow(typed.locator("+ span"))).not.toBe(rest);
    await page.keyboard.type(galleryId); await expect(typed).toHaveValue(galleryId);
    // Disabled confirmation is skipped by Tab; Cancel is the next stop.
    await tabTo(page, page.getByRole("button", { name: copy.cancel, exact: true }));
    // A separately rendered confirmed state; this fixture does not hydrate React.
    await show(page, locale, render.renderProofDelete(deleteProps(locale, { typed: ` ${galleryId} ` }), scheme));
    const enabled = page.getByRole("button", { name: copy.confirm, exact: true });
    await expect(enabled).toBeEnabled(); await enabled.focus(); await expect(enabled).toBeFocused();
    await show(page, locale, render.renderProofDelete(deleteProps(locale, { typed: galleryId, pending: true }), scheme));
    await expect(page.getByRole("button", { name: copy.working, exact: true })).toBeVisible(); await allDisabled(page);
    await show(page, locale, render.renderProofDelete(deleteProps(locale, { readiness: { reason: "referenced", ids: ["synthetic-ref"] } }), scheme));
    await expect(page.getByRole("alert")).toContainText("synthetic-ref");
    await expect(page.getByRole("button", { name: copy.reload, exact: true })).toBeEnabled();
    await show(page, locale, render.renderProofDelete(deleteProps(locale, { outcome: "deleted" }), scheme));
    await expect(page.getByRole("status")).toHaveText(copy.deleted);
    await expect(page.getByRole("button")).toHaveCount(1); await expect(page.getByRole("button", { name: copy.close, exact: true })).toBeVisible();
  });

  test(`proof reopen buttons keep visible chrome and keyboard order ${locale} ${scheme}`, async ({ page }) => {
    const copy = proofReopenCopy(locale), request = { id: "synthetic-selection", revision: "r1", latestVersion: 2 };
    const props: ProofReopenDialogProps = { locale, request, pending: false, onConfirm: noop, onClose: noop };
    await show(page, locale, render.renderProofReopen(props, scheme));
    await expect(page.getByText(copy.explain.replace("{next}", "3").replace("{current}", "2"), { exact: true })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: copy.confirm, exact: true }));
    await tabTo(page, page.getByRole("button", { name: copy.cancel, exact: true }));
    await show(page, locale, render.renderProofReopen({ ...props, pending: true }, scheme));
    await expect(page.getByRole("button", { name: copy.working, exact: true })).toBeVisible(); await allDisabled(page);
    await show(page, locale, render.renderProofReopen({ ...props, outcome: "conflict" }, scheme));
    await expect(page.getByRole("status")).toHaveText(copy.conflict);
    await expect(page.getByRole("button")).toHaveCount(1); await expect(page.getByRole("button", { name: copy.close, exact: true })).toBeVisible();
  });
}

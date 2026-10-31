import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { test, expect } from "./support/fixtures";
import type { DeliveryPublishDialogProps } from "../studio/client-gallery-publish-dialog";
import { deliveryCleanupCopy, deliveryPublishCopy } from "../studio/client-gallery-publish-copy";

let server: ViteDevServer, renderDialog: (props: DeliveryPublishDialogProps, scheme?: "light" | "dark") => string;
const studioRequire = createRequire(resolve("studio/package.json"));
// Import the installed reset used by sanity/lib/index.js -> ui5/styles.css, without its remote fonts.
const reset = readFileSync(resolve(dirname(studioRequire.resolve("ui5/package.json")), "src/css/global/reset.css"), "utf8");
const uiStyles = readFileSync(resolve(dirname(studioRequire.resolve("@sanity/ui/package.json")), "dist/styles.css"), "utf8");
function render(props: DeliveryPublishDialogProps, scheme: "light" | "dark" = "light") {
  return `<style>${reset}${uiStyles}</style>${renderDialog(props, scheme)}`;
}
test.beforeAll(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  renderDialog = (await server.ssrLoadModule("/studio/test-support/render-delivery-dialog.tsx")).renderDeliveryDialog;
});
test.afterAll(async () => { await server?.close(); });
const noop = () => {};
function fixture(locale: string, overrides: Partial<DeliveryPublishDialogProps> = {}): DeliveryPublishDialogProps {
  return { locale, prefix: "publish-fixture", proofId: "proof-fixture", typed: "", pending: false, ready: true, proofsEnabled: true,
    onMode: noop, onProofId: noop, onTyped: noop, onReview: noop, onSubmit: noop, onCheck: noop, onReset: noop, onClose: noop,
    ...overrides };
}
const review: DeliveryPublishDialogProps["review"] = { ready: {
  request: { id: "delivery-fixture", expectedRevision: "r1", proofId: "proof-fixture", proofsEnabled: true },
  target: { expiryInstant: "2027-04-24T12:00:00.000Z" }, mutations: [], selectionState: "confirmed",
  proof: { galleryId: "proof-fixture", published: { id: "proof-fixture", revision: "r2" }, terms: { id: "proofTerms.proof-fixture", revision: "r3" },
    selection: { id: "proofSelection.proof-fixture", revision: "r4" }, versions: [{ id: "proofSelection.proof-fixture.v1", revision: "r5" }],
    notices: [], reminders: [], assets: [{ id: "image-unused-10x10-webp", revision: "r6" }], sharedAssets: ["image-shared-10x10-webp"] },
} };

// Actual component, installed UI theme/styles and Studio reset. No hydration or hosted acceptance claim.
for (const locale of ["fi-FI", "en-GB"]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`controls retain visible chrome and keyboard focus under Studio reset ${locale} ${scheme}`, async ({ page }) => {
      const copy = deliveryPublishCopy(locale), cleanup = deliveryCleanupCopy(locale);
      const props = fixture(locale, { mode: "replacement", cleanup: { enroll: false, eligible: true, unreadable: false, loading: false } });
      await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(props, scheme)}<input type="checkbox" aria-label="Raw reset witness"></body></html>`);
      // This negative control reproduces the original bug: no UA chrome and no replacement graphic.
      const raw = page.getByRole("checkbox", { name: "Raw reset witness" });
      await expect(raw).toHaveCSS("appearance", "none");
      await expect(raw).toHaveCSS("border-top-width", "0px");
      const ordinary = page.getByRole("radio", { name: copy.ordinary, exact: true });
      const replacement = page.getByRole("radio", { name: copy.replacement, exact: true });
      const checkbox = page.getByRole("checkbox", { name: cleanup.choice, exact: true });
      for (const control of [ordinary, replacement, checkbox]) {
        // Sanity deliberately makes the native input transparent and paints its adjacent span.
        const mark = control.locator("+ span");
        await expect(mark).toBeVisible();
        expect(await mark.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(10);
        await expect(mark).not.toHaveCSS("box-shadow", "none");
      }
      expect(await replacement.locator("+ span").evaluate((node) => getComputedStyle(node, "::after").opacity)).toBe("1");
      await expect(checkbox).not.toBeChecked();
      const mark = checkbox.locator("+ span");
      const resting = await mark.evaluate((node) => getComputedStyle(node).boxShadow);
      await page.keyboard.press("Tab");
      await checkbox.focus();
      await expect(checkbox).toBeFocused();
      await expect.poll(() => mark.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(resting);
      await page.keyboard.press("Space");
      await expect(checkbox).toBeChecked();
      await page.getByText(cleanup.choice, { exact: true }).click();
      await expect(checkbox).not.toBeChecked();
      await page.getByText(copy.ordinary, { exact: true }).click();
      await expect(ordinary).toBeChecked();
      await expect(replacement).not.toBeChecked();
      const input = page.getByRole("textbox", { name: copy.proofId, exact: true });
      await expect(input.locator("+ span")).not.toHaveCSS("box-shadow", "none");
      const inputResting = await input.locator("+ span").evaluate((node) => getComputedStyle(node).boxShadow);
      await page.keyboard.press("Tab"); await input.focus();
      await expect.poll(() => input.locator("+ span").evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(inputResting);
      const reviewButton = page.getByRole("button", { name: copy.review, exact: true });
      await expect(reviewButton).toHaveAttribute("data-ui", "Button");
      const buttonResting = await reviewButton.evaluate((node) => getComputedStyle(node).boxShadow);
      await page.keyboard.press("Tab"); await expect(checkbox).toBeFocused();
      await page.keyboard.press("Tab"); await expect(reviewButton).toBeFocused();
      await expect.poll(() => reviewButton.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(buttonResting);
      await page.setContent(`<!doctype html><html><body>${render({ ...props, pending: true }, scheme)}</body></html>`);
      for (const role of ["radio", "checkbox", "textbox", "button"] as const) {
        for (const control of await page.getByRole(role).all()) await expect(control).toBeDisabled();
      }
    });
  }
  test(`cleanup choice and latest blocked status have labelled keyboard controls ${locale}`, async ({ page }) => {
    const copy = deliveryCleanupCopy(locale), publish = deliveryPublishCopy(locale);
    const props = fixture(locale, { mode: "ordinary", cleanup: { enroll: true, eligible: true, unreadable: false, loading: false,
      control: { _id: "clientGalleryCleanup." + "a".repeat(64), _type: "clientGalleryCleanup", version: 1, galleryId: "delivery-fixture", state: "enrolled",
        sourceDocumentId: "drafts.delivery-fixture", sourceRevision: "r1", publicationId: "p1", enrolledAt: "2026-10-24T12:00:00Z",
        policy: { handle: "1".repeat(32), expiryInstant: "2027-04-24T12:00:00Z", assetIds: [] }, lastResult: { reason: "gallery_variants", at: "2026-10-24T12:00:00Z" } },
    } });
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(props)}</body></html>`);
    await expect(page.getByRole("group", { name: copy.title, exact: true })).toBeVisible();
    await expect(page.getByText(copy.reasons.gallery_variants, { exact: false })).toBeVisible();
    const choice = page.getByRole("checkbox", { name: copy.choice, exact: true });
    await expect(choice).toBeChecked(); await choice.focus(); await page.keyboard.press("Space"); await expect(choice).not.toBeChecked();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: publish.review, exact: true })).toBeFocused();
    await expect(page.getByText(copy.limits, { exact: true })).toBeVisible();
  });
  test(`expired cleanup review and unreadable state are explicit ${locale}`, async ({ page }) => {
    const copy = deliveryCleanupCopy(locale), publish = deliveryPublishCopy(locale);
    const ready = { ...review!.ready, proof: undefined, cleanup: { enroll: true, expired: true, policyChanged: true } };
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(fixture(locale, { review: { ready } }))}</body></html>`);
    await expect(page.getByRole("alert")).toHaveText(copy.expired);
    await expect(page.getByText(copy.changed, { exact: true })).toBeVisible();
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(fixture(locale, { mode: "ordinary", cleanup: { enroll: false, eligible: true, unreadable: true, loading: false } }))}</body></html>`);
    await expect(page.getByRole("alert")).toHaveText(copy.unreadable);
    await expect(page.getByRole("checkbox", { name: copy.choice, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: publish.review, exact: true })).toBeDisabled();
  });
  test(`cleanup loading status never claims no enrollment before its read ${locale}`, async ({ page }) => {
    const copy = deliveryCleanupCopy(locale), publish = deliveryPublishCopy(locale);
    const props = fixture(locale, { mode: "ordinary", cleanup: { enroll: false, eligible: true, unreadable: false, loading: true } });
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(props)}</body></html>`);
    await expect(page.getByRole("status").filter({ hasText: copy.loading })).toBeVisible();
    await expect(page.getByText(`${copy.status}: ${copy.states.none}`, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: copy.choice, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: publish.review, exact: true })).toBeDisabled();
  });
  test(`delivery publication choice has explicit labelled keyboard controls ${locale}`, async ({ page }) => {
    const copy = deliveryPublishCopy(locale), props = fixture(locale, { mode: "replacement" });
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(props)}</body></html>`);
    await expect(page.getByRole("group", { name: copy.choose })).toBeVisible();
    const ordinary = page.getByRole("radio", { name: copy.ordinary, exact: true });
    const replacement = page.getByRole("radio", { name: copy.replacement, exact: true });
    await expect(replacement).toBeChecked(); await ordinary.focus(); await page.keyboard.press("Space"); await expect(ordinary).toBeChecked();
    const source = page.getByRole("textbox", { name: copy.proofId, exact: true });
    await source.focus(); await expect(source).toBeFocused(); await source.fill("proof-fixture");
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: copy.review, exact: true })).toBeFocused();
  });
  test(`replacement review names what is destroyed and requires typed confirmation ${locale}`, async ({ page }) => {
    const copy = deliveryPublishCopy(locale);
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(fixture(locale, { review }))}</body></html>`);
    await expect(page.getByText(copy.warning, { exact: true })).toBeVisible();
    await expect(page.getByText("2027-04-24T12:00:00.000Z", { exact: false })).toBeVisible();
    const confirm = page.getByRole("textbox", { name: copy.confirm.replace("{id}", "proof-fixture"), exact: true });
    await expect(page.getByRole("button", { name: copy.replacing, exact: true })).toBeDisabled();
    await confirm.focus(); await confirm.fill("proof-fixture"); await expect(confirm).toHaveValue("proof-fixture");
    // A separately rendered confirmed state; this fixture does not hydrate React.
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(fixture(locale, { review, typed: "proof-fixture" }))}</body></html>`);
    const publish = page.getByRole("button", { name: copy.replacing, exact: true });
    await expect(publish).toBeEnabled(); await publish.focus(); await expect(publish).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: copy.again, exact: true })).toBeFocused();
  });
  test(`unknown publication offers a read-only check and no publish retry ${locale}`, async ({ page }) => {
    const copy = deliveryPublishCopy(locale);
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${render(fixture(locale, { review, outcome: "uncertain" }))}</body></html>`);
    await expect(page.getByRole("status")).toHaveText(copy.uncertain);
    await expect(page.getByRole("button", { name: copy.replacing, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.again, exact: true })).toHaveCount(0);
    const check = page.getByRole("button", { name: copy.check, exact: true });
    await check.focus(); await expect(check).toBeFocused(); await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: copy.close, exact: true })).toBeFocused();
  });
}

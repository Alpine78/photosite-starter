import { createElement, type ComponentType } from "react";
import { createServer, type ViteDevServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect } from "./support/fixtures";
import type { DeliveryPublishDialogProps } from "../studio/client-gallery-publish-dialog";
import { deliveryCleanupCopy, deliveryPublishCopy } from "../studio/client-gallery-publish-copy";

let server: ViteDevServer, view: ComponentType<DeliveryPublishDialogProps>;
test.beforeAll(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  view = (await server.ssrLoadModule("/studio/client-gallery-publish-dialog.tsx")).DeliveryPublishDialog;
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

// Actual component markup/native controls. No hydration, authenticated Studio or hosted release claim.
for (const locale of ["fi-FI", "en-GB"]) {
  test(`cleanup choice and latest blocked status have labelled keyboard controls ${locale}`, async ({ page }) => {
    const copy = deliveryCleanupCopy(locale), publish = deliveryPublishCopy(locale);
    const props = fixture(locale, { mode: "ordinary", cleanup: { enroll: true, eligible: true, unreadable: false, loading: false,
      control: { _id: "clientGalleryCleanup." + "a".repeat(64), _type: "clientGalleryCleanup", version: 1, galleryId: "delivery-fixture", state: "enrolled",
        sourceDocumentId: "drafts.delivery-fixture", sourceRevision: "r1", publicationId: "p1", enrolledAt: "2026-10-24T12:00:00Z",
        policy: { handle: "1".repeat(32), expiryInstant: "2027-04-24T12:00:00Z", assetIds: [] }, lastResult: { reason: "gallery_variants", at: "2026-10-24T12:00:00Z" } },
    } });
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, props))}</body></html>`);
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
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, fixture(locale, { review: { ready } })))}</body></html>`);
    await expect(page.getByRole("alert")).toHaveText(copy.expired);
    await expect(page.getByText(copy.changed, { exact: true })).toBeVisible();
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, fixture(locale, { mode: "ordinary", cleanup: { enroll: false, eligible: true, unreadable: true, loading: false } })))}</body></html>`);
    await expect(page.getByRole("alert")).toHaveText(copy.unreadable);
    await expect(page.getByRole("checkbox", { name: copy.choice, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: publish.review, exact: true })).toBeDisabled();
  });
  test(`cleanup loading status never claims no enrollment before its read ${locale}`, async ({ page }) => {
    const copy = deliveryCleanupCopy(locale), publish = deliveryPublishCopy(locale);
    const props = fixture(locale, { mode: "ordinary", cleanup: { enroll: false, eligible: true, unreadable: false, loading: true } });
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, props))}</body></html>`);
    await expect(page.getByRole("status").filter({ hasText: copy.loading })).toBeVisible();
    await expect(page.getByText(`${copy.status}: ${copy.states.none}`, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: copy.choice, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: publish.review, exact: true })).toBeDisabled();
  });
  test(`delivery publication choice has explicit labelled keyboard controls ${locale}`, async ({ page }) => {
    const copy = deliveryPublishCopy(locale), props = fixture(locale, { mode: "replacement" });
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, props))}</body></html>`);
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
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, fixture(locale, { review })))}</body></html>`);
    await expect(page.getByText(copy.warning, { exact: true })).toBeVisible();
    await expect(page.getByText("2027-04-24T12:00:00.000Z", { exact: false })).toBeVisible();
    const confirm = page.getByRole("textbox", { name: copy.confirm.replace("{id}", "proof-fixture"), exact: true });
    await expect(page.getByRole("button", { name: copy.replacing, exact: true })).toBeDisabled();
    await confirm.focus(); await confirm.fill("proof-fixture"); await expect(confirm).toHaveValue("proof-fixture");
    // A separately rendered confirmed state; this fixture does not hydrate React.
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, fixture(locale, { review, typed: "proof-fixture" })))}</body></html>`);
    const publish = page.getByRole("button", { name: copy.replacing, exact: true });
    await expect(publish).toBeEnabled(); await publish.focus(); await expect(publish).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: copy.again, exact: true })).toBeFocused();
  });
  test(`unknown publication offers a read-only check and no publish retry ${locale}`, async ({ page }) => {
    const copy = deliveryPublishCopy(locale);
    await page.setContent(`<!doctype html><html lang="${locale}"><body>${renderToStaticMarkup(createElement(view, fixture(locale, { review, outcome: "uncertain" })))}</body></html>`);
    await expect(page.getByRole("status")).toHaveText(copy.uncertain);
    await expect(page.getByRole("button", { name: copy.replacing, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.again, exact: true })).toHaveCount(0);
    const check = page.getByRole("button", { name: copy.check, exact: true });
    await check.focus(); await expect(check).toBeFocused(); await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: copy.close, exact: true })).toBeFocused();
  });
}

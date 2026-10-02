import { getBuiltInLabels } from "@/lib/deployment-config";

import { appUnderTestEnvironment } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The customer proof selection / review / confirm journey (AB#130), against
 * the production build the harness serves.
 *
 * Every Vitest case around this already proves the store contract and the
 * route's request handling in isolation (`private-gallery-proof.test.ts`,
 * `.../proof/route.test.ts`); none of it proves a real browser can check a
 * box, see the summary update live, and land on a locked confirmed review.
 * `e2e/private-gallery-proof-api.spec.ts` covers the read-only wire contract
 * against the real development store.
 *
 * **This spec never mutates the shared development fixture.** The suite's own
 * contract is that "tests share no state, so they may run in any order and in
 * parallel" (`playwright.config.ts`) against *one* server process — the
 * fixture's proof gallery is a `globalThis` singleton for that whole process,
 * so an edit or confirm committed here would be visible, and wrong, to every
 * other spec and to a rerun of this one. The initial navigation and exchange
 * are real and read-only, exactly like the API spec; every interaction past
 * that point is answered by a `page.route` interception holding its own
 * closure-local state, so the real store is never written. The asset mint and
 * signed image bytes are also mocked; the fixture has no object store.
 */
const HANDLE = "IiIiIiIiIiIiIiIiIiIiIg";
const CAPABILITY = "Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4";
const GALLERY_PATH = `/private/${HANDLE}`;

const labels = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE as string,
).privateGalleryProof;

const FIXTURE_ITEMS = [
  { itemId: "memory-proof-01", reference: "001", filename: "IMG_0001.JPG", width: 1800, height: 1200 },
  { itemId: "memory-proof-02", reference: "002", filename: "IMG_0002.JPG", width: 1200, height: 1800 },
] as const;
const PRICING = { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR" };

function summary(selectedCount: number) {
  const extraCount = Math.max(0, selectedCount - PRICING.includedCount);
  return { ...PRICING, selectedCount, extraCount, extraTotalMinor: extraCount * PRICING.extraUnitPriceMinor };
}

/**
 * A closure-local stand-in for the proof store, driving `page.route` so the
 * real browser exercises the actual client component and its actual fetch
 * calls against a predictable, test-owned state instead of the shared fixture.
 */
async function mockProofMutations(page: import("@playwright/test").Page) {
  let revision = 0;
  let selected: string[] = [];
  let confirmed = false;
  let confirmedAt: string | undefined;

  function view(pageIndex: number) {
    return {
      revision,
      confirmed,
      ...(confirmed ? { confirmationVersion: 1, confirmedAt } : {}),
      items: FIXTURE_ITEMS.map((item) => ({
        itemId: item.itemId, width: item.width, height: item.height,
        derivativeKind: "watermarked-proof", reference: item.reference,
        filename: item.filename, selected: selected.includes(item.reference),
      })),
      selectedImages: selected.map((reference) => ({
        reference, filename: FIXTURE_ITEMS.find((i) => i.reference === reference)!.filename,
      })),
      summary: summary(selected.length),
      pageIndex, totalCount: FIXTURE_ITEMS.length, hasNextPage: false,
    };
  }

  await page.route(`**${GALLERY_PATH}/proof*`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const url = new URL(request.url());
      const pageIndex = Number(url.searchParams.get("page") ?? "0");
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, view: view(pageIndex) }) });
    }
    const body = JSON.parse(request.postData() ?? "{}") as {
      action: "edit" | "confirm"; expectedRevision: number; selectedReferences?: string[];
    };
    if (body.expectedRevision !== revision || confirmed) {
      return route.fulfill({ status: 409, contentType: "application/json",
        body: JSON.stringify({ ok: false, reason: "conflict" }) });
    }
    revision += 1;
    if (body.action === "edit") {
      selected = [...(body.selectedReferences ?? [])];
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, action: "edit", revision,
          selectedReferences: selected, summary: summary(selected.length) }) });
    }
    confirmed = true;
    confirmedAt = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, action: "confirm", revision,
        confirmationVersion: 1, confirmedAt, summary: summary(selected.length) }) });
  });
}

test.describe("private gallery proof selection", () => {
  test("selects photographs, reviews the summary, and confirms a locked selection", async ({
    page,
    browserName,
  }) => {
    // WebKit does not store a `Secure` cookie over this harness's plain-HTTP
    // loopback origin (see `private-gallery-link.spec.ts`), so the exchange
    // never lands on an authorized session there. A real deployment is HTTPS;
    // this is a harness limitation, not a product one, and Chromium already
    // exercises this whole flow.
    test.skip(
      browserName === "webkit",
      "WebKit does not store a Secure cookie over the harness's plain-HTTP loopback origin.",
    );

    const mintCounts = new Map<string, number>();
    const mintBodies: unknown[] = [];
    await page.route(`**${GALLERY_PATH}/asset`, async (route) => {
      const body = route.request().postDataJSON() as { kind: string; placementId: string };
      mintBodies.push(body);
      const count = (mintCounts.get(body.placementId) ?? 0) + 1;
      mintCounts.set(body.placementId, count);
      const origin = new URL(route.request().url()).origin;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true,
          url: `${origin}/mock-proof/${body.placementId}.svg?attempt=${count}`,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }) });
    });
    await page.route("**/mock-proof/*.svg*", async (route) => {
      const url = new URL(route.request().url());
      const attempt = Number(url.searchParams.get("attempt"));
      if ((url.pathname.endsWith("memory-proof-01.svg") && attempt === 1) ||
          (url.pathname.endsWith("memory-proof-02.svg") && attempt <= 2)) {
        return route.fulfill({ status: 403, body: "expired" });
      }
      const portrait = url.pathname.endsWith("memory-proof-02.svg");
      const width = portrait ? 1200 : 1800;
      const height = portrait ? 1800 : 1200;
      return route.fulfill({ status: 200, contentType: "image/svg+xml",
        headers: { "cache-control": "no-store" },
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#789"/></svg>`,
      });
    });

    await page.goto(`${GALLERY_PATH}#${CAPABILITY}`);
    await expect(
      page.getByRole("heading", { name: labels.heading }),
    ).toBeVisible();

    // Every reserved frame is at its own native ratio — this fixture mixes a
    // landscape and a portrait proof, so a cropping grid would fail here.
    const frames = page.locator("[data-item-id]");
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toHaveAttribute("data-aspect-width", "1800");
    await expect(frames.nth(0)).toHaveAttribute("data-aspect-height", "1200");
    await expect(frames.nth(1)).toHaveAttribute("data-aspect-width", "1200");
    await expect(frames.nth(1)).toHaveAttribute("data-aspect-height", "1800");
    const firstImage = page.getByRole("img", { name: "Watermarked landscape proof" });
    const secondImage = page.getByRole("img", { name: "Watermarked portrait proof" });
    await expect(firstImage).toHaveJSProperty("naturalWidth", 1800);
    await expect(firstImage).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(await firstImage.getAttribute("src")).toContain("/mock-proof/memory-proof-01.svg");
    const retryImage = page.getByRole("button", { name: labels.retryImage });
    await expect(retryImage).toBeVisible();
    expect(mintCounts.get("memory-proof-02")).toBe(2);
    await retryImage.click();
    await expect(secondImage).toHaveJSProperty("naturalHeight", 1800);
    await expect(page.getByRole("checkbox", { name: /002 — IMG_0002\.JPG/ })).not.toBeChecked();
    expect(mintCounts.get("memory-proof-01")).toBe(2);
    expect(mintCounts.get("memory-proof-02")).toBe(3);
    expect(mintBodies.filter((body) =>
      (body as { kind: string; placementId: string }).kind === "preview")).toHaveLength(5);

    await mockProofMutations(page);

    const first = page.getByRole("checkbox", { name: /001 — IMG_0001\.JPG/ });
    const second = page.getByRole("checkbox", { name: /002 — IMG_0002\.JPG/ });
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();

    await first.click();
    await expect(first).toBeChecked();
    await expect(page.getByRole("status").first()).toContainText("1 selected");

    await second.click();
    await expect(second).toBeChecked();
    await expect(page.getByRole("status").first()).toContainText("2 selected");

    const review = page.getByRole("heading", { name: labels.reviewHeading }).locator("..");
    await expect(review).toContainText(labels.includedLabel);
    await expect(review).toContainText(labels.extraCountLabel);
    await expect(review).toContainText(labels.extraPriceLabel);
    await expect(review).toContainText(labels.extraTotalLabel);
    await expect(review.locator("li").filter({ hasText: "001 — IMG_0001.JPG" })).toBeVisible();
    await expect(review.locator("li").filter({ hasText: "002 — IMG_0002.JPG" })).toBeVisible();
    await expect(review.locator("dl")).toContainText("2 selected");
    await expect(review.locator("dl")).toContainText("1");

    const confirmButton = page.getByRole("button", { name: labels.confirmSelection });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(
      page.getByRole("heading", { name: labels.confirmedHeading }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText("IMG_0001.JPG")).toBeVisible();
    await expect(page.getByText("IMG_0002.JPG")).toBeVisible();
    await expect(page.locator("dl")).toContainText(labels.extraCountLabel);
    await expect(page.locator("dl")).toContainText(labels.extraTotalLabel);
  });
});

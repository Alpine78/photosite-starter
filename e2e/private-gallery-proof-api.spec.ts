import { getBuiltInLabels } from "@/lib/deployment-config";

import { appUnderTestEnvironment, HARNESS_BASE_URL } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/** Published only in the harness's development-only memory store. */
const HANDLE = "IiIiIiIiIiIiIiIiIiIiIg";
const CAPABILITY = "Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4";
const GALLERY_PATH = `/private/${HANDLE}`;

test("proof API shares the exchanged session across route bundles", async ({ request }) => {
  const exchange = await request.post(`${GALLERY_PATH}/exchange`, {
    headers: { "content-type": "application/json", origin: HARNESS_BASE_URL },
    data: { capability: CAPABILITY },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain(`Path=${GALLERY_PATH}`);
  const cookie = setCookie.split(";", 1)[0];
  expect(cookie).toMatch(/^__Secure-pg_session=/);

  const page = await request.get(GALLERY_PATH, { headers: { cookie } });
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain(getBuiltInLabels(
    appUnderTestEnvironment.SITE_LOCALE as string,
  ).privateGalleryProof.heading);

  const proof = await request.get(`${GALLERY_PATH}/proof`, {
    headers: { cookie },
  });
  expect(proof.status()).toBe(200);
  expect(proof.headers()["cache-control"]).toBe("no-store");
  expect(proof.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(proof.headers()["referrer-policy"]).toBe("no-referrer");
  const body = await proof.json();
  expect(body).toMatchObject({ ok: true, view: {
    confirmed: false, totalCount: 2,
    summary: { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR" },
    items: [{ reference: "001" }, { reference: "002" }],
  } });
  expect(JSON.stringify(body)).not.toMatch(/objectKey|mediaId|nominalBytes|owner@example|galleryId/);
  expect(JSON.stringify(body)).not.toContain(CAPABILITY);
});

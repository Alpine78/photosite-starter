import { expect, test } from "./support/fixtures";
import { HARNESS_BASE_URL } from "./support/harness-environment";
const target = "/client-gallery/11111111111111111111111111111111";
for (const source of ["/retained-delivery-source", "/retained-delivery-source/"]) {
  test(`retained source ${source} moves in one hop and removes historical query values`, async ({ request }) => {
    const response = await request.get(source + "?password=synthetic-obsolete&cursor=synthetic-invalid&locale=fi", { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(new URL(response.headers()["location"], HARNESS_BASE_URL).href).toBe(new URL(target + "?locale=fi", HARNESS_BASE_URL).href);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    const page = await request.get(response.headers()["location"], { maxRedirects: 0 });
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('lang="fi"');
  });
}
test("retained source HEAD redirects; POST is refused without consuming data", async ({ request }) => {
  const head = await request.head("/retained-delivery-source", { maxRedirects: 0 });
  expect(head.status()).toBe(301); expect(new URL(head.headers()["location"], HARNESS_BASE_URL).href).toBe(new URL(target, HARNESS_BASE_URL).href);
  const post = await request.post("/retained-delivery-source", { data: { synthetic: "not customer content" }, maxRedirects: 0 });
  expect(post.status()).toBe(405); expect(post.headers()["allow"]).toBe("GET, HEAD"); expect(post.headers()["cache-control"]).toContain("no-store");
});
test("duplicate and unsupported locale values never survive a retained redirect", async ({ request }) => {
  for (const query of ["?locale=fi&locale=fi", "?locale=unsupported", "?locale=en-GB&password=synthetic"]) {
    const response = await request.get("/retained-delivery-source" + query, { maxRedirects: 0 });
    expect(response.status()).toBe(301); expect(new URL(response.headers()["location"], HARNESS_BASE_URL).href).toBe(new URL(target, HARNESS_BASE_URL).href);
  }
});

import { expect, test } from "./support/fixtures";

test("cleanup is off in the production harness and HEAD cannot invoke GET", async ({ request }) => {
  const get = await request.get("/api/client-gallery-cleanup");
  expect(get.status()).toBe(404);
  expect(get.headers()["cache-control"]).toContain("no-store");
  expect(await get.text()).toBe("");
  const head = await request.head("/api/client-gallery-cleanup");
  expect(head.status()).toBe(405);
  expect(head.headers()["allow"]).toBe("GET");
  expect(await head.text()).toBe("");
  const post = await request.post("/api/client-gallery-cleanup");
  expect(post.status()).toBe(405);
});

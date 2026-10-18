import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { expect, test as projectTest } from "./support/fixtures";
import { createMaintenanceGeneration } from "./support/maintenance-generation";
import { mockPolls } from "../src/lib/mock-polls";

const test = projectTest.extend<{ generation: Awaited<ReturnType<typeof createMaintenanceGeneration>> }>({
  generation: async ({}, provideGeneration, info) => {
    const generation = await createMaintenanceGeneration();
    try { await generation.start("off"); await provideGeneration(generation); }
    finally {
      await generation.stop();
      await info.attach("maintenance-generations", { body: JSON.stringify(generation.logs), contentType: "application/json" });
    }
  },
  baseURL: async ({ generation }, provideOrigin) => provideOrigin(generation.origin),
});

async function rawRequest(origin: string, path: string, method: "GET" | "HEAD" = "HEAD"): Promise<Buffer> {
  const url = new URL(origin);
  return new Promise((done, fail) => {
    const socket = connect(Number(url.port), url.hostname);
    const bytes: Buffer[] = [];
    socket.setTimeout(10_000, () => socket.destroy(new Error("Raw HTTP request timed out")));
    socket.on("error", fail);
    socket.on("data", (chunk) => bytes.push(chunk));
    socket.on("end", () => done(Buffer.concat(bytes)));
    socket.on("connect", () => socket.write(`${method} ${path} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`));
  });
}

test.describe("scriptless recovery", () => {
test.use({ javaScriptEnabled: false });
test("same-build maintenance gates readers and an already prepared write while preserving actual static bytes", async ({ generation, request, page }) => {
  // Multiple owned server generations are the behavior under test, not retries.
  test.setTimeout(120_000);
  const buildId = await readFile(".next/BUILD_ID", "utf8");
  const generatedRobots = await readFile(".next/server/app/robots.txt.body");
  const assetPath = "/gallery/coastal-landscape.1683eecb7e65.webp";
  const staticOff = await request.get(assetPath);
  expect(staticOff.status()).toBe(200);
  const assetHash = createHash("sha256").update(await staticOff.body()).digest("hex");
  const warmedRobots = await request.get("/robots.txt");
  expect(warmedRobots.status()).toBe(200);
  expect(await warmedRobots.text()).toContain("User-Agent:");
  const home = await request.get("/");
  expect(home.status()).toBe(200);
  const frameworkPath = /<script[^>]+src="(\/_next\/static\/[^"]+)"/.exec(await home.text())?.[1];
  expect(frameworkPath).toBeTruthy();
  const frameworkOff = await request.get(frameworkPath!);
  expect(frameworkOff.status()).toBe(200);
  const frameworkBytes = await frameworkOff.body();
  expect((await request.get("/fi")).status()).toBe(200);
  // A forged request fact must not select the fallback when maintenance is off.
  expect((await request.get("/", { headers: { "x-photosite-maintenance-fallback": "1" } })).status()).toBe(200);
  expect((await request.get("/gallery/not-a-file")).status()).toBe(404);
  expect((await request.get("/favicon.ico", { maxRedirects: 0 })).status()).toBe(307);

  const poll = mockPolls[0]!;
  const prepared = await request.get(`/api/poll-vote?pollId=${poll.pollId}&prepare=1`, { headers: { "x-poll-prepare": "1", "sec-fetch-site": "same-origin" } });
  expect(prepared.status()).toBe(200);
  expect(prepared.headers()["set-cookie"]).toContain("Secure");
  const cookie = prepared.headers()["set-cookie"]!.split(";")[0]!;
  const write = { headers: { origin: generation.origin, cookie }, data: { pollId: poll.pollId, optionId: poll.options[0]!.optionId } };
  const recorded = await request.post("/api/poll-vote", write);
  expect(recorded.status()).toBe(200);
  expect(await recorded.json()).toMatchObject({ status: "recorded" });
  await expect.poll(() => generation.output).toContain('"event":"poll.vote"');

  // Same immutable build and generated robots artifact; no new build between states.
  await generation.start("on", { SITE_CONTENT_SOURCE: "invalid-maintenance-control" });
  expect(await readFile(".next/BUILD_ID", "utf8")).toBe(buildId);
  expect(await readFile(".next/server/app/robots.txt.body")).toEqual(generatedRobots);
  const blockedPaths = ["/", "/fi", "/stories", "/fi/tarinat", "/unknown/path", "/x.html", "/gallery/not-a-file", "/gallery/missing-image.000000000000.webp", "/_next/not-a-file", "/_next/static/not-a-file.js", "/robots.txt", "/sitemap.xml", "/favicon.ico", "/client-gallery/11111111111111111111111111111111", "/private/test", "/admin/login"];
  for (const path of blockedPaths) {
    const response = await request.get(path, { maxRedirects: 0, headers: { "x-photosite-maintenance-fallback": "0", cookie: "maintenance=off" } });
    expect(response.status(), path).toBe(503);
    expect(response.headers()["cache-control"], path).toBe("no-store");
    expect(response.headers()["retry-after"], path).toBe("60");
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(response.headers()["content-security-policy"], path).toContain("default-src 'self'");
    expect(response.headers()["referrer-policy"], path).toBe("no-referrer");
    expect(response.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    expect(response.headers()["set-cookie"], path).toBeUndefined();
    expect(await response.text(), path).toContain("Temporarily unavailable");
  }
  for (const path of ["/%72obots.txt", "/%73itemap.xml", "/%66avicon.ico"]) {
    const wire = await rawRequest(generation.origin, path, "GET");
    const headerText = wire.subarray(0, wire.indexOf("\r\n\r\n")).toString();
    expect(headerText, path).toMatch(/^HTTP\/1\.1 503 /);
    expect(headerText, path).toMatch(/cache-control: no-store/i);
    expect(wire.toString(), path).toContain("Temporarily unavailable");
  }
  for (const path of ["/api/contact", "/api/enquiry", "/api/poll-vote", "/api/gallery", "/api/article-gallery", "/api/revalidate", "/api/search"]) {
    for (const method of ["GET", "HEAD", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
      const response = await request.fetch(path, { method, data: method === "POST" ? {} : undefined });
      expect(response.status(), `${method} ${path}`).toBe(503);
      expect(response.headers()["retry-after"]).toBe("60");
      if (method === "HEAD") expect(await response.body()).toHaveLength(0);
      else expect(await response.json()).toEqual({ status: "failed", retryable: true });
    }
  }
  expect((await request.post("/api/poll-vote", write)).status()).toBe(503);
  const routingHeaders: Record<string, string>[] = [{ RSC: "1", "Next-Router-Prefetch": "1" }, { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy" }];
  for (const headers of routingHeaders) {
    expect((await request.get("/stories", { headers })).status()).toBe(503);
  }
  for (const path of ["/stories/", "/stories//missing", "/stories\\missing"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(503);
  }
  // Send literal separators over TCP; URL clients can normalize before sending.
  for (const path of ["/stories//missing", "/stories\\missing", "//stories/missing"]) {
    const wire = await rawRequest(generation.origin, path, "GET");
    const headerText = wire.subarray(0, wire.indexOf("\r\n\r\n")).toString();
    const status = Number(/^HTTP\/1\.1 (\d+)/.exec(headerText)?.[1]);
    expect([308, 503], path).toContain(status);
    if (status === 308) {
      const location = /(?:^|\r\n)location:\s*([^\r\n]+)/i.exec(headerText)?.[1];
      expect(location).toBeTruthy();
      const target = new URL(location!, generation.origin);
      expect(target.origin).toBe(generation.origin);
      expect((await request.get(target.href)).status()).toBe(503);
    }
  }
  const staticOn = await request.get(assetPath);
  expect(staticOn.status()).toBe(200);
  expect(createHash("sha256").update(await staticOn.body()).digest("hex")).toBe(assetHash);
  expect(staticOn.headers()["cache-control"]).toBe("no-store");
  const frameworkOn = await request.get(frameworkPath!);
  expect(frameworkOn.status()).toBe(200);
  expect(await frameworkOn.body()).toEqual(frameworkBytes);
  expect(frameworkOn.headers()["cache-control"]).toBe("no-store");
  const optimized = await request.get(`/_next/image?url=${encodeURIComponent(assetPath)}&w=384&q=75`);
  expect(optimized.status()).toBe(200); // Optimizer keeps its own cache policy.
  const navigation = await page.goto("/fi/tarinat");
  expect(navigation?.status()).toBe(503);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tilapäinen huoltotauko");
  await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
  expect(await page.locator("script, img, form").count()).toBe(0);
  for (const path of ["/", "/gallery/missing-image.000000000000.webp", "/api/poll-vote?pollId=demo-poll-open&prepare=1"]) {
    const wire = await rawRequest(generation.origin, path);
    const boundary = wire.indexOf("\r\n\r\n");
    expect(boundary).toBeGreaterThan(0);
    const headers = wire.subarray(0, boundary).toString();
    expect(headers).toContain("503");
    expect(headers).toMatch(/retry-after: 60/i);
    expect(headers).not.toMatch(/set-cookie:/i);
    expect(wire.subarray(boundary + 4)).toHaveLength(0);
  }
  await generation.stop();
  expect(generation.logs.at(-1)!.output).not.toContain('"event":"poll.vote"');
  expect(generation.logs.at(-1)!.output).not.toContain("invalid-maintenance-control");

  await generation.start("invalid-attempt", { SITE_CONTENT_SOURCE: "invalid-maintenance-control" });
  expect((await request.get("/")).status()).toBe(503);
  expect((await request.get("/gallery/not-a-file")).status()).toBe(503);
  await generation.start("off", { NEXT_PUBLIC_SITE_MAINTENANCE_MODE: "off" });
  expect((await request.get("/")).status()).toBe(503);
  await generation.start("off");
  expect((await request.get("/")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
  expect((await request.get("/gallery/not-a-file")).status()).toBe(404);
});
});

test("an existing JavaScript client falls back to a maintenance document on cold navigation", async ({ generation, page }) => {
  test.setTimeout(90_000);
  // Exclude already delivered browser-prefetch bytes from this cold-navigation
  // assertion. Maintenance cannot revoke a payload that the browser already has.
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === generation.origin && request.headers()["next-router-prefetch"] === "1") await route.abort();
    else await route.fallback();
  });
  await page.goto("/");
  const link = page.locator('a[href="/stories"]:visible').first();
  await link.focus();
  await expect(link).toBeFocused();
  await generation.start("on");
  const failedRsc = page.waitForResponse((response) => new URL(response.url()).pathname === "/stories" && response.request().headers().rsc === "1");
  await page.keyboard.press("Enter");
  expect((await failedRsc).status()).toBe(503);
  await expect(page).toHaveURL(`${generation.origin}/stories`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tilapäinen huoltotauko");
  await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
});

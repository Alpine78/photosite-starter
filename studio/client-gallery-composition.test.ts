import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";

// Root Vitest supplies the real application aliases and server-only marker stub.
// Only HTTP is replaced: configuration, factories and both transports stay real.
const handle = "a".repeat(32), id = "composition-gallery";
const instant = "2026-10-17T00:00:00.000Z";
const hash = "1".repeat(40), assetId = `image-${hash}-1600x1000-webp`;
const origin = "https://composition1.api.sanity.io";
const apiPath = "/v2026-06-24/data/";
const setting = /^(?:SITE_|SANITY_|LEGACY_GALLERY_|CLIENT_GALLERY_|PRIVATE_GALLERY_|AWS_|S3_|POSTGRES_|PG|DATABASE_|VERCEL_|NEXT_PUBLIC_)/u;
type Document = Record<string, unknown>;
function gallery(): Document {
  const text = (language: string, value: string) => ({ _key: language, _type: "localizedText", language, value });
  return { _id: id, _type: "clientDeliveryGallery", _rev: "revision1", handle,
    available: true, availabilityMode: "indefinite", title: [text("fi", "Toimitus"), text("en", "Delivery")],
    items: [{ _key: "first", _type: "clientDeliveryItem", mediaType: "image",
      image: { _type: "image", asset: { _type: "reference", _ref: assetId } },
      alt: [text("fi", "Rannikko"), text("en", "Coast")] }] };
}
const asset = { _id: assetId, _type: "sanity.imageAsset", sha1hash: hash,
  extension: "webp", mimeType: "image/webp", metadata: { dimensions: { width: 1600, height: 1000 } } };
let previousFetch: typeof fetch, previousEnvironment: Record<string, string | undefined>;
let unexpected: string[], calls: string[], indexed: Document[], fresh: Document | undefined;
let failure: "query" | "doc" | undefined;
const canary = "SYNTHETIC-PROVIDER-DETAIL-DO-NOT-PROPAGATE";

beforeEach(() => {
  previousFetch = globalThis.fetch;
  previousEnvironment = { ...process.env };
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(instant));
  for (const name of Object.keys(process.env).filter((name) => setting.test(name))) vi.stubEnv(name, undefined);
  const environment = {
    SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production", SITE_CONTENT_SOURCE: "sanity",
    SITE_LOCALE: "en-GB", SITE_LOCALE_ROUTES: "en-GB||stories,fi|fi|tarinat",
    SITE_CANONICAL_BASE_URL: "https://composition.example.test",
    SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
    SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536", SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
    SANITY_PROJECT_ID: "composition1", SANITY_DATASET: "fixture", SANITY_DATASET_VISIBILITY: "public",
    SANITY_API_VERSION: "v2026-06-24", CLIENT_GALLERY_ADAPTER: "sanity", LEGACY_GALLERY_ADAPTER: "off",
  };
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  unexpected = []; calls = []; failure = undefined; fresh = gallery(); indexed = [structuredClone(fresh), asset];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    try {
      // Request normalizes string, URL and Request inputs and inherited options.
      const request = new Request(input, init), url = new URL(request.url);
      expect(url.origin).toBe(origin); expect(request.method).toBe("GET");
      expect(request.cache).toBe("no-store"); expect(request.redirect).toBe("manual");
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("accept")).toBe("application/json");
      expect(request.signal.aborted).toBe(false);
      let kind: "query" | "doc";
      if (url.pathname === `${apiPath}query/fixture`) {
        kind = "query";
        expect(url.searchParams.get("perspective")).toBe("published");
        expect(url.searchParams.get("returnQuery")).toBe("false");
        expect(url.searchParams.get("tag")).toBe("client.gallery");
        expect(JSON.parse(url.searchParams.get("$handle")!)).toBe(handle);
      } else {
        expect(url.pathname).toBe(`${apiPath}doc/fixture/${id}`);
        expect(url.search).toBe("?includeAllVersions=false"); kind = "doc";
      }
      calls.push(kind);
      if (failure === kind) return new Response(canary, { status: 503, headers: { "x-fixture-detail": canary } });
      if (kind === "doc") return Response.json({ documents: fresh === undefined ? [] : [fresh] });
      const params = Object.fromEntries([...url.searchParams].filter(([key]) => key.startsWith("$"))
        .map(([key, value]) => [key.slice(1), JSON.parse(value)]));
      // Fixtures contain published root documents only. Provider perspective/ACL
      // enforcement is not simulated or claimed by this in-memory evaluator.
      const result = await evaluate(parse(url.searchParams.get("query")!), { dataset: indexed, params, timestamp: new Date(instant) });
      return Response.json({ result: await result.get() });
    } catch (error) {
      unexpected.push("Unexpected HTTP request or broken fixture assertion"); throw error;
    }
  }));
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); vi.resetModules();
  expect(unexpected).toEqual([]);
  expect(globalThis.fetch).toBe(previousFetch);
  // Boolean comparison avoids printing ambient environment values on a failure.
  expect(JSON.stringify(Object.entries(process.env).sort()) === JSON.stringify(Object.entries(previousEnvironment).sort())).toBe(true);
});

describe("production unlisted Sanity composition without private services", () => {
  it.each([["fi-FI", "Toimitus", "Rannikko"], ["en-GB", "Delivery", "Coast"]])("serves %s through real configuration and HTTP transports", async (language, title, alt) => {
    const { getClientGallery } = await import("../src/lib/client-gallery-access");
    const { getDeploymentConfig } = await import("../src/lib/deployment-config");
    expect(getDeploymentConfig()).toMatchObject({ stage: "production", contentSource: "sanity", privateGallery: { store: "off" } });
    expect(Object.keys(process.env).filter((name) => /^(?:PRIVATE_GALLERY_|AWS_|S3_|POSTGRES_|PG|DATABASE_)/u.test(name))).toEqual([]);
    expect(process.env.SANITY_READ_TOKEN).toBeUndefined();
    const view = await getClientGallery(handle, language);
    expect(view).toEqual({ kind: "web", title, images: [{ itemId: "first", mediaId: expect.stringMatching(/^client-[a-f0-9]{64}$/u),
      src: `https://cdn.sanity.io/images/composition1/fixture/${hash}-1600x1000.webp`,
      width: 1600, height: 1000, alt, enquiryAllowed: false }] });
    expect(calls).toEqual(["query", "doc"]);
  });
  it("observes a published pause and resumption despite stale discovery, without caching the view", async () => {
    const { getClientGallery } = await import("../src/lib/client-gallery-access");
    expect(await getClientGallery(handle, "fi")).toBeDefined();
    fresh = { ...gallery(), available: false, _rev: "revision2" };
    expect(await getClientGallery(handle, "fi")).toBeUndefined();
    fresh = gallery();
    expect(await getClientGallery(handle, "fi")).toBeDefined();
    expect(calls).toEqual(["query", "doc", "query", "doc", "query", "doc"]);
  });
  it("refuses an unpublished document on the next read even while discovery retains it", async () => {
    const { getClientGallery } = await import("../src/lib/client-gallery-access");
    expect(await getClientGallery(handle, "fi")).toBeDefined(); fresh = undefined;
    expect(await getClientGallery(handle, "fi")).toBeUndefined();
    expect(calls).toEqual(["query", "doc", "query", "doc"]);
  });
  it("stops at the exact deadline even with unchanged indexed and Doc revisions", async () => {
    fresh = { ...gallery(), availabilityMode: "until", expiryInstant: "2026-10-17T00:00:01Z" };
    indexed = [structuredClone(fresh), asset];
    const { getClientGallery } = await import("../src/lib/client-gallery-access");
    expect(await getClientGallery(handle, "fi")).toMatchObject({ availableUntil: "2026-10-17T00:00:01Z" });
    vi.setSystemTime(new Date("2026-10-17T00:00:01Z"));
    expect(await getClientGallery(handle, "fi")).toBeUndefined();
    expect(calls).toEqual(["query", "doc", "query", "doc"]);
  });
  it.each(["query", "doc"] as const)("propagates classified %s failure without provider detail or another service", async (kind) => {
    failure = kind; const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getClientGallery } = await import("../src/lib/client-gallery-access");
    const { SanityQueryError } = await import("../src/lib/sanity-client");
    const error = await getClientGallery(handle, "fi").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SanityQueryError);
    if (!(error instanceof SanityQueryError)) throw new Error("Expected a classified Sanity failure");
    expect(error).toMatchObject({ errorClass: "unavailable", retryable: true });
    expect(error).not.toHaveProperty("cause");
    expect(`${String(error)} ${error.stack} ${JSON.stringify(error)} ${JSON.stringify(log.mock.calls)}`).not.toContain(canary);
    expect(calls).toEqual(kind === "query" ? ["query"] : ["query", "doc"]);
  });
  it("makes no request with both unlisted adapters off and no Sanity credentials/configuration", async () => {
    vi.stubEnv("CLIENT_GALLERY_ADAPTER", "off");
    for (const name of Object.keys(process.env).filter((name) => name.startsWith("SANITY_"))) vi.stubEnv(name, undefined);
    const { getClientGallery } = await import("../src/lib/client-gallery-access");
    expect(await getClientGallery(handle, "fi")).toBeUndefined(); expect(calls).toEqual([]);
  });
});

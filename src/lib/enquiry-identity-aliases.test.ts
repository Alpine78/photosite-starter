import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyEnquiryFailure,
  createEnquiryTargetResolver,
  type EnquiryTargetRequest,
} from "@/lib/enquiry-media";
import { createDeploymentIdentityAliasLoader, IdentityAliasDeploymentError } from "@/lib/identity-alias-deployment";
import { createIdentityAliasResolver, IdentityAliasError } from "@/lib/identity-aliases";
import { SanityIdentityAliasError } from "@/lib/sanity-identity-aliases";
import * as content from "@/lib/content";
import { resolveSanityEnquiryTarget } from "@/lib/sanity-enquiry-media";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { appUnderTestEnvironment } from "../../e2e/support/harness-environment";
import type { SanityClient } from "@/lib/sanity-client";

const config = vi.hoisted(() => ({ localeRoutes: undefined as unknown as ReturnType<typeof buildLocaleRouteConfig>, contentSource: "mock" }));
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => config }));
config.localeRoutes = buildLocaleRouteConfig({
  locales: [{ locale: "en-GB", prefix: null, storyNamespace: "stories" }, { locale: "fi-FI", prefix: "fi", storyNamespace: "tarinat" }],
  reservedRootSegments: ["services", "contact"], reservedLocaleRouteSegments: ["services", "contact"],
});
const CONTENT = "content-selected-work";
const ITEM = "selected-work-coastal-landscape";
const curated = (contentId = CONTENT, itemId = ITEM, locale = "en-GB"): EnquiryTargetRequest => ({ kind: "curated", locale, contentId, itemId });
const sourceSha = "a".repeat(64);
type Mode = "renamed" | "restored";
function fixture(mode: Mode = "renamed") {
  const pairs = [
    ["contentId", CONTENT, "legacy-selected-gallery"],
    ["contentId", "content-coastal-mornings", "legacy-coastal-gallery"],
    ["contentId", "content-unpublished-gallery-draft", "legacy-unpublished"],
    ["placementId", ITEM, "legacy-selected-photo"],
    ["placementId", "coastal-mornings-coastal-landscape", "legacy-coastal-photo"],
    ["placementId", "coastal-landscape", "do-not-map-dynamic-media"],
    ["placementId", "capture-sequence-0002", "do-not-map-capture-media"],
  ] as const;
  const aliases = pairs.map(([field, canonical, other]) => {
    // Real media identities must be lookup KEYS in each active direction,
    // while normal content/placement rows resolve toward existing fixtures.
    const mediaCollision = canonical === "coastal-landscape" || canonical === "capture-sequence-0002";
    const from = mediaCollision ? canonical : other;
    const to = mediaCollision ? other : canonical;
    return { field, newId: mode === "renamed" ? to : from, oldId: mode === "renamed" ? from : to };
  });
  const payload = { aliases, formatVersion: "identity-aliases-v1", sourceMapSha256: sourceSha };
  const environment: Record<string, string | undefined> = {
    SITE_IDENTITY_ALIAS_MODE: mode, SITE_IDENTITY_ALIAS_DOCUMENT_ID: "fixture-aliases",
    SITE_IDENTITY_ALIAS_SOURCE_MAP_SHA256: sourceSha,
    SITE_IDENTITY_ALIAS_PAYLOAD_SHA256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    SITE_IDENTITY_ALIAS_ROW_COUNT: String(aliases.length),
    SANITY_PROJECT_ID: "fixture-project", SANITY_DATASET: "content", SANITY_DATASET_VISIBILITY: "public", SANITY_API_VERSION: "v2020-01-01",
  };
  const response = () => new Response(JSON.stringify({ result: [{ ...payload, _id: "fixture-aliases", _type: "identityAliasSet", _rev: "fixture-rev", _createdAt: "2020-01-01T00:00:00Z", _updatedAt: "2020-01-01T00:00:00Z" }] }));
  const fetcher = vi.fn<typeof fetch>(async () => response());
  const construct = vi.fn(() => createDeploymentIdentityAliasLoader(environment, fetcher));
  const collisionControl = () => createIdentityAliasResolver({ mode, payload, pins: {
    sourceMapSha256: sourceSha, payloadSha256: environment.SITE_IDENTITY_ALIAS_PAYLOAD_SHA256!, expectedRowCount: aliases.length,
  } });
  return { environment, fetcher, construct, response, collisionControl, resolve: createEnquiryTargetResolver(construct) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("captured enquiry identity generation", () => {
  it.each(["renamed", "restored"] as const)("resolves both spellings before public authorization in %s", async (mode) => {
    const f = fixture(mode);
    const targets = await Promise.all([
      f.resolve(curated("legacy-selected-gallery", "legacy-selected-photo")),
      f.resolve(curated()),
      f.resolve(curated("legacy-coastal-gallery", "legacy-coastal-photo")),
    ]);
    expect(targets[0]).toEqual(targets[1]);
    expect(targets[0]).toMatchObject({ contentId: CONTENT, placementId: ITEM, mediaId: "coastal-landscape", caption: "Quiet coast" });
    expect(targets[2]).toMatchObject({ contentId: "content-coastal-mornings", placementId: "coastal-mornings-coastal-landscape", mediaId: "coastal-landscape", caption: "First light" });
    expect(f.construct).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(1);
    const request = f.fetcher.mock.calls[0];
    expect(request[1]).toMatchObject({ cache: "no-store" });
    expect(request[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("captures settings on the first lookup and retains them after caller mutation", async () => {
    const f = fixture();
    const pending = f.resolve(curated("legacy-selected-gallery", "legacy-selected-photo"));
    f.environment.SITE_IDENTITY_ALIAS_MODE = "invalid";
    f.environment.SANITY_PROJECT_ID = "changed";
    await expect(pending).resolves.toMatchObject({ contentId: CONTENT, placementId: ITEM });
    await expect(f.resolve(curated())).resolves.toMatchObject({ contentId: CONTENT });
    expect(f.construct).toHaveBeenCalledTimes(1);
  });

  it("legacy reads no CMS settings and performs no alias fetch", async () => {
    const environment = { SITE_IDENTITY_ALIAS_MODE: "legacy" };
    const getter = vi.fn(() => { throw Error("private-sentinel"); });
    Object.defineProperty(environment, "SANITY_PROJECT_ID", { enumerable: true, get: getter });
    const fetcher = vi.fn<typeof fetch>();
    const construct = vi.fn(() => createDeploymentIdentityAliasLoader(environment, fetcher));
    const resolve = createEnquiryTargetResolver(construct);
    expect(construct).not.toHaveBeenCalled();
    await expect(resolve(curated())).resolves.toMatchObject({ placementId: ITEM });
    expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, {}, curated(CONTENT, "Bad-ID"), curated(CONTENT, ITEM, "en"), curated(CONTENT, ITEM, "de-DE"), curated(CONTENT, "x".repeat(257)), { ...curated(), itemId: [ITEM, ITEM] }])("rejects malformed or unsupported requests before alias IO (%j)", async (input) => {
    const f = fixture();
    await expect(f.resolve(input)).rejects.toMatchObject({ rejection: "malformed-request" });
    expect(f.construct).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(["legacy", "renamed", "restored"] as const)("retains the shared inclusive256 identity bound in %s", async (mode) => {
    const f = fixture(mode === "legacy" ? "renamed" : mode);
    if (mode === "legacy") { for (const key of Object.keys(f.environment)) if (key.startsWith("SITE_IDENTITY_ALIAS_")) delete f.environment[key]; }
    await expect(f.resolve(curated("x".repeat(256)))).rejects.toMatchObject({ rejection: "container-unavailable" });
    await expect(f.resolve(curated(CONTENT, "x".repeat(256)))).rejects.toMatchObject({ rejection: "unknown-item" });
    expect(f.fetcher).toHaveBeenCalledTimes(mode === "legacy" ? 0 : 1);
  });

  it.each(["renamed", "restored"] as const)("never translates capture or dynamic media in %s", async (mode) => {
    const f = fixture(mode);
    expect(f.collisionControl()("placementId", "coastal-landscape")).toBe("do-not-map-dynamic-media");
    expect(f.collisionControl()("placementId", "capture-sequence-0002")).toBe("do-not-map-capture-media");
    await expect(f.resolve({ kind: "dynamic", locale: "en-GB", itemId: "coastal-landscape" })).resolves.toMatchObject({ kind: "dynamic", mediaId: "coastal-landscape" });
    expect(f.construct).not.toHaveBeenCalled();
    await expect(f.resolve(curated("content-capture-sequence", "capture-sequence-0002"))).resolves.toMatchObject({ kind: "curated", contentId: "content-capture-sequence", mediaId: "capture-sequence-0002" });
    const capture = await f.resolve(curated("content-capture-sequence", "capture-sequence-0002"));
    expect(capture).not.toHaveProperty("placementId");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  for (const mode of ["renamed", "restored"] as const) {
  it.each([
    ["legacy-unpublished", ITEM, "en-GB", "container-unavailable"],
    ["legacy-selected-gallery", "coastal-mornings-coastal-landscape", "en-GB", "unknown-item"],
    ["content-polar-night-sessions", "polar-night-hidden-occurrence", "en-GB", "container-unavailable"],
    ["legacy-selected-gallery", "selected-work-lichen-stones", "en-GB", "not-public"],
    ["legacy-selected-gallery", "selected-work-lakeside-reeds", "en-GB", "not-enquirable"],
    ["content-layout-single", "any-valid-id", "en-GB", "not-enquirable"],
  ])(`aliases do not authorize %s/%s/%s in ${mode}`, async (content, item, locale, rejection) => {
    await expect(fixture(mode).resolve(curated(content, item, locale))).rejects.toMatchObject({ rejection });
  });
  }

  it("does not invent a missing configured-language container", async () => {
    const trees = await content.getContentTrees();
    vi.spyOn(content, "getContentTrees").mockResolvedValue(new Map([...trees].filter(([locale]) => locale !== "fi-FI")));
    const f = fixture();
    await expect(f.resolve(curated("legacy-selected-gallery", "legacy-selected-photo", "fi-FI"))).rejects.toMatchObject({ rejection: "container-unavailable" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["record-shape", "record-metadata", "alias-payload"] as const)("preserves actual loader %s as malformed-source", async (failure) => {
    const f = fixture();
    const valid = await f.response().json();
    if (failure === "record-shape") valid.result = [];
    if (failure === "record-metadata") valid.result[0]._id = "wrong-document";
    if (failure === "alias-payload") valid.result[0].aliases[0].newId = "unexpected-valid-id";
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify(valid)));
    await expect(f.resolve(curated())).rejects.toMatchObject({ rejection: "malformed-source" });
    await expect(f.resolve(curated())).rejects.toMatchObject({ rejection: "malformed-source" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("holds synchronous configuration failure until explicit factory recreation", async () => {
    const f = fixture(); f.environment.SITE_IDENTITY_ALIAS_ROW_COUNT = "bad-private-sentinel";
    await expect(f.resolve(curated())).rejects.toMatchObject({ rejection: "source-error" });
    f.environment.SITE_IDENTITY_ALIAS_ROW_COUNT = "7";
    await expect(f.resolve(curated())).rejects.toMatchObject({ rejection: "source-error" });
    expect(f.construct).toHaveBeenCalledTimes(1); expect(f.fetcher).not.toHaveBeenCalled();
    await expect(createEnquiryTargetResolver(f.construct)(curated())).resolves.toMatchObject({ placementId: ITEM });
    expect(f.construct).toHaveBeenCalledTimes(2);
  });

  it("holds failed shared transport until explicit recreation and never echoes its cause", async () => {
    const f = fixture(); f.fetcher.mockRejectedValueOnce(new Error("private-sentinel"));
    for (let i = 0; i < 2; i++) {
      await expect(f.resolve(curated())).rejects.toMatchObject({ rejection: "source-error", message: "[enquiry-media] a content-store read failed in a way a retry cannot fix" });
    }
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await expect(createEnquiryTargetResolver(f.construct)(curated())).resolves.toMatchObject({ placementId: ITEM });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("redacts an unexpected loader failure without retrying or falling back", async () => {
    const construct = vi.fn(() => { throw new Error("private-sentinel"); });
    const resolve = createEnquiryTargetResolver(construct);
    for (let i = 0; i < 2; i++) await expect(resolve(curated())).rejects.toMatchObject({ rejection: "source-error" });
    expect(construct).toHaveBeenCalledTimes(1);
  });

  it.each([
    new IdentityAliasDeploymentError(), new IdentityAliasError("configuration"),
    new SanityIdentityAliasError("configuration"), new SanityIdentityAliasError("transport"),
    new SanityIdentityAliasError("record-shape"), new SanityIdentityAliasError("record-metadata"), new SanityIdentityAliasError("alias-payload"),
  ])("classifies alias errors structurally with static classes: %s", (error) => {
    const duplicateModuleError = Object.assign(new Error(error.message), { name: error.name, ...(error instanceof SanityIdentityAliasError ? { rejection: error.rejection } : {}) });
    const expected = error instanceof SanityIdentityAliasError && ["record-shape", "record-metadata", "alias-payload"].includes(error.rejection) ? "malformed-source" : "source-error";
    expect(classifyEnquiryFailure(duplicateModuleError)).toMatchObject({ rejection: expected });
    expect(classifyEnquiryFailure(duplicateModuleError)).not.toHaveProperty("cause");
  });

  it("pins harness alias settings for build and serve despite ambient active configuration", async () => {
    const active = fixture().environment;
    for (const name of ["MODE", "DOCUMENT_ID", "SOURCE_MAP_SHA256", "PAYLOAD_SHA256", "ROW_COUNT"]) active[`NEXT_PUBLIC_SITE_IDENTITY_ALIAS_${name}`] = "ambient-value";
    const isolated = { ...active, ...appUnderTestEnvironment };
    const fetcher = vi.fn<typeof fetch>();
    const loader = createDeploymentIdentityAliasLoader(isolated, fetcher);
    expect(await loader.load()).toBeTypeOf("function"); expect(fetcher).not.toHaveBeenCalled();
    for (const name of ["MODE", "DOCUMENT_ID", "SOURCE_MAP_SHA256", "PAYLOAD_SHA256", "ROW_COUNT"]) expect(appUnderTestEnvironment[`NEXT_PUBLIC_SITE_IDENTITY_ALIAS_${name}` as keyof typeof appUnderTestEnvironment]).toBe("");
  });
});

const sanityConfig = { projectId: "fixture-project", dataset: "content", datasetVisibility: "public" as const, apiVersion: "v2020-01-01" };
describe("canonical placement seam in the real Sanity adapter", () => {
  it.each([["renamed", "en-GB"], ["renamed", "fi-FI"], ["restored", "en-GB"], ["restored", "fi-FI"]] as const)("uses canonical query and equality check in %s/%s", async (mode, locale) => {
    const f = fixture(mode);
    const query = vi.fn<SanityClient["query"]>(async (request) => {
      if (request.tag === "enquiry.gallery") { expect(request.params).toEqual({ contentId: CONTENT, language: locale.slice(0, 2) }); return [{ _id: "fixture-gallery-en" }]; }
      expect(request.params).toEqual({ galleryId: "fixture-gallery-en", itemId: ITEM });
      return [{ placementId: ITEM, visible: true, media: { mediaId: "shared-media", publiclyRenderable: true, enquiryEligible: true } }];
    });
    const result = await f.resolve(curated("legacy-selected-gallery", "legacy-selected-photo", locale), (request, language, identityAliases) => resolveSanityEnquiryTarget(request, language, { client: { query }, config: sanityConfig, identityAliases }));
    expect(result).toMatchObject({ contentId: CONTENT, placementId: ITEM, mediaId: "shared-media" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each(["renamed", "restored"] as const)("leaves capture media unchanged after authoritative container kind in %s", async (mode) => {
    const f = fixture(mode);
    const query = vi.fn<SanityClient["query"]>(async (request) => request.tag === "enquiry.gallery"
      ? [{ _id: "fixture-capture", orderingRule: "capture-sequence" }]
      : (expect(request.params).toEqual({ contentId: "content-capture-sequence", itemId: "capture-sequence-0002" }), [{ media: { mediaId: "capture-sequence-0002", publiclyRenderable: true, enquiryEligible: true } }]));
    const result = await f.resolve(curated("content-capture-sequence", "capture-sequence-0002"), (request, language, identityAliases) => resolveSanityEnquiryTarget(request, language, { client: { query }, config: sanityConfig, identityAliases }));
    expect(result).not.toHaveProperty("placementId"); expect(result.mediaId).toBe("capture-sequence-0002");
  });

  it("refuses a disabled gallery before mapping or occurrence query", async () => {
    const identityAliases = vi.fn(createIdentityAliasResolver());
    const query = vi.fn<SanityClient["query"]>(async () => [{ _id: "fixture-gallery", allowPhotoEnquiries: false }]);
    await expect(resolveSanityEnquiryTarget(curated(), "en", { client: { query }, config: sanityConfig, identityAliases })).rejects.toMatchObject({ rejection: "not-enquirable" });
    expect(identityAliases).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps dynamic Sanity unsupported without alias/config/client access", async () => {
    const query = vi.fn(); const identityAliases = vi.fn();
    await expect(resolveSanityEnquiryTarget({ kind: "dynamic", locale: "en-GB", itemId: "coastal-landscape" }, "en", { client: { query }, config: sanityConfig, identityAliases })).rejects.toMatchObject({ rejection: "dynamic-unsupported" });
    expect(query).not.toHaveBeenCalled(); expect(identityAliases).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  defaultProofTermsForm, proofPublicationEndpoint, proofPublishCopy, proofPublishReadiness, proofRotateReadiness,
  proofSelectionUrl, readProofPublicationAnswer, readProofTermsForm, sendProofPublication, type ProofActionState,
} from "./proof-publish";

const site = { origin: "https://photos.example", locales: ["fi", "en-GB"] };
const handle = "a".repeat(32), key = "K".repeat(43);
const draft = { _id: "drafts.proof-1", _rev: "rev-2", handle };
const state = (patch: Partial<ProofActionState> = {}): ProofActionState => ({
  id: "proof-1", type: "clientProofGallery", ready: true, draft, published: null, transactionSyncLock: { enabled: false }, ...patch,
});
const valid = { isValidating: false, revision: "rev-2", validation: [{ level: "warning" }] };

describe("publish readiness", () => {
  it("is ready only for a draft whose validation finished for exactly its revision without errors", () => {
    expect(proofPublishReadiness(state(), valid, false, site, true)).toBe("ready");
    expect(proofPublishReadiness(state(), { ...valid, revision: "rev-1" }, false, site, true)).toBe("checking");
    expect(proofPublishReadiness(state(), { ...valid, revision: undefined }, false, site, true)).toBe("checking");
    expect(proofPublishReadiness(state(), { ...valid, isValidating: true }, false, site, true)).toBe("checking");
    expect(proofPublishReadiness(state(), valid, true, site, true)).toBe("checking");
    expect(proofPublishReadiness(state(), { ...valid, validation: [{ level: "error" }] }, false, site, true)).toBe("invalid");
  });

  it("fails closed for configuration, document state and malformed values", () => {
    expect(proofPublishReadiness(state(), valid, false, site, false)).toBe("off");
    expect(proofPublishReadiness(state(), valid, false, undefined, true)).toBe("configure");
    expect(proofPublishReadiness(state({ type: "clientDeliveryGallery" }), valid, false, site, true)).toBe("unsupported");
    expect(proofPublishReadiness(state({ version: { _id: "versions.r.proof-1" } }), valid, false, site, true)).toBe("unsupported");
    expect(proofPublishReadiness(state({ release: "r1" }), valid, false, site, true)).toBe("unsupported");
    expect(proofPublishReadiness(state({ id: "x".repeat(97) }), valid, false, site, true)).toBe("unsupported");
    expect(proofPublishReadiness(state({ ready: false }), valid, false, site, true)).toBe("checking");
    expect(proofPublishReadiness(state({ transactionSyncLock: { enabled: true } }), valid, false, site, true)).toBe("checking");
    expect(proofPublishReadiness(state({ draft: null }), valid, false, site, true)).toBe("nothing-to-publish");
    expect(proofPublishReadiness(state({ draft: { ...draft, _rev: "bad rev" } }), { ...valid, revision: "bad rev" }, false, site, true)).toBe("nothing-to-publish");
    expect(proofPublishReadiness(state({ draft: { ...draft, handle: "short" } }), valid, false, site, true)).toBe("invalid");
  });

  it("rotates only a published gallery with a valid handle, whatever the draft", () => {
    expect(proofRotateReadiness(state(), site, true)).toBe("nothing-to-publish");
    expect(proofRotateReadiness(state({ published: { _id: "proof-1", handle } }), site, true)).toBe("ready");
    expect(proofRotateReadiness(state({ draft: null, published: { _id: "proof-1", handle } }), site, true)).toBe("ready");
    expect(proofRotateReadiness(state({ published: { _id: "proof-1", handle: "x" } }), site, true)).toBe("nothing-to-publish");
    expect(proofRotateReadiness(state({ published: { _id: "proof-1", handle } }), site, false)).toBe("off");
  });
});

describe("terms form", () => {
  const filled = { ...defaultProofTermsForm("fi"), includedCount: "20", extraUnitPrice: "12,50", jobReference: " Wedding 2026 ", customerEmail: "customer@example.com" };

  it("defaults to euros and a reminder after a week", () => {
    expect(defaultProofTermsForm()).toMatchObject({ currency: "EUR", reminder: true, reminderDays: "7" });
  });

  it("produces the closed terms in minor units, trimming text", () => {
    expect(readProofTermsForm(filled, ["fi", "en-GB"])).toEqual({ terms: {
      includedCount: 20, extraUnitPriceMinor: 1250, currency: "EUR", jobReference: "Wedding 2026",
      reminder: { delayDays: 7, customerEmail: "customer@example.com", locale: "fi" },
    } });
    expect(readProofTermsForm({ ...filled, currency: "JPY", extraUnitPrice: "1500" }, ["fi", "en-GB"])).toMatchObject({ terms: { extraUnitPriceMinor: 1500, currency: "JPY" } });
  });

  it("stores no address when the reminder is off, even if one was typed", () => {
    expect(readProofTermsForm({ ...filled, reminder: false, reminderDays: "x", customerEmail: "not an address" }, ["fi", "en-GB"]))
      .toEqual({ terms: expect.objectContaining({ reminder: null }) });
  });

  it("names every field that needs correcting", () => {
    expect(readProofTermsForm({ ...filled, includedCount: "257", extraUnitPrice: "1.234", jobReference: "  ", reminderDays: "0", customerEmail: "x@" }, ["fi", "en-GB"]))
      .toEqual({ invalid: ["includedCount", "extraUnitPrice", "jobReference", "reminderDays", "customerEmail"] });
    expect(readProofTermsForm({ ...filled, currency: "XYZ" }, ["fi", "en-GB"])).toEqual({ invalid: ["currency", "extraUnitPrice"] });
    expect(readProofTermsForm({ ...filled, includedCount: "-1" }, ["fi", "en-GB"])).toEqual({ invalid: ["includedCount"] });
    // The customer's language must be one of the site's locales whenever a reminder is on.
    expect(readProofTermsForm({ ...filled, reminderLocale: "sv" }, ["fi", "en-GB"])).toEqual({ invalid: ["reminderLocale"] });
    // An extended configured locale, as the site's own route table accepts it.
    expect(readProofTermsForm({ ...filled, reminderLocale: "en-GB-u-hc-h23" }, ["fi", "en-GB-u-hc-h23"])).toMatchObject({ terms: { reminder: { locale: "en-GB-u-hc-h23" } } });
    expect(readProofTermsForm({ ...filled, reminder: false, reminderLocale: "sv" }, ["fi", "en-GB"])).toMatchObject({ terms: { reminder: null } });
    expect(readProofTermsForm({ ...filled, reminderDays: "366" }, ["fi", "en-GB"])).toEqual({ invalid: ["reminderDays"] });
  });
});

describe("the request", () => {
  it("targets the site route and sends one cookieless, uncached POST with the editor's token", async () => {
    const fetcher = vi.fn(async () => Response.json({ status: "published", firstPublication: false }));
    const endpoint = proofPublicationEndpoint(site);
    expect(endpoint).toBe("https://photos.example/api/proof-gallery/publish");
    const answer = await sendProofPublication(endpoint, "editor-token", { galleryId: "proof-1", operation: "rotate-key" }, fetcher as unknown as typeof fetch);
    expect(answer).toEqual({ status: 200, body: { status: "published", firstPublication: false } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error" });
    expect(init.headers).toEqual({ Authorization: "Bearer editor-token", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ galleryId: "proof-1", operation: "rotate-key" });
  });

  it("reports a lost connection, a timeout or a non-JSON answer without throwing", async () => {
    const body = { galleryId: "proof-1", operation: "rotate-key" } as const;
    expect(await sendProofPublication("https://photos.example/x", "t", body, (async () => { throw new TypeError("failed"); }) as unknown as typeof fetch))
      .toEqual({ status: "network", body: undefined });
    const hanging = ((_: unknown, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    expect(await sendProofPublication("https://photos.example/x", "t", body, hanging, 5)).toEqual({ status: "network", body: undefined });
    expect(await sendProofPublication("https://photos.example/x", "t", body, (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch))
      .toEqual({ status: 502, body: undefined });
  });
});

describe("reading the answer", () => {
  it("accepts a first publication only with its key, and a later one only without", () => {
    expect(readProofPublicationAnswer("publish", { status: 200, body: { status: "published", firstPublication: true, selectionKey: key } }))
      .toEqual({ kind: "published", firstPublication: true, selectionKey: key });
    expect(readProofPublicationAnswer("publish", { status: 200, body: { status: "published", firstPublication: false } }))
      .toEqual({ kind: "published", firstPublication: false });
    expect(readProofPublicationAnswer("publish", { status: 200, body: { status: "published", firstPublication: true } })).toEqual({ kind: "unknown" });
    expect(readProofPublicationAnswer("publish", { status: 200, body: { status: "published", firstPublication: false, selectionKey: key } })).toEqual({ kind: "unknown" });
    expect(readProofPublicationAnswer("rotate-key", { status: 200, body: { status: "key-rotated", selectionKey: key } }))
      .toEqual({ kind: "key-rotated", selectionKey: key });
    expect(readProofPublicationAnswer("rotate-key", { status: 200, body: { status: "key-rotated", selectionKey: "short" } })).toEqual({ kind: "unknown" });
    expect(readProofPublicationAnswer("rotate-key", { status: 200, body: { status: "published", firstPublication: false } })).toEqual({ kind: "unknown" });
  });

  it("treats only the route's own rejections as not published", () => {
    expect(readProofPublicationAnswer("publish", { status: 409, body: { status: "rejected", reason: "stale-draft" } })).toEqual({ kind: "rejected", reason: "stale-draft" });
    expect(readProofPublicationAnswer("publish", { status: 409, body: { status: "rejected", reason: "conflict", retryable: true } })).toEqual({ kind: "rejected", reason: "conflict" });
    expect(readProofPublicationAnswer("publish", { status: 401, body: { status: "rejected", reason: "unauthenticated" } })).toEqual({ kind: "rejected", reason: "signin" });
    expect(readProofPublicationAnswer("publish", { status: 422, body: { status: "rejected", reason: "terms-required" } })).toEqual({ kind: "rejected", reason: "terms" });
    expect(readProofPublicationAnswer("publish", { status: 400, body: { status: "rejected", reason: "malformed-request" } })).toEqual({ kind: "rejected", reason: "request" });
    for (const answer of [
      { status: "network" as const, body: undefined },
      { status: 503, body: { status: "failed", reason: "store-unavailable", retryable: true } },
      { status: 500, body: { status: "failed", reason: "internal" } },
      { status: 404, body: undefined },
      { status: 409, body: { status: "rejected", reason: "something-new" } },
      { status: 409, body: ["rejected"] },
      { status: 302, body: { status: "rejected", reason: "conflict" } },
    ]) expect(readProofPublicationAnswer("publish", answer)).toEqual({ kind: "unknown" });
  });

  it("has a message for every rejection in both languages", () => {
    for (const locale of ["fi-FI", "en-US"]) {
      const copy = proofPublishCopy(locale);
      for (const reason of ["signin", "forbidden", "not-found", "stale-draft", "conflict", "invalid", "inconsistent", "unsupported", "rate-limited", "terms", "request"] as const) {
        expect(copy.rejected[reason]).toMatch(/\S/u);
      }
    }
  });
});

describe("the selection link", () => {
  it("carries the key in the fragment and an optional configured locale in the query", () => {
    expect(proofSelectionUrl(site, handle, key)).toBe(`https://photos.example/client-proof/${handle}#select=${key}`);
    expect(proofSelectionUrl(site, handle, key, "en-GB")).toBe(`https://photos.example/client-proof/${handle}?locale=en-GB#select=${key}`);
  });

  it.each([
    [handle, key, "sv"], ["A".repeat(32), key, ""], [handle, "short", ""], [undefined, key, ""], [handle, `${"K".repeat(42)}/`, ""],
  ])("refuses %s / %s / %s", (candidate, selectionKey, locale) => {
    expect(proofSelectionUrl(site, candidate, selectionKey, locale)).toBeUndefined();
  });
});

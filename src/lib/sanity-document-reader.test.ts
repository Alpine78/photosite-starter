import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSanityClient, createSanityDocumentReader,
  SANITY_DOCUMENT_MAX_RESPONSE_BYTES, SanityQueryError,
} from "@/lib/sanity-client";

const config = {
  projectId: "abcdefgh", dataset: "fixture", datasetVisibility: "public" as const,
  apiVersion: "v2026-06-24",
};
const id = `legacyDeliveryGallery-${"a".repeat(32)}`;
const reply = (body: unknown) => new Response(JSON.stringify(body));
afterEach(() => vi.restoreAllMocks());

describe("fresh published document transport", () => {
  it("does not put legacy image reads in the ordinary public cache", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply({ result: { images: [], zip: null } }));
    await createSanityClient({ config, fetchImplementation: send, maxResponseBytes: 512 * 1024 }).query({ query: "fixture", tag: "legacy.images" });
    expect(send.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(send.mock.calls[0][1]).not.toHaveProperty("next");
  });
  it("uses the fixed Doc endpoint with no-store, no redirects and an abort bound", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply({ documents: [{ _id: id, _type: "fixture" }] }));
    const reader = createSanityDocumentReader({ config, fetchImplementation: send });
    expect(await reader.read(id)).toEqual({ _id: id, _type: "fixture" });
    expect(send.mock.calls[0][0]).toBe(`https://abcdefgh.api.sanity.io/v2026-06-24/data/doc/fixture/${id}?includeAllVersions=false`);
    expect(send.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "manual", method: "GET" });
    expect(send.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(send.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
  });

  it("keeps private-dataset authorization in headers only", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply({ documents: [] }));
    const reader = createSanityDocumentReader({ config: { ...config, datasetVisibility: "private", readToken: "fixture-credential" }, fetchImplementation: send });
    expect(await reader.read(id)).toBeNull();
    expect(String(send.mock.calls[0][0])).not.toContain("fixture-credential");
    expect(new Headers(send.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer fixture-credential");
  });

  it.each(["drafts.fixture", "versions.fixture", "one,two", "../fixture", "a/b", "", "x".repeat(129)])("refuses non-root identity %s before fetching", async (bad) => {
    const send = vi.fn<typeof fetch>();
    await expect(createSanityDocumentReader({ config, fetchImplementation: send }).read(bad)).rejects.toThrow(TypeError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([{}, { documents: null }, { documents: [null] }, { documents: [{ _id: "foreign" }] }, { documents: [{ _id: id }, { _id: id }] }])("rejects malformed or mismatched envelopes without logging their contents", async (body) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply(body));
    await expect(createSanityDocumentReader({ config, fetchImplementation: send }).read(id)).rejects.toMatchObject({ errorClass: "malformed-response" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(id);
    expect(JSON.stringify(log.mock.calls)).not.toContain("foreign");
  });

  it.each([401, 403, 404, 429, 500, 302])("classifies HTTP%d without consuming provider prose", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider-sensitive-body", { status }));
    await expect(createSanityDocumentReader({ config, fetchImplementation: send }).read(id)).rejects.toBeInstanceOf(SanityQueryError);
  });

  it("cancels oversized declared and streaming bodies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const declared of [false, true]) {
      const cancel = vi.fn();
      const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(SANITY_DOCUMENT_MAX_RESPONSE_BYTES + 1)); }, cancel });
      const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: declared ? { "content-length": String(SANITY_DOCUMENT_MAX_RESPONSE_BYTES + 1) } : {} }));
      await expect(createSanityDocumentReader({ config, fetchImplementation: send }).read(id)).rejects.toMatchObject({ errorClass: "malformed-response" });
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects damaged UTF-8 and distinguishes body aborts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0xff])));
    await expect(createSanityDocumentReader({ config, fetchImplementation: send }).read(id)).rejects.toMatchObject({ errorClass: "malformed-response" });
    send.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("fixture", "AbortError")); } })));
    await expect(createSanityDocumentReader({ config, fetchImplementation: send }).read(id)).rejects.toMatchObject({ errorClass: "timeout", retryable: true });
  });

  it("applies the optional query bound without changing the existing query interface", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply({ result: "x".repeat(500) }));
    const reader = createSanityClient({ config, fetchImplementation: send, maxResponseBytes: 64 });
    await expect(reader.query({ tag: "legacy.images", query: "*[false]" })).rejects.toMatchObject({ errorClass: "malformed-response" });
    expect(send.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "manual" });
    for (const maxResponseBytes of [0, -1, NaN, 1.5, 1024 * 1024 + 1]) {
      expect(() => createSanityClient({ config, maxResponseBytes })).toThrow(TypeError);
    }
  });
});

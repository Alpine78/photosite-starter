import { describe, expect, it, vi } from "vitest";
import { parseProofSelectionBody, readProofSelectionConfig } from "@/lib/proof-selection-request";
import { commitProofSelection, readProofSelectionDocument, readProofSelectionToken, ProofSelectionStoreError } from "@/lib/proof-selection-sanity";

const handle = "c".repeat(32), key = "K".repeat(43), token = "t".repeat(40);
const enabled = { PROOF_SELECTION: "enabled", PROOF_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "public",
  SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production", SANITY_PROOF_SELECTION_TOKEN: token };

describe("proof selection configuration", () => {
  it("is off unless enabled, and reports an incomplete configuration instead of guessing", () => {
    expect(readProofSelectionConfig({})).toEqual({ state: "disabled" });
    expect(readProofSelectionConfig(enabled)).toEqual({ state: "enabled", token });
    for (const patch of [
      { SANITY_PROOF_SELECTION_TOKEN: "" }, { NEXT_PUBLIC_SANITY_PROOF_SELECTION_TOKEN: token }, { PROOF_GALLERY_ADAPTER: "off" },
      { PROOF_GALLERY_ADAPTER: "fixture" }, { VERCEL_ENV: "preview" }, { SANITY_DATASET_VISIBILITY: "private" },
    ]) expect(readProofSelectionConfig({ ...enabled, ...patch }), JSON.stringify(patch)).toEqual({ state: "misconfigured" });
  });

  it("never accepts a browser-visible copy of the credential", () => {
    expect(readProofSelectionToken({ SANITY_PROOF_SELECTION_TOKEN: token, NEXT_PUBLIC_SANITY_PROOF_SELECTION_TOKEN: "x" })).toBeUndefined();
  });
});

describe("proof selection request body", () => {
  it("accepts exactly the three closed shapes", () => {
    expect(parseProofSelectionBody(JSON.stringify({ operation: "read", handle, key }))).toEqual({ operation: "read", handle, key });
    expect(parseProofSelectionBody(JSON.stringify({ operation: "select", handle, key, expectedRevision: null, references: ["002", "001"] })))
      .toEqual({ operation: "select", handle, key, expectedRevision: null, references: ["002", "001"] });
    expect(parseProofSelectionBody(JSON.stringify({ operation: "confirm", handle, key, expectedRevision: "rev1" }))).toMatchObject({ operation: "confirm", expectedRevision: "rev1" });
  });

  it.each([
    undefined, "not json", "[]", JSON.stringify({ operation: "read", handle, key, extra: 1 }),
    JSON.stringify({ operation: "read", handle: "A".repeat(32), key }), JSON.stringify({ operation: "read", handle, key: "short" }),
    JSON.stringify({ operation: "select", handle, key, expectedRevision: null, references: ["001", "001"] }),
    JSON.stringify({ operation: "select", handle, key, expectedRevision: null, references: ["1"] }),
    JSON.stringify({ operation: "select", handle, key, expectedRevision: null, references: Array.from({ length: 257 }, (_, n) => String(n + 1).padStart(3, "0")) }),
    JSON.stringify({ operation: "select", handle, key, references: [] }),
    JSON.stringify({ operation: "confirm", handle, key, expectedRevision: null }),
    JSON.stringify({ operation: "delete", handle, key }),
  ])("refuses %s", (body) => {
    expect(parseProofSelectionBody(body)).toBeUndefined();
  });
});

describe("proof selection store transport", () => {
  const options = (send: typeof fetch) => ({ config: { projectId: "example1", dataset: "fixture", apiVersion: "v2026-06-24" } as never, token, fetchImplementation: send });

  it("reads one private document fresh by ID with the server credential only toward the project host", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ documents: [{ _id: "proofTerms.g1", _type: "clientProofTerms" }] }));
    expect(await readProofSelectionDocument("proofTerms.g1", options(send))).toMatchObject({ _id: "proofTerms.g1" });
    const [url, init] = send.mock.calls[0];
    expect(String(url)).toBe("https://example1.api.sanity.io/v2026-06-24/data/doc/fixture/proofTerms.g1");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(String(url)).not.toContain(token);
    expect(await readProofSelectionDocument("proofSelection.g1", options(vi.fn<typeof fetch>(async () => Response.json({ documents: [] }))))).toBeNull();
    await expect(readProofSelectionDocument("x", options(vi.fn<typeof fetch>(async () => Response.json({ documents: [{ _id: "y" }] }))))).rejects.toBeInstanceOf(ProofSelectionStoreError);
    await expect(readProofSelectionDocument("../x", options(send))).rejects.toThrow(TypeError);
  });

  it("treats a transaction whose answer body breaks off as an unknown outcome", async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error("connection reset")); } });
    const send = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    await expect(commitProofSelection([{ create: { _id: "x", _type: "y" } }], options(send))).rejects.toMatchObject({ kind: "unknown" });
  });

  it.each([
    [409, "conflict"], [400, "unavailable"], [403, "unavailable"], [500, "unknown"], ["network", "unknown"],
  ] as const)("classifies a transaction answered with %s as %s", async (status, kind) => {
    const send = vi.fn<typeof fetch>(async () => { if (status === "network") throw new TypeError("lost"); return new Response("{}", { status }); });
    await expect(commitProofSelection([{ create: { _id: "x", _type: "y" } }], options(send))).rejects.toMatchObject({ kind });
  });
});

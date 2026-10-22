import { describe, expect, it } from "vitest";
import { parseProofPublicationBody, readEditorToken, readProofPublicationConfig, studioCorsHeaders } from "@/lib/proof-publication-request";

const secret = Buffer.alloc(32, 3).toString("base64url");
const enabled = { PROOF_PUBLICATION: "enabled", PROOF_PUBLICATION_STUDIO_ORIGINS: "https://studio.example.com", PROOF_SELECTION_KEY_SECRET: secret };

describe("proof publication request boundary", () => {
  it("stays off unless explicitly enabled and refuses an incomplete configuration", () => {
    expect(readProofPublicationConfig({})).toEqual({ state: "disabled" });
    expect(readProofPublicationConfig({ ...enabled, PROOF_PUBLICATION: "yes" })).toEqual({ state: "disabled" });
    expect(readProofPublicationConfig(enabled).state).toBe("enabled");
    for (const origins of ["", "*", "https://studio.example.com/", "https://studio.example.com/path", "http://studio.example.com", "https://user:pass@studio.example.com", "not a url"]) {
      expect(readProofPublicationConfig({ ...enabled, PROOF_PUBLICATION_STUDIO_ORIGINS: origins })).toEqual({ state: "misconfigured" });
    }
    expect(readProofPublicationConfig({ ...enabled, PROOF_SELECTION_KEY_SECRET: "short" })).toEqual({ state: "misconfigured" });
    expect(readProofPublicationConfig({ ...enabled, NEXT_PUBLIC_PROOF_SELECTION_KEY_SECRET: secret })).toEqual({ state: "misconfigured" });
    expect(readProofPublicationConfig({ ...enabled, PROOF_PUBLICATION_STUDIO_ORIGINS: "http://localhost:3333" })).toEqual({ state: "misconfigured" });
    expect(readProofPublicationConfig({ ...enabled, NODE_ENV: "development", PROOF_PUBLICATION_STUDIO_ORIGINS: "http://localhost:3333" }).state).toBe("enabled");
  });
  it("answers CORS only for an exact allowed Studio origin, without credentials", () => {
    const allowed = new Set(["https://studio.example.com"]);
    expect(studioCorsHeaders("https://studio.example.com", allowed)).toEqual({
      "Access-Control-Allow-Origin": "https://studio.example.com", "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600", Vary: "Origin",
    });
    for (const origin of [null, "https://evil.example", "https://studio.example.com.evil.example", "null"]) expect(studioCorsHeaders(origin, allowed)).toBeUndefined();
  });
  it("reads only a well-formed bearer token", () => {
    expect(readEditorToken("Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe("abcdefghijklmnopqrstuvwxyz0123");
    for (const header of [null, "", "Basic abcdefghijklmnopqrstuvwxyz", "Bearer short", "Bearer abc def ghi jkl mno pqr", "bearer abcdefghijklmnopqrstuvwxyz0123", `Bearer ${"a".repeat(5000)}`]) {
      expect(readEditorToken(header)).toBeUndefined();
    }
  });
  it("accepts exactly the closed body", () => {
    expect(parseProofPublicationBody(JSON.stringify({ galleryId: "g1", operation: "publish" }))).toEqual({ galleryId: "g1", operation: "publish" });
    expect(parseProofPublicationBody(JSON.stringify({ operation: "rotate-key", galleryId: "abc-123_x" }))).toEqual({ galleryId: "abc-123_x", operation: "rotate-key" });
    for (const body of [undefined, "", "[]", "null", "{bad", JSON.stringify({ galleryId: "g1" }), JSON.stringify({ galleryId: "g1", operation: "delete" }),
      JSON.stringify({ galleryId: "drafts.g1", operation: "publish" }), JSON.stringify({ galleryId: "a".repeat(97), operation: "publish" }),
      JSON.stringify({ galleryId: "g1", operation: "publish", extra: 1 })]) {
      expect(parseProofPublicationBody(body)).toBeUndefined();
    }
  });
});

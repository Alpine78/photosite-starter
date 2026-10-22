import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  createScriptNonce,
  isScriptNonce,
  readSanityImageScope,
} from "@/lib/content-security-policy";

const directive = (policy: string, name: string) =>
  policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

describe("content security policy (ADR-0011, AB#390)", () => {
  it("keeps the static fallback exactly as before", () => {
    expect(contentSecurityPolicy({ sanityImageScope: null, development: false })).toBe(
      "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://www.youtube-nocookie.com; connect-src 'self'; font-src 'self'",
    );
  });

  it("changes only script-src when a nonce is given", () => {
    const nonce = createScriptNonce();
    const options = { sanityImageScope: { projectId: "abc123", dataset: "production" }, development: false };
    const fallback = contentSecurityPolicy(options);
    const tagged = contentSecurityPolicy({ ...options, scriptNonce: nonce });
    expect(directive(tagged, "script-src")).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(directive(tagged, "script-src")).not.toContain("'unsafe-inline'");
    const others = (policy: string) => policy.split(";").map((part) => part.trim()).filter((part) => !part.startsWith("script-src "));
    expect(others(tagged)).toEqual(others(fallback));
    expect(directive(tagged, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("adds unsafe-eval only in development, with or without a nonce", () => {
    const nonce = createScriptNonce();
    expect(directive(contentSecurityPolicy({ sanityImageScope: null, development: true, scriptNonce: nonce }), "script-src"))
      .toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`);
    expect(contentSecurityPolicy({ sanityImageScope: null, development: false, scriptNonce: nonce })).not.toContain("unsafe-eval");
  });

  it("refuses a nonce that is not base64 of 16 bytes", () => {
    for (const bad of ["", "abc", "AAAAAAAAAAAAAAAAAAAAAA=='; script-src *", "AAAAAAAAAAAAAAAAAAAAAAAA"]) {
      expect(isScriptNonce(bad)).toBe(false);
      expect(() => contentSecurityPolicy({ sanityImageScope: null, development: false, scriptNonce: bad })).toThrow(TypeError);
    }
  });

  it("creates distinct well-formed nonces", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createScriptNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(isScriptNonce(nonce)).toBe(true);
  });

  it("reads the Sanity image scope without throwing and never widens img-src", () => {
    expect(readSanityImageScope({ SITE_CONTENT_SOURCE: "mock" })).toBeNull();
    expect(readSanityImageScope({ SITE_CONTENT_SOURCE: "sanity", SANITY_PROJECT_ID: "abc123", SANITY_DATASET: "production" }))
      .toEqual({ projectId: "abc123", dataset: "production" });
    expect(readSanityImageScope({ SITE_CONTENT_SOURCE: "sanity", SANITY_PROJECT_ID: "abc/../x", SANITY_DATASET: "production" })).toBeNull();
    expect(readSanityImageScope({ SITE_CONTENT_SOURCE: "sanity", SANITY_PROJECT_ID: "abc123" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  computePrivateGallerySignature,
  derivePrivateGallerySigningKey,
  formatAmzDate,
  presignPrivateGalleryObjectUrl,
  PrivateGallerySigningError,
  uriEncode,
} from "@/lib/private-gallery-signed-url";

/**
 * AWS's own published worked example (Amazon Glacier, "Example Signature
 * Calculation"), used here as a known-answer test for the shared SigV4 core:
 * canonical-request hashing, the string to sign, the four-step key derivation,
 * and the final HMAC. The service is `glacier` rather than `s3` only because
 * that is the example AWS documents end to end; every step it exercises is the
 * same code the object-store presign path runs.
 *
 * This is what makes the implementation verified rather than self-consistent,
 * so it is pinned to the published values exactly.
 *
 * AWS documents a *second* example on the same page (the streaming Upload
 * Archive POST). It is deliberately **not** pinned: its published signature
 * cannot be reproduced from its published canonical request, so either the
 * printed canonical request or the printed signature is stale. A vector that
 * does not reproduce is not a vector, and encoding it would mean either a
 * permanently failing test or contorting the implementation to match something
 * unverifiable. Recorded here so nobody adds it later believing it was simply
 * overlooked.
 */
const AWS_VECTOR = {
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  region: "us-east-1",
  service: "glacier",
  amzDate: "20120525T002453Z",
  date: "20120525",
  canonicalRequest: [
    "PUT",
    "/-/vaults/examplevault",
    "",
    "host:glacier.us-east-1.amazonaws.com",
    "x-amz-date:20120525T002453Z",
    "x-amz-glacier-version:2012-06-01",
    "",
    "host;x-amz-date;x-amz-glacier-version",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ].join("\n"),
  signature:
    "3ce5b2f2fffac9262b4da9256f8d086b4aaf42eba5f111c21681a65a127b7c2a",
} as const;

const vectorKey = () =>
  derivePrivateGallerySigningKey({
    secretAccessKey: AWS_VECTOR.secretAccessKey,
    date: AWS_VECTOR.date,
    region: AWS_VECTOR.region,
    service: AWS_VECTOR.service,
  });

const vectorScope = `${AWS_VECTOR.date}/${AWS_VECTOR.region}/${AWS_VECTOR.service}/aws4_request`;

describe("the SigV4 core, against AWS's published worked example", () => {
  it("reproduces the documented signature exactly", () => {
    expect(
      computePrivateGallerySignature({
        canonicalRequest: AWS_VECTOR.canonicalRequest,
        amzDate: AWS_VECTOR.amzDate,
        scope: vectorScope,
        signingKey: vectorKey(),
      }),
    ).toBe(AWS_VECTOR.signature);
  });

  it.each([
    [
      "the canonical request",
      { canonicalRequest: `${AWS_VECTOR.canonicalRequest} ` },
    ],
    ["the timestamp", { amzDate: "20120525T002454Z" }],
    ["the scope", { scope: vectorScope.replace("us-east-1", "eu-north-1") }],
  ])("changes when %s changes", (_case, override) => {
    // A vector proves the happy path; this proves each input actually reaches
    // the hash rather than being silently ignored.
    expect(
      computePrivateGallerySignature({
        canonicalRequest: AWS_VECTOR.canonicalRequest,
        amzDate: AWS_VECTOR.amzDate,
        scope: vectorScope,
        signingKey: vectorKey(),
        ...override,
      }),
    ).not.toBe(AWS_VECTOR.signature);
  });

  it.each([
    [
      "secretAccessKey",
      { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEz" },
    ],
    ["date", { date: "20120526" }],
    ["region", { region: "eu-north-1" }],
    ["service", { service: "s3" }],
  ])("derives a different key when the %s changes", (_case, override) => {
    const base = {
      secretAccessKey: AWS_VECTOR.secretAccessKey,
      date: AWS_VECTOR.date,
      region: AWS_VECTOR.region,
      service: AWS_VECTOR.service,
    };

    expect(
      derivePrivateGallerySigningKey({ ...base, ...override }).toString("hex"),
    ).not.toBe(derivePrivateGallerySigningKey(base).toString("hex"));
  });
});

describe("uriEncode", () => {
  it("leaves the unreserved set alone", () => {
    expect(uriEncode("AZaz09-._~")).toBe("AZaz09-._~");
  });

  it.each([
    [" ", "%20"],
    ["/", "%2F"],
    ["+", "%2B"],
    ["=", "%3D"],
    ["&", "%26"],
    ["?", "%3F"],
    [":", "%3A"],
  ])("encodes %s as %s", (input, expected) => {
    expect(uriEncode(input)).toBe(expected);
  });

  it("uses uppercase hex", () => {
    expect(uriEncode("\u001A")).toBe("%1A");
    expect(uriEncode("\u007F")).toBe("%7F");
  });

  it("encodes the characters encodeURIComponent leaves alone", () => {
    // AWS's own guidance is that a platform encoder "might not work because of
    // differences in implementation". This is the concrete difference, and one
    // differing byte changes the canonical request and so the signature.
    for (const char of "!'()*") {
      expect(encodeURIComponent(char)).toBe(char);
      expect(uriEncode(char)).toBe(
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    }
  });

  it("encodes a multi-byte character per byte", () => {
    expect(uriEncode("ä")).toBe("%C3%A4");
  });
});

describe("formatAmzDate", () => {
  it("produces the two formats SigV4 uses", () => {
    expect(formatAmzDate(new Date("2026-09-02T12:00:00.000Z"))).toEqual({
      amzDate: "20260902T120000Z",
      date: "20260902",
    });
  });

  it("drops sub-second precision rather than carrying it into the scope", () => {
    expect(formatAmzDate(new Date("2026-09-02T12:00:00.937Z")).amzDate).toBe(
      "20260902T120000Z",
    );
  });

  it("refuses an unusable clock", () => {
    expect(() => formatAmzDate(new Date(NaN))).toThrow(
      PrivateGallerySigningError,
    );
  });
});

describe("presignPrivateGalleryObjectUrl", () => {
  const base = {
    endpoint: "https://objects.example",
    bucket: "private-bucket",
    region: "eu-north-1",
    objectKey: "private-galleries/g/gallery-1/preview/abc-def",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expiresInSeconds: 300,
    now: new Date("2026-09-02T12:00:00.000Z"),
  };
  const sign = (
    overrides: Partial<
      Parameters<typeof presignPrivateGalleryObjectUrl>[0]
    > = {},
  ) => presignPrivateGalleryObjectUrl({ ...base, ...overrides });

  it("addresses the object path-style under the configured endpoint", () => {
    const url = new URL(sign());

    expect(url.origin).toBe("https://objects.example");
    expect(url.pathname).toBe(`/private-bucket/${base.objectKey}`);
  });

  it("carries every parameter the store needs to verify it", () => {
    const url = new URL(sign());

    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe(
      `${base.accessKeyId}/20260902/eu-north-1/s3/aws4_request`,
    );
    expect(url.searchParams.get("X-Amz-Date")).toBe("20260902T120000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never carries the secret", () => {
    expect(sign()).not.toContain(base.secretAccessKey);
    expect(sign()).toContain(base.accessKeyId);
  });

  it("appends the signature after the signed parameters, never among them", () => {
    // It is the output of the signature, so it cannot also be an input to it.
    const url = sign();
    const signed = url.slice(0, url.indexOf("&X-Amz-Signature="));

    expect(signed).not.toContain("X-Amz-Signature");
    expect(url.indexOf("X-Amz-Signature")).toBe(
      url.lastIndexOf("X-Amz-Signature"),
    );
  });

  it("sorts the canonical query parameters", () => {
    const names = new URL(sign())
      .search.slice(1)
      .split("&")
      .filter((pair) => !pair.startsWith("X-Amz-Signature="))
      .map((pair) => pair.split("=")[0]);

    expect(names).toEqual([...names].sort());
  });

  it.each([
    [
      "the object key",
      { objectKey: "private-galleries/g/gallery-1/preview/other" },
    ],
    ["the expiry", { expiresInSeconds: 301 }],
    ["the bucket", { bucket: "other-bucket" }],
    ["the region", { region: "eu-west-1" }],
    ["the endpoint host", { endpoint: "https://other.example" }],
    ["the instant", { now: new Date("2026-09-02T12:00:01.000Z") }],
  ])("produces a different signature when %s changes", (_case, override) => {
    const signature = (url: string) =>
      new URL(url).searchParams.get("X-Amz-Signature");

    expect(signature(sign(override))).not.toBe(signature(sign()));
  });

  it("is deterministic for identical inputs", () => {
    expect(sign()).toBe(sign());
  });

  it("signs the response-header overrides so a recipient cannot change them", () => {
    const url = new URL(
      sign({
        responseHeaders: {
          contentDisposition: "attachment",
          cacheControl: "no-store",
        },
      }),
    );

    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment",
    );
    expect(url.searchParams.get("response-cache-control")).toBe("no-store");
    // In the signed set, so altering either invalidates the URL.
    expect(url.searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(sign()).searchParams.get("X-Amz-Signature"),
    );
  });

  it("encodes a key segment that needs it without encoding the separators", () => {
    expect(new URL(sign({ objectKey: "a b/c+d" })).pathname).toBe(
      "/private-bucket/a%20b/c%2Bd",
    );
  });

  it.each([
    ["a plain-HTTP endpoint", { endpoint: "http://objects.example" }],
    [
      "an endpoint carrying a path",
      { endpoint: "https://objects.example/prefix" },
    ],
    [
      "an endpoint carrying a query",
      { endpoint: "https://objects.example/?a=1" },
    ],
    ["a value that is not a URL", { endpoint: "objects.example" }],
    ["an empty bucket", { bucket: "" }],
    ["an empty key", { objectKey: "" }],
    ["a zero expiry", { expiresInSeconds: 0 }],
    ["a fractional expiry", { expiresInSeconds: 1.5 }],
    ["an empty access key", { accessKeyId: "" }],
    ["an empty secret", { secretAccessKey: "" }],
    ["an unusable clock", { now: new Date(NaN) }],
  ])("refuses %s", (_case, override) => {
    expect(() => sign(override)).toThrow(PrivateGallerySigningError);
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_PUBLIC_IMAGE_DIMENSION,
  projectPublicImageMedia,
  type ImageMedia,
  type PublicImageMediaInput,
} from "@/lib/media";
import { mockImages } from "@/lib/mock-media";

const validInput: PublicImageMediaInput = {
  mediaId: "test-image",
  publiclyRenderable: true,
  rendition: {
    sourceKind: "public-web-derivative",
    src: "/gallery/test-image.0123456789ab.webp",
    version: "0123456789ab",
    width: 1200,
    height: 800,
  },
  alt: "A test image",
  caption: "Test caption",
  credit: "Test credit",
};

describe("projectPublicImageMedia", () => {
  it("projects only allow-listed public fields", () => {
    const providerRecord = {
      ...validInput,
      _id: "provider-document-id",
      archiveLocator: "archive/private/master.raw",
      masterUrl: "https://private.example/master.raw",
      rendition: {
        ...validInput.rendition,
        providerAssetRef: "provider-asset-id",
      },
    };

    const projected = projectPublicImageMedia(providerRecord);

    expect(projected).toEqual({
      type: "image",
      mediaId: "test-image",
      alt: "A test image",
      caption: "Test caption",
      credit: "Test credit",
      rendition: {
        src: "/gallery/test-image.0123456789ab.webp",
        version: "0123456789ab",
        width: 1200,
        height: 800,
      },
    });
    expect(projected.rendition).not.toBe(providerRecord.rendition);

    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("provider-document-id");
    expect(serialized).not.toContain("provider-asset-id");
    expect(serialized).not.toContain("archive/private/master.raw");
    expect(serialized).not.toContain("private.example");
  });

  it("requires validated delivery-field provenance at compile time", () => {
    const projected = projectPublicImageMedia(validInput);
    const bypassCandidate = {
      ...projected,
      rendition: {
        ...projected.rendition,
        src: validInput.rendition.src,
      },
    };

    // @ts-expect-error Replacing a validated source with a raw string loses provenance.
    const unprojected: ImageMedia = bypassCandidate;

    expect(unprojected.rendition.src).toBe(validInput.rendition.src);
  });

  it("rejects media or sources classified as non-public", () => {
    expect(() =>
      projectPublicImageMedia({ ...validInput, publiclyRenderable: false }),
    ).toThrow("only a publicly renderable web derivative");

    expect(() =>
      projectPublicImageMedia({
        ...validInput,
        rendition: {
          ...validInput.rendition,
          sourceKind: "non-public",
        },
      }),
    ).toThrow("only a publicly renderable web derivative");
  });

  it.each([
    "gallery/image.webp",
    "//cdn.example/image.webp",
    "http://cdn.example/image.webp",
    "data:image/webp;base64,AAAA",
    "https://user:password@cdn.example/image.webp",
    "/\\evil.example/image.0123456789ab.webp",
    "/gallery/unversioned.webp",
    "/gallery/test-image.0123456789ab.webp?width=800",
  ])("rejects a non-public source shape: %s", (src) => {
    expect(() =>
      projectPublicImageMedia({
        ...validInput,
        rendition: { ...validInput.rendition, src },
      }),
    ).toThrow(TypeError);
  });

  it.each([0, -1, 1.5, MAX_PUBLIC_IMAGE_DIMENSION + 1])(
    "rejects an invalid intrinsic dimension: %s",
    (width) => {
      expect(() =>
        projectPublicImageMedia({
          ...validInput,
          rendition: { ...validInput.rendition, width },
        }),
      ).toThrow(RangeError);
    },
  );

  it("accepts an HTTPS public derivative", () => {
    expect(
      projectPublicImageMedia({
        ...validInput,
        rendition: {
          ...validInput.rendition,
          src: "https://cdn.example/public/image/revision-2.webp",
          version: "revision-2",
        },
      }).rendition.src,
    ).toBe("https://cdn.example/public/image/revision-2.webp");
  });

  it("rejects a version identifier that is absent from the source URL", () => {
    expect(() =>
      projectPublicImageMedia({
        ...validInput,
        rendition: {
          ...validInput.rendition,
          version: "fedcba987654",
        },
      }),
    ).toThrow("local rendition.src must be a content-versioned");
  });
});

describe("mock public image renditions", () => {
  it("uses existing content-hashed files with matching intrinsic dimensions", () => {
    for (const image of Object.values(mockImages)) {
      const match = image.rendition.src.match(
        /^\/gallery\/[a-z-]+\.([0-9a-f]{12})\.webp$/,
      );
      expect(match).not.toBeNull();

      const bytes = readFileSync(
        resolve(process.cwd(), "public", image.rendition.src.slice(1)),
      );
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      expect(contentHash.startsWith(match?.[1] ?? "")).toBe(true);
      expect(image.rendition.version).toBe(match?.[1]);

      expect(bytes.toString("ascii", 12, 16)).toBe("VP8 ");
      expect(bytes.readUInt16LE(26) & 0x3fff).toBe(image.rendition.width);
      expect(bytes.readUInt16LE(28) & 0x3fff).toBe(image.rendition.height);
    }
  });

  it("keeps project media identity independent of rendition URLs", () => {
    const mediaIds = Object.values(mockImages).map((image) => image.mediaId);
    const sourceNames = Object.values(mockImages).map(
      (image) => image.rendition.src,
    );

    expect(new Set(mediaIds).size).toBe(mediaIds.length);
    expect(mediaIds).toContain("coastal-landscape");
    expect(sourceNames.some((src) => src.includes("coastal-landscape"))).toBe(
      true,
    );
    expect(mediaIds.some((mediaId) => /[0-9a-f]{12}/.test(mediaId))).toBe(
      false,
    );
  });
});

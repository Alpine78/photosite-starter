import { describe, expect, it, vi } from "vitest";

import { mediaType } from "../../sanity/schemas/media";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "@/lib/image-delivery";
import {
  isPubliclyRenderable,
  MAX_PUBLIC_MEDIA_PAGE_SIZE,
  MEDIA_DOCUMENT_TYPE,
  ORDERED_MEDIA_FIELDS,
  projectPublicMedia,
  PROJECTED_MEDIA_FIELDS,
  PUBLIC_MEDIA_FILTER,
  PUBLIC_MEDIA_ORDER,
  PUBLIC_MEDIA_PROJECTION,
  readPublicMedia,
  readPublicMediaById,
  SanityMediaError,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";

/**
 * The site's own language, which alternative text falls back to. Mocked rather
 * than read from an environment, so this suite exercises the adapter and not
 * the deployment loader.
 */
vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

/**
 * A fixture project, a fixture dataset, and invented photographs. Nothing here
 * addresses a project anybody owns, names a real person or place, or reaches
 * the network.
 */
const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  apiVersion: "v2026-06-24",
};

const languages = { language: "fi", fallbackLanguage: "fi" } as const;
const englishRoute = { language: "en", fallbackLanguage: "fi" } as const;

const EXPORTED_HASH = "0123456789abcdef0123456789abcdef01234567";
const REPROCESSED_HASH = "fedcba9876543210fedcba9876543210fedcba98";

type AssetOverrides = {
  readonly sha1hash?: string;
  readonly width?: number;
  readonly height?: number;
  readonly extension?: string;
  readonly mimeType?: string;
  readonly url?: string;
};

function assetOf(overrides: AssetOverrides = {}) {
  const sha1hash = overrides.sha1hash ?? EXPORTED_HASH;
  const width = overrides.width ?? 1600;
  const height = overrides.height ?? 1067;
  const extension = overrides.extension ?? "webp";

  return {
    url:
      overrides.url ??
      `https://cdn.sanity.io/images/${config.projectId}/${config.dataset}/${sha1hash}-${width}x${height}.${extension}`,
    sha1hash,
    extension,
    mimeType: overrides.mimeType ?? "image/webp",
    width,
    height,
  };
}

function documentOf(
  overrides: Partial<RawPublicMediaDocument> = {},
): RawPublicMediaDocument {
  return {
    mediaId: "coastal-landscape",
    mediaType: "image",
    publiclyRenderable: true,
    alt: [
      { language: "fi", value: "Kivinen rantaviiva tyynen veden äärellä" },
      { language: "en", value: "Rocky shoreline beside calm water" },
    ],
    caption: [{ language: "fi", value: "Hiljainen rannikko" }],
    credit: "Placeholder credit",
    asset: assetOf(),
    ...overrides,
  };
}

function project(
  document: RawPublicMediaDocument,
  route: { language: string; fallbackLanguage: string } = languages,
) {
  return projectPublicMedia(document, { ...route, config });
}

function rejectionOf(run: () => unknown): SanityMediaError {
  try {
    run();
  } catch (cause) {
    if (cause instanceof SanityMediaError) return cause;
    throw cause;
  }

  throw new Error("expected the projection to be refused");
}

describe("projecting a Sanity photograph", () => {
  it("builds the public contract from an exported web derivative", () => {
    const media = project(documentOf());

    expect(media).toEqual({
      type: "image",
      mediaId: "coastal-landscape",
      alt: "Kivinen rantaviiva tyynen veden äärellä",
      caption: "Hiljainen rannikko",
      credit: "Placeholder credit",
      rendition: {
        src: `https://cdn.sanity.io/images/zp7mbokg/production/${EXPORTED_HASH}-1600x1067.webp`,
        version: EXPORTED_HASH,
        width: 1600,
        height: 1067,
      },
    });
  });

  it("carries no provider, archive, or ordering field into the payload", () => {
    // The projection is an allow-list, so a document arriving with fields the
    // adapter never asked for still cannot widen what a browser receives.
    const serialized = JSON.stringify(
      project(
        documentOf({
          ...({
            _id: "drafts.f8a0",
            _type: "media",
            archiveLocator: "/Volumes/Archive/2026/coast/DSCF1042.RAF",
            capturedAt: "2026-05-02T07:14:00Z",
          } as Partial<RawPublicMediaDocument>),
        }),
      ),
    );

    for (const forbidden of [
      "_id",
      "_type",
      "_ref",
      "archiveLocator",
      "Archive",
      "capturedAt",
      "sha1hash",
      "publiclyRenderable",
      "mediaType",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("describes the same photograph in the language the route renders", () => {
    const finnish = project(documentOf());
    const english = project(documentOf(), englishRoute);

    expect(english.alt).toBe("Rocky shoreline beside calm water");
    // Identity and bytes are language-neutral: only the words differ.
    expect(english.mediaId).toBe(finnish.mediaId);
    expect(english.rendition).toEqual(finnish.rendition);
  });

  it("falls back to the site's own language for alternative text", () => {
    const media = project(documentOf(), {
      language: "sv",
      fallbackLanguage: "fi",
    });

    expect(media.alt).toBe("Kivinen rantaviiva tyynen veden äärellä");
  });

  it("publishes no caption in a language it was not written in", () => {
    // A caption is editorial prose. Showing the Finnish one on an English page
    // is the mistake the page description already refuses to make; alternative
    // text falls back because silence there is worse.
    const media = project(documentOf(), englishRoute);

    expect(media.caption).toBeUndefined();
    expect(media.alt).toBe("Rocky shoreline beside calm water");
  });

  it("treats blank authored text as absent rather than as an empty caption", () => {
    const media = project(
      documentOf({ caption: [{ language: "fi", value: "   " }] }),
    );

    expect(media.caption).toBeUndefined();
  });

  it("keeps its identity across reprocessing while the delivery URL moves", () => {
    const before = project(documentOf());
    const after = project(
      documentOf({ asset: assetOf({ sha1hash: REPROCESSED_HASH, width: 2048, height: 1365 }) }),
    );

    expect(after.mediaId).toBe(before.mediaId);
    expect(after.rendition.version).not.toBe(before.rendition.version);
    expect(after.rendition.src).not.toBe(before.rendition.src);
    expect(after.rendition.width).toBe(2048);
  });

  it("gives every reuse of one document the same identity and bytes", () => {
    // Two placements, two pages, one photograph. Nothing about where it is
    // shown reaches this projection, so nothing about where it is shown can
    // make two copies of it disagree.
    const first = project(documentOf());
    const second = project(documentOf(), englishRoute);

    expect(second.mediaId).toBe(first.mediaId);
    expect(second.rendition.src).toBe(first.rendition.src);
    expect(second.rendition.version).toBe(first.rendition.version);
  });
});

describe("refusing what cannot be published", () => {
  it("refuses a video, because the site cannot deliver one yet", () => {
    const error = rejectionOf(() =>
      project(documentOf({ mediaType: "video", asset: undefined })),
    );

    expect(error.rejection).toBe("undeliverable-media-type");
    expect(error.mediaId).toBe("coastal-landscape");
  });

  it("refuses an unrecognized kind rather than assuming it is a photograph", () => {
    expect(rejectionOf(() => project(documentOf({ mediaType: undefined }))).rejection).toBe(
      "incomplete-document",
    );
  });

  it("refuses a document with no identity", () => {
    expect(rejectionOf(() => project(documentOf({ mediaId: "  " }))).rejection).toBe(
      "incomplete-document",
    );
  });

  it("refuses a photograph nobody described", () => {
    const error = rejectionOf(() => project(documentOf({ alt: [] })));

    expect(error.rejection).toBe("incomplete-document");
    expect(error.message).toContain("alternative text");
  });

  it.each([
    ["switched off", false],
    ["never set", undefined],
  ])("refuses a photograph whose public renderability is %s", (_case, value) => {
    const document = documentOf({ publiclyRenderable: value });

    expect(isPubliclyRenderable(document)).toBe(false);
    expect(rejectionOf(() => project(document)).rejection).toBe("not-public");
  });

  it("refuses a master-sized upload with the limit in the message", () => {
    const error = rejectionOf(() =>
      project(
        documentOf({
          asset: assetOf({ width: 6000, height: 4000, sha1hash: REPROCESSED_HASH }),
        }),
      ),
    );

    expect(error.rejection).toBe("unpublishable-asset");
    expect(error.message).toContain(`${MAX_PUBLIC_DELIVERY_DIMENSION}px`);
  });

  it("accepts a derivative exactly at the delivery limit", () => {
    const media = project(
      documentOf({
        asset: assetOf({ width: MAX_PUBLIC_DELIVERY_DIMENSION, height: 1365 }),
      }),
    );

    expect(media.rendition.width).toBe(MAX_PUBLIC_DELIVERY_DIMENSION);
  });

  it.each([
    [
      "another project's asset",
      assetOf({
        url: `https://cdn.sanity.io/images/otherproj/production/${EXPORTED_HASH}-1600x1067.webp`,
      }),
    ],
    [
      "another dataset's asset",
      assetOf({
        url: `https://cdn.sanity.io/images/zp7mbokg/staging/${EXPORTED_HASH}-1600x1067.webp`,
      }),
    ],
    [
      "an unencrypted URL",
      assetOf({
        url: `http://cdn.sanity.io/images/zp7mbokg/production/${EXPORTED_HASH}-1600x1067.webp`,
      }),
    ],
    [
      "a transformed URL",
      assetOf({
        url: `https://cdn.sanity.io/images/zp7mbokg/production/${EXPORTED_HASH}-1600x1067.webp?rect=0,0,800,800`,
      }),
    ],
    [
      "a URL whose hash is not the asset's",
      assetOf({
        url: `https://cdn.sanity.io/images/zp7mbokg/production/${REPROCESSED_HASH}-1600x1067.webp`,
      }),
    ],
    [
      "dimensions the URL disagrees with",
      { ...assetOf(), width: 1601 },
    ],
    [
      "a camera format",
      assetOf({ extension: "tif", mimeType: "image/tiff" }),
    ],
    [
      "a media type that contradicts the extension",
      assetOf({ mimeType: "image/jpeg" }),
    ],
    ["no asset at all", undefined],
  ])("refuses %s", (_case, asset) => {
    expect(rejectionOf(() => project(documentOf({ asset }))).rejection).toBe(
      "unpublishable-asset",
    );
  });
});

describe("the query contract", () => {
  it("asks only for fields the schema declares", () => {
    const declared = new Set(mediaType.fields.map((field) => field.name));

    for (const field of [...PROJECTED_MEDIA_FIELDS, ...ORDERED_MEDIA_FIELDS]) {
      expect(declared.has(field)).toBe(true);
      expect(PUBLIC_MEDIA_PROJECTION + PUBLIC_MEDIA_ORDER).toContain(field);
    }

    expect(MEDIA_DOCUMENT_TYPE).toBe(mediaType.name);
  });

  it("leaves the archive location in the content store", () => {
    // Declared, so an editor can record where a master lives — and never read,
    // so no query can carry it out.
    expect(mediaType.fields.map((field) => field.name)).toContain(
      "archiveLocator",
    );
    expect(PUBLIC_MEDIA_PROJECTION).not.toContain("archiveLocator");
    expect([...PROJECTED_MEDIA_FIELDS, ...ORDERED_MEDIA_FIELDS]).not.toContain(
      "archiveLocator",
    );
  });

  it("projects an allow-list rather than spreading a document", () => {
    expect(PUBLIC_MEDIA_PROJECTION).not.toContain("...");
  });

  it("combines the visibility decisions in one filter", () => {
    expect(PUBLIC_MEDIA_FILTER).toBe(
      '_type == "media" && publiclyRenderable == true',
    );
  });

  it("orders by capture date with undated work last and a total tie-break", () => {
    expect(PUBLIC_MEDIA_ORDER).toBe(
      'order(coalesce(capturedAt, "") desc, mediaId asc)',
    );
  });
});

type RecordedQuery = SanityQueryRequest;

function stubClient(answer: unknown): {
  client: SanityClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    client: {
      async query(request) {
        queries.push(request);
        return answer;
      },
    },
  };
}

describe("reading a photograph by its identity", () => {
  it("parameterizes the identity and tags the read", async () => {
    const { client, queries } = stubClient([documentOf()]);

    const media = await readPublicMediaById("coastal-landscape", {
      language: "fi",
      client,
      config,
    });

    expect(media?.mediaId).toBe("coastal-landscape");
    expect(queries[0].params).toEqual({ mediaId: "coastal-landscape" });
    expect(queries[0].tag).toBe("media.detail");
    expect(queries[0].query).toContain(PUBLIC_MEDIA_FILTER);
    // Interpolating an identity into GROQ would make a content read a place
    // where a caller's string becomes query syntax.
    expect(queries[0].query).not.toContain("coastal-landscape");
  });

  it("answers undefined when this deployment publishes no such photograph", async () => {
    const { client } = stubClient([]);

    await expect(
      readPublicMediaById("missing", { language: "fi", client, config }),
    ).resolves.toBeUndefined();
  });

  it("reports two documents claiming one identity instead of picking one", async () => {
    const { client, queries } = stubClient([documentOf(), documentOf()]);

    await expect(
      readPublicMediaById("coastal-landscape", { language: "fi", client, config }),
    ).rejects.toMatchObject({ rejection: "ambiguous-media-id" });
    // Two rows are enough to know; the read never asks for the whole archive.
    expect(queries[0].query).toContain("[0...2]");
  });
});

describe("listing publishable photographs", () => {
  it("bounds the page and orders it server-side", async () => {
    const { client, queries } = stubClient([documentOf()]);

    const media = await readPublicMedia({
      language: "fi",
      limit: 5000,
      client,
      config,
    });

    expect(media).toHaveLength(1);
    expect(queries[0].params).toEqual({ limit: MAX_PUBLIC_MEDIA_PAGE_SIZE });
    expect(queries[0].query).toContain(PUBLIC_MEDIA_ORDER);
    expect(queries[0].tag).toBe("media.list");
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["not a number", Number.NaN],
  ])("asks for nothing when the bound is %s", async (_case, limit) => {
    // NaN survives a min/max clamp and serializes as `null`, which would turn a
    // bounded read into a rejected query rather than an empty answer.
    const { client, queries } = stubClient([documentOf()]);

    await expect(
      readPublicMedia({ language: "fi", limit, client, config }),
    ).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("does not query at all for an empty page", async () => {
    const { client, queries } = stubClient([documentOf()]);

    await expect(
      readPublicMedia({ language: "fi", limit: 0, client, config }),
    ).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("lists only what the site can deliver", async () => {
    const { client, queries } = stubClient([]);

    await readPublicMedia({ language: "fi", limit: 10, client, config });

    expect(queries[0].query).toContain('mediaType == "image"');
  });
});

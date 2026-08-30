import { describe, expect, it } from "vitest";

import {
  ENQUIRY_MEDIA_PROJECTION,
  GALLERY_DOCUMENT_TYPE,
  GALLERY_PLACEMENT_DOCUMENT_TYPE,
  MAX_ARCHIVE_LOCATOR_LENGTH,
  MEDIA_DOCUMENT_TYPE,
  resolveSanityEnquiryTarget,
} from "@/lib/sanity-enquiry-media";
import { EnquiryResolutionError, type EnquiryTargetRequest } from "@/lib/enquiry-media";
import { PUBLIC_MEDIA_PROJECTION } from "@/lib/sanity-media";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import { galleryType } from "../../sanity/schemas/gallery";
import { galleryPlacementType } from "../../sanity/schemas/gallery-placement";
import {
  defineMediaType,
  MAX_ARCHIVE_LOCATOR_LENGTH as SCHEMA_MAX_ARCHIVE_LOCATOR_LENGTH,
} from "../../sanity/schemas/media";

type Handler = (request: SanityQueryRequest) => unknown;

function fakeClient(handler: Handler): {
  client: SanityClient;
  requests: SanityQueryRequest[];
} {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        return handler(request);
      },
    },
  };
}

const CURATED: EnquiryTargetRequest = {
  kind: "curated",
  locale: "en-GB",
  contentId: "content-northern-coast",
  itemId: "northern-coast-lead",
};

function mediaRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mediaId: "northern-coast",
    publiclyRenderable: true,
    enquiryEligible: true,
    archiveLocator: "/Volumes/Archive/2020/coast/DSCF0042.RAF",
    credit: "Placeholder credit",
    caption: [
      { language: "en", value: "Media default caption" },
      { language: "fi", value: "Median oletuskuvateksti" },
    ],
    ...overrides,
  };
}

function placementRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    placementId: "northern-coast-lead",
    visible: true,
    sectionId: "leads",
    captionOverride: "This exact placement",
    media: mediaRow(),
    ...overrides,
  };
}

/** Answers the two query tags, resolving the gallery id by requested language. */
function twoStep(options: {
  galleryRowsByLanguage?: Record<string, unknown[]>;
  placementRows?: unknown[];
}): Handler {
  const galleryRowsByLanguage = options.galleryRowsByLanguage ?? {
    en: [{ _id: "gallery-en" }],
    fi: [{ _id: "gallery-fi" }],
  };
  return (request) => {
    if (request.tag === "enquiry.gallery") {
      const language = String(request.params?.language ?? "");
      return galleryRowsByLanguage[language] ?? [];
    }
    if (request.tag === "enquiry.placement") {
      return options.placementRows ?? [placementRow()];
    }
    throw new Error(`unexpected tag ${request.tag}`);
  };
}

async function rejectionOf(
  run: () => Promise<unknown>,
): Promise<InstanceType<typeof EnquiryResolutionError>> {
  try {
    await run();
  } catch (error) {
    if (error instanceof EnquiryResolutionError) return error;
    throw error;
  }
  throw new Error("expected resolveSanityEnquiryTarget to throw");
}

describe("document type names and bounds are pinned to the Studio schema", () => {
  it("matches the schema's own type names", () => {
    expect(GALLERY_DOCUMENT_TYPE).toBe(galleryType.name);
    expect(GALLERY_PLACEMENT_DOCUMENT_TYPE).toBe(galleryPlacementType.name);
    expect(MEDIA_DOCUMENT_TYPE).toBe(
      defineMediaType({ datasetVisibility: "private" }).name,
    );
  });

  it("keeps the archive-locator bound equal to the schema's, as a separate constant", () => {
    expect(MAX_ARCHIVE_LOCATOR_LENGTH).toBe(SCHEMA_MAX_ARCHIVE_LOCATOR_LENGTH);
  });
});

describe("the enquiry media projection stays apart from the public one", () => {
  it("carries the server-only fields the public projection must never mention", () => {
    expect(ENQUIRY_MEDIA_PROJECTION).toContain("archiveLocator");
    expect(ENQUIRY_MEDIA_PROJECTION).toContain("enquiryEligible");
    expect(PUBLIC_MEDIA_PROJECTION).not.toContain("archiveLocator");
    expect(PUBLIC_MEDIA_PROJECTION).not.toContain("enquiryEligible");
  });
});

describe("resolveSanityEnquiryTarget — curated", () => {
  it("resolves the placement scoped to this language's gallery document", async () => {
    const { client, requests } = fakeClient(twoStep({}));

    const target = await resolveSanityEnquiryTarget(CURATED, "en", { client });

    expect(target).toEqual({
      kind: "curated",
      mediaId: "northern-coast",
      placementId: "northern-coast-lead",
      contentId: "content-northern-coast",
      sectionId: "leads",
      archiveLocator: "/Volumes/Archive/2020/coast/DSCF0042.RAF",
      caption: "This exact placement",
      credit: "Placeholder credit",
    });
    // The placement query was scoped by the gallery id the first query resolved,
    // never by placementId alone.
    const placementRequest = requests.find((r) => r.tag === "enquiry.placement");
    expect(placementRequest?.params).toMatchObject({
      galleryId: "gallery-en",
      itemId: "northern-coast-lead",
    });
  });

  it("selects the requested language's gallery — a sibling placement sharing one placementId is not ambiguous", async () => {
    // The placement query is the same shape in both languages, and returns one
    // row with no override, so the caption falls to the media's own localized
    // entry. Because the query was scoped by a language-specific gallery id, the
    // shared placementId never causes a wrong-language match.
    const noOverride = twoStep({
      placementRows: [placementRow({ captionOverride: undefined })],
    });
    const en = fakeClient(noOverride);
    const fi = fakeClient(noOverride);

    const enTarget = await resolveSanityEnquiryTarget(CURATED, "en", {
      client: en.client,
    });
    const fiTarget = await resolveSanityEnquiryTarget(CURATED, "fi", {
      client: fi.client,
    });

    expect(enTarget.caption).toBe("Media default caption");
    expect(fiTarget.caption).toBe("Median oletuskuvateksti");
    expect(
      en.requests.find((r) => r.tag === "enquiry.placement")?.params,
    ).toMatchObject({ galleryId: "gallery-en" });
    expect(
      fi.requests.find((r) => r.tag === "enquiry.placement")?.params,
    ).toMatchObject({ galleryId: "gallery-fi" });
  });

  it("omits the archive locator when the media has none", async () => {
    const { client } = fakeClient(
      twoStep({
        placementRows: [placementRow({ media: mediaRow({ archiveLocator: undefined }) })],
      }),
    );

    const target = await resolveSanityEnquiryTarget(CURATED, "en", { client });
    expect("archiveLocator" in target).toBe(false);
  });

  it("treats a missing gallery document as the store disagreeing with the tree", async () => {
    const { client } = fakeClient(twoStep({ galleryRowsByLanguage: { en: [] } }));
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "malformed-source",
    );
  });

  it("treats two gallery documents for one identity as malformed", async () => {
    const { client } = fakeClient(
      twoStep({ galleryRowsByLanguage: { en: [{ _id: "a" }, { _id: "b" }] } }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "malformed-source",
    );
  });

  it("rejects an absent placement as unknown-item", async () => {
    const { client } = fakeClient(twoStep({ placementRows: [] }));
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "unknown-item",
    );
  });

  it("rejects two matching placement rows as malformed", async () => {
    const { client } = fakeClient(
      twoStep({ placementRows: [placementRow(), placementRow()] }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "malformed-source",
    );
  });

  it("rejects a hidden placement as an unavailable container", async () => {
    const { client } = fakeClient(
      twoStep({ placementRows: [placementRow({ visible: false })] }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "container-unavailable",
    );
  });

  it("rejects a photograph not opted in to enquiries", async () => {
    const { client } = fakeClient(
      twoStep({ placementRows: [placementRow({ media: mediaRow({ enquiryEligible: false }) })] }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "not-enquirable",
    );
  });

  it("rejects a photograph that is not publicly renderable", async () => {
    const { client } = fakeClient(
      twoStep({ placementRows: [placementRow({ media: mediaRow({ publiclyRenderable: false }) })] }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "not-public",
    );
  });

  it("hard-excludes a private-only photograph even when the public flags say yes (ADR-0002 §4)", async () => {
    // No schema defines `privateOnly` yet (AB#122), but an import could set it,
    // and it is never inferred from the other flags — so the projection reads
    // it and fails closed.
    const { client } = fakeClient(
      twoStep({
        placementRows: [
          placementRow({
            media: mediaRow({
              publiclyRenderable: true,
              enquiryEligible: true,
              privateOnly: true,
            }),
          }),
        ],
      }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "not-public",
    );
  });

  it.each([
    ["a number", 12 as unknown],
    ["a blank string", "   "],
    ["an over-long string", "x".repeat(MAX_ARCHIVE_LOCATOR_LENGTH + 1)],
  ])("rejects an archive locator that is %s", async (_label, archiveLocator) => {
    const { client } = fakeClient(
      twoStep({ placementRows: [placementRow({ media: mediaRow({ archiveLocator }) })] }),
    );
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "malformed-source",
    );
  });

  it("rejects a placement row that is not a record", async () => {
    const { client } = fakeClient(twoStep({ placementRows: ["not-a-record"] }));
    expect((await rejectionOf(() => resolveSanityEnquiryTarget(CURATED, "en", { client }))).rejection).toBe(
      "malformed-source",
    );
  });
});

describe("resolveSanityEnquiryTarget — dynamic", () => {
  it("refuses a dynamic enquiry without querying the store", async () => {
    const { client, requests } = fakeClient(() => {
      throw new Error("the store must not be queried for a dynamic enquiry");
    });

    const error = await rejectionOf(() =>
      resolveSanityEnquiryTarget(
        { kind: "dynamic", locale: "en-GB", itemId: "northern-coast" },
        "en",
        { client },
      ),
    );

    expect(error.rejection).toBe("dynamic-unsupported");
    expect(requests).toHaveLength(0);
  });
});

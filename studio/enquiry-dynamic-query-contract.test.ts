import { evaluate, parse } from "groq-js/1";
import { describe, expect, it } from "vitest";

import { DYNAMIC_MEDIA_QUERY } from "../src/lib/sanity-enquiry-media";

// In-memory published fixtures model query semantics, not provider perspective or access control.
const query = async (dataset: Record<string, unknown>[], itemId: string) =>
  (await evaluate(parse(DYNAMIC_MEDIA_QUERY), { dataset, params: { itemId } })).get();

const media = (mediaId: string, extra: Record<string, unknown> = {}) => ({
  _id: `doc-${mediaId}`, _type: "media", mediaId, mediaType: "image", dynamicallyDiscoverable: true, publiclyRenderable: true, enquiryEligible: true, importedKeywords: { dcSubject: ["A private term"] }, ...extra,
});

describe("actual GROQ dynamic enquiry lookup", () => {
  it("finds the photograph by its own identity and reads only what the resolver uses", async () => {
    const rows = await query([media("wanted", { archiveLocator: "Drive A" }), media("another"), { _id: "x", _type: "galleryPlacement", mediaId: "wanted" }], "wanted");
    expect(rows).toEqual([{
      mediaType: "image",
      dynamicallyDiscoverable: true,
      media: { mediaId: "wanted", publiclyRenderable: true, enquiryEligible: true, privateOnly: null, archiveLocator: "Drive A", credit: null, caption: null },
    }]);
  });

  it("answers nothing for an unknown identity, and bounds a repeated one to two for the resolver to refuse", async () => {
    expect(await query([media("another")], "wanted")).toEqual([]);
    const repeated = ["a", "b", "c"].map((id) => ({ ...media("wanted"), _id: id }));
    expect(await query(repeated, "wanted")).toHaveLength(2);
  });
});

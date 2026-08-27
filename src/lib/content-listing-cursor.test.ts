import { describe, expect, it } from "vitest";
import {
  ContentListingCursorConfigurationError,
  ContentListingCursorError,
  loadContentListingCursorCodec,
  type ContentListingCursorScopeInput,
} from "@/lib/content-listing-cursor";

const SETTING = "GALLERY_CURSOR_SIGNING_KEY";
const KEY = "a-valid-test-content-listing-cursor-signing-key";

const codec = () => loadContentListingCursorCodec({ [SETTING]: KEY });

const scope: ContentListingCursorScopeInput = {
  locale: "en-GB",
  categoryId: "cat-gear",
  visibilityVersion: "v1:2024-01-01",
  pageSize: 24,
};

const boundary = { afterPublishedAt: "2024-06-18", afterContentId: "content-x" };

describe("loadContentListingCursorCodec", () => {
  it("round-trips a (publishedAt, contentId) boundary verbatim", () => {
    const c = codec();
    expect(c.decode(c.encode(scope, boundary), scope)).toEqual(boundary);
  });

  it("keeps a date-only publishedAt as its exact string (no timestamp round trip)", () => {
    const c = codec();
    const decoded = c.decode(
      c.encode(scope, { afterPublishedAt: "2024-02-29", afterContentId: "c" }),
      scope,
    );
    expect(decoded.afterPublishedAt).toBe("2024-02-29");
  });

  it("rejects a token minted for another branch", () => {
    const cursor = codec().encode(scope, boundary);
    expect(() =>
      codec().decode(cursor, { ...scope, categoryId: "cat-technique" }),
    ).toThrow(ContentListingCursorError);
  });

  it("rejects a token minted in another locale", () => {
    const cursor = codec().encode(scope, boundary);
    expect(() =>
      codec().decode(cursor, { ...scope, locale: "en-US" }),
    ).toThrow(/wrong-scope/);
  });

  it("rejects a token minted for a different page size", () => {
    const cursor = codec().encode(scope, boundary);
    expect(() =>
      codec().decode(cursor, { ...scope, pageSize: 12 }),
    ).toThrow(/wrong-scope/);
  });

  it("rejects a token once the branch's visibility version has moved (stale)", () => {
    const cursor = codec().encode(scope, boundary);
    expect(() =>
      codec().decode(cursor, { ...scope, visibilityVersion: "v2:2024-09-09" }),
    ).toThrow(/stale/);
  });

  it("rejects a tampered token", () => {
    const cursor = codec().encode(scope, boundary);
    expect(() => codec().decode(`${cursor}x`, scope)).toThrow(
      ContentListingCursorError,
    );
  });

  it("names the shared setting when the signing key is missing", () => {
    expect(() => loadContentListingCursorCodec({})).toThrow(
      ContentListingCursorConfigurationError,
    );
    expect(() => loadContentListingCursorCodec({})).toThrow(SETTING);
  });
});

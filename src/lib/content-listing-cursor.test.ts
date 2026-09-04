import { describe, expect, it } from "vitest";
import {
  ContentListingCursorConfigurationError,
  ContentListingCursorError,
  loadContentListingCursorCodec,
  type ContentListingCursorScopeInput,
} from "@/lib/content-listing-cursor";
import { CONTENT_LISTING_ORDERING } from "@/lib/content-listing";
import { createHmacKeysetCursorCodec } from "@/lib/keyset-cursor";

const SETTING = "GALLERY_CURSOR_SIGNING_KEY";
const KEY = "a-valid-test-content-listing-cursor-signing-key";

const codec = () => loadContentListingCursorCodec({ [SETTING]: KEY });

const scope: ContentListingCursorScopeInput = {
  locale: "en-GB",
  categoryId: "cat-gear",
  visibilityVersion: "v1:2024-01-01",
  pageSize: 24,
};

const boundary = { afterEventDate: "2024-06-18", afterContentId: "content-x" };

describe("loadContentListingCursorCodec", () => {
  it("round-trips an (eventDate, contentId) boundary verbatim", () => {
    const c = codec();
    expect(c.decode(c.encode(scope, boundary), scope)).toEqual(boundary);
  });

  it("keeps a date-only eventDate as its exact string (no timestamp round trip)", () => {
    const c = codec();
    const decoded = c.decode(
      c.encode(scope, { afterEventDate: "2024-02-29", afterContentId: "c" }),
      scope,
    );
    expect(decoded.afterEventDate).toBe("2024-02-29");
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

  // AB#150, ADR-0017 decision 4: a cursor minted under the pre-migration
  // `published-desc-v1` ordering rule must decode as `wrong-scope` — never a
  // silently valid position under the new effective-event-date order. The
  // low-level `keyset-cursor.ts` codec mints exactly such a cursor directly,
  // since `loadContentListingCursorCodec` itself only ever emits the current
  // `CONTENT_LISTING_ORDERING` value.
  it("rejects a pre-migration published-desc-v1 cursor as wrong-scope", () => {
    expect(CONTENT_LISTING_ORDERING).toBe("event-date-desc-v1");

    const legacyOrdering = "published-desc-v1";
    const legacyCursor = createHmacKeysetCursorCodec(KEY).encode(
      {
        sourceId: "content-listing",
        normalizedFilter: `${scope.locale} ${scope.categoryId}`,
        ordering: legacyOrdering,
        visibilityVersion: scope.visibilityVersion,
        pageSize: scope.pageSize,
      },
      boundary.afterEventDate,
      boundary.afterContentId,
    );

    expect(() => codec().decode(legacyCursor, scope)).toThrow(/wrong-scope/);
  });
});

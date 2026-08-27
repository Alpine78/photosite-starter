import { describe, expect, it } from "vitest";
import {
  KeysetCursorConfigurationError,
  KeysetCursorError,
  createHmacKeysetCursorCodec,
  loadKeysetCursorSigningKey,
  type KeysetCursorScope,
} from "@/lib/keyset-cursor";

const KEY = "a-valid-test-keyset-cursor-signing-key-value";
const OTHER_KEY = "a-different-test-keyset-cursor-signing-key-value";

const scope: KeysetCursorScope = {
  sourceId: "content-listing",
  normalizedFilter: "en cat-gear",
  ordering: "published-desc-v1",
  visibilityVersion: "abc:2024-01-01T00:00:00Z",
  pageSize: 24,
};

describe("createHmacKeysetCursorCodec", () => {
  it("round-trips a numeric boundary key", () => {
    const codec = createHmacKeysetCursorCodec(KEY);
    const decoded = codec.decode(codec.encode(scope, 42, "id-42"), scope);
    expect(decoded).toEqual({ afterKey: 42, afterId: "id-42" });
  });

  it("round-trips a string boundary key verbatim", () => {
    const codec = createHmacKeysetCursorCodec(KEY);
    const decoded = codec.decode(
      codec.encode(scope, "2024-06-18", "content-x"),
      scope,
    );
    expect(decoded).toEqual({ afterKey: "2024-06-18", afterId: "content-x" });
  });

  it("rejects a tampered token", () => {
    const codec = createHmacKeysetCursorCodec(KEY);
    const cursor = codec.encode(scope, "2024-06-18", "content-x");
    const [payload, sig] = cursor.split(".");
    const tampered = `${payload}x.${sig}`;
    expect(() => codec.decode(tampered, scope)).toThrow(KeysetCursorError);
  });

  it("rejects a token minted under a different key", () => {
    const cursor = createHmacKeysetCursorCodec(KEY).encode(
      scope,
      "2024-06-18",
      "content-x",
    );
    expect(() =>
      createHmacKeysetCursorCodec(OTHER_KEY).decode(cursor, scope),
    ).toThrow(/tampered/);
  });

  it("rejects a token whose query scope no longer matches (wrong-scope)", () => {
    const codec = createHmacKeysetCursorCodec(KEY);
    const cursor = codec.encode(scope, "2024-06-18", "content-x");
    expect(() =>
      codec.decode(cursor, { ...scope, normalizedFilter: "en cat-other" }),
    ).toThrow(/wrong-scope/);
    expect(() =>
      codec.decode(cursor, { ...scope, pageSize: 12 }),
    ).toThrow(/wrong-scope/);
  });

  it("rejects a token whose visibility version has moved on (stale)", () => {
    const codec = createHmacKeysetCursorCodec(KEY);
    const cursor = codec.encode(scope, "2024-06-18", "content-x");
    expect(() =>
      codec.decode(cursor, { ...scope, visibilityVersion: "abc:2024-02-02" }),
    ).toThrow(/stale/);
  });

  it("refuses an insecurely short signing key", () => {
    expect(() => createHmacKeysetCursorCodec("too-short")).toThrow();
  });
});

describe("loadKeysetCursorSigningKey", () => {
  const SETTING = "GALLERY_CURSOR_SIGNING_KEY";

  it("returns the configured key", () => {
    expect(loadKeysetCursorSigningKey({ [SETTING]: KEY })).toBe(KEY);
  });

  it("names the setting when it is missing or empty", () => {
    expect(() => loadKeysetCursorSigningKey({})).toThrow(
      KeysetCursorConfigurationError,
    );
    expect(() => loadKeysetCursorSigningKey({})).toThrow(SETTING);
    expect(() => loadKeysetCursorSigningKey({ [SETTING]: "" })).toThrow(SETTING);
  });

  it("refuses a key mirrored under a NEXT_PUBLIC_ name", () => {
    expect(() =>
      loadKeysetCursorSigningKey({
        [SETTING]: KEY,
        [`NEXT_PUBLIC_${SETTING}`]: KEY,
      }),
    ).toThrow(/NEXT_PUBLIC_/);
  });
});

import { describe, expect, it } from "vitest";
import { buildPrivateDraftCursor, readPrivateDraftCursor } from "./private-gallery-draft-cursor";
const handle = "A".repeat(22);
describe("private draft list cursors", () => {
  it.each(["proof", "delivery"] as const)("roundtrips only a scoped opaque %s anchor", (kind) => {
    const token = buildPrivateDraftCursor(kind, handle);
    expect(readPrivateDraftCursor("https://example.test/admin?cursor=" + token, kind)).toBe(handle);
    expect(readPrivateDraftCursor(undefined, kind)).toBeUndefined();
    expect(readPrivateDraftCursor("https://example.test/admin", kind)).toBeUndefined();
    expect(() => readPrivateDraftCursor("https://example.test/admin?cursor=" + token, kind === "proof" ? "delivery" : "proof")).toThrow("invalid-input");
  });
  it.each(["cursor=", "cursor=!", "cursor=" + "A".repeat(257), "cursor=x&cursor=y", "cursor=x&_=1", "_=1",
    "cursor=" + Buffer.from(JSON.stringify(["private-draft-v1", "proof", handle, "extra"])).toString("base64url"),
    "cursor=" + Buffer.from(JSON.stringify(["private-draft-v1", "proof", "bad"])).toString("base64url"),
    "cursor=" + Buffer.from(' ["private-draft-v1","proof","' + handle + '"]').toString("base64url")])("rejects malformed query without echoing %s", (query) => {
    expect(() => readPrivateDraftCursor("https://example.test/admin?" + query, "proof")).toThrow("[private-gallery-draft-cursor] invalid-input");
  });
});

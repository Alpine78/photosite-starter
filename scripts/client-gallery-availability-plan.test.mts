import { describe, expect, it } from "vitest";
import { validateClientDeliveryGallery } from "../sanity/schemas/client-delivery-gallery";
import { clientGalleryAvailable, parseClientGallery } from "../src/lib/client-gallery-model";
import { AVAILABILITY_INPUT_BYTES, AVAILABILITY_NOTICES, availabilityJson, planClientGalleryAvailability as plan, verifyClientGalleryAvailability as verify } from "./client-gallery-availability-plan.mts";

const at = "2026-10-17T00:00:00Z", handle = "a".repeat(32), asset = `image-${"b".repeat(40)}-1600x1000-webp`;
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
function snapshot() { return { _id: "client-one", _type: "clientDeliveryGallery", _rev: "revision-one", handle, available: false, availabilityMode: "indefinite",
  items: [{ _key: "one", _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: { _type: "reference", _ref: asset }, hotspot: { x: 0.5, y: 0.5, width: 1, height: 1 } }, alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Coast" }] }] }; }
const enable = { available: true, availabilityMode: "indefinite" };
describe("offline Sanity availability planning", () => {
  it("produces a deterministic fixed patch without copying handles or image content", () => {
    const source = snapshot(), result = plan(bytes(source), bytes(enable), at);
    const reordered = Object.fromEntries(Object.entries(source).reverse());
    expect(plan(bytes(reordered), bytes(enable), "2026-10-17T00:00:00.000Z")).toEqual(result);
    expect(result.patch).toEqual({ id: source._id, ifRevisionID: source._rev, set: enable, unset: ["expiryInstant"] });
    expect(JSON.stringify(result)).not.toContain(handle); expect(JSON.stringify(result)).not.toContain(asset); expect(JSON.stringify(result)).not.toContain("Coast");
    expect(result).toMatchObject({ readyToWrite: false, eligibilityChecked: false, notices: AVAILABILITY_NOTICES });
    expect(result.notices.join(" ")).toContain("no asset revocation, unpublication or removal from the dataset");
    expect(result.notices.join(" ")).toContain("refuse an existing draft");
    expect(verify(bytes(result), bytes(source), result.planSha256, at)).toMatchObject({ readyToWrite: false, offlineOnly: true, patch: result.patch });
  });
  it("uses an exclusive deadline and allows pausing an already expired published page", () => {
    const until = { available: true, availabilityMode: "until", expiryInstant: "2026-10-17T00:00:01Z" };
    const result = plan(bytes(snapshot()), bytes(until), at);
    expect(verify(bytes(result), bytes(snapshot()), result.planSha256, "2026-10-17T00:00:00.999Z").patch).toEqual(result.patch);
    expect(() => verify(bytes(result), bytes(snapshot()), result.planSha256, until.expiryInstant)).toThrow("DEADLINE_PASSED");
    expect(() => plan(bytes(snapshot()), bytes({ ...until, expiryInstant: at }), at)).toThrow("DEADLINE_PASSED");
    expect(plan(bytes({ ...snapshot(), available: true }), bytes({ ...until, available: false, expiryInstant: at }), at).patch.set.available).toBe(false);
    expect(() => verify(bytes(result), bytes(snapshot()), result.planSha256, "2026-10-16T00:00:00Z")).toThrow("VERIFICATION_BEFORE_PLAN");
  });
  it.each(["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-10-17", "2026-10-17T00:00:00+00:00", "2026-10-17T00:00:00.1Z", at + "\n"])("refuses a noncanonical or invalid instant %j", (instant) => {
    expect(() => plan(bytes(snapshot()), bytes(enable), instant)).toThrow("INVALID_INSTANT");
  });
  it("accepts a real leap day and normalized UTC milliseconds", () => {
    expect(plan(bytes(snapshot()), bytes({ available: true, availabilityMode: "until", expiryInstant: "2028-02-29T12:00:00Z" }), at).intent.expiryInstant).toBe("2028-02-29T12:00:00.000Z");
  });
  it.each([{ _type: "legacyDeliveryGallery" }, { _id: "drafts.client-one" }, { _id: "versions.release.client-one" }, { _rev: "" }, { customerEmail: "synthetic@example.test" }, { items: [] }, { handle: handle + "\n" }])("refuses unsupported snapshot headers %#", (change) => {
    expect(() => plan(bytes({ ...snapshot(), ...change }), bytes(enable), at)).toThrow();
  });
  it.each([{ ...enable, image: "forbidden" }, { ...enable, handle }, { ...enable, expiryInstant: at }, { available: "true", availabilityMode: "indefinite" }, { available: true }, { ...enable, availabilityMode: "unknown" }])("refuses arbitrary or incomplete intent %#", (intent) => {
    expect(() => plan(bytes(snapshot()), bytes(intent), at)).toThrow();
  });
  it("rejects no-ops and records that image eligibility is not checked", () => {
    expect(() => plan(bytes(snapshot()), bytes({ ...enable, available: false }), at)).toThrow("NO_CHANGE");
    const source = { ...snapshot(), items: [{ unsupportedImage: "not inspected" }] };
    expect(plan(bytes(source), bytes(enable), at).eligibilityChecked).toBe(false);
  });
  it("binds ID, revision, complete ordered membership and even same-revision changes", () => {
    const source = snapshot(); source.items.push({ ...source.items[0], _key: "two" });
    const result = plan(bytes(source), bytes(enable), at);
    for (const changed of [{ ...source, _id: "other" }, { ...source, _rev: "revision-two" }, { ...source, handle: "c".repeat(32) }, { ...source, items: [...source.items].reverse() }]) {
      expect(() => verify(bytes(result), bytes(changed), result.planSha256, at)).toThrow("PLAN_OR_SOURCE_CHANGED");
    }
  });
  it("refuses altered plans, versions, patches, notices and approval digests", () => {
    const result = plan(bytes(snapshot()), bytes(enable), at);
    for (const changed of [{ ...result, format: "future" }, { ...result, unexpected: true }, { ...result, notices: [] }, { ...result, patch: { ...result.patch, unset: ["items"] } }, { ...result, intent: { ...enable, available: false } }]) {
      expect(() => verify(bytes(changed), bytes(snapshot()), result.planSha256, at)).toThrow();
    }
    expect(() => verify(bytes(result), bytes(snapshot()), "0".repeat(64), at)).toThrow("APPROVAL_MISMATCH");
  });
  it("preserves native schema compatibility after applying only the fixed patch", async () => {
    const source = snapshot(), result = plan(bytes(source), bytes({ available: true, availabilityMode: "until", expiryInstant: "2028-02-29T00:00:00Z" }), at);
    const client = { withConfig() { return this; }, async fetch(query: string) { return query.includes('"conflicts"') ? { conflicts: [], published: { _type: source._type, handle } } : [{ _id: asset, _type: "sanity.imageAsset", sha1hash: "b".repeat(40), extension: "webp", mimeType: "image/webp", width: 1600, height: 1000, restricted: false }]; } };
    expect(await validateClientDeliveryGallery({ ...source, ...result.patch.set }, { getClient: () => client as never })).toBe(true);
  });
  it("matches the customer's exact expiry boundary and indefinite/pause semantics", () => {
    const source = snapshot();
    const result = plan(bytes(source), bytes({ available: true, availabilityMode: "until", expiryInstant: "2026-10-17T00:00:01Z" }), at);
    const parsed = parseClientGallery({ ...source, ...result.patch.set }, source._id, handle);
    expect(clientGalleryAvailable(parsed, Date.parse("2026-10-17T00:00:00.999Z"))).toBe(true);
    expect(clientGalleryAvailable(parsed, Date.parse("2026-10-17T00:00:01Z"))).toBe(false);
    for (const available of [true, false]) {
      const current = { ...source, available: !available };
      const patch = plan(bytes(current), bytes({ ...enable, available }), at).patch;
      const target = parseClientGallery({ ...current, ...patch.set }, source._id, handle);
      expect(clientGalleryAvailable(target, Date.parse(at))).toBe(available);
    }
  });
});
describe("bounded operator JSON", () => {
  it.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"x":-0}', '{"x":9007199254740992}', '{"x":1e999}', '\ufeff{}', '{} trailing', '{"private-handle":"' + handle])("rejects malformed JSON without source excerpts %#", (text) => {
    expect(() => availabilityJson(Buffer.from(text))).toThrow("INVALID_JSON");
  });
  it("bounds bytes, depth and nodes before canonicalization; keeps valid fractional geometry", () => {
    expect(() => availabilityJson(Buffer.alloc(AVAILABILITY_INPUT_BYTES + 1))).toThrow("INPUT_LIMIT");
    expect(() => availabilityJson(Buffer.from("[".repeat(34) + "0" + "]".repeat(34)))).toThrow("INVALID_JSON");
    expect(() => availabilityJson(bytes(Array.from({ length: 20_001 }, () => 0)))).toThrow("INVALID_JSON");
    expect(() => availabilityJson(Buffer.from([0xc3, 0x28]))).toThrow("INVALID_JSON");
    expect(availabilityJson(bytes({ hotspot: 0.5 }))).toEqual({ hotspot: 0.5 });
  });
});

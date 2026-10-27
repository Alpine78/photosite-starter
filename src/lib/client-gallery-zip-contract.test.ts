import { describe, expect, it, vi } from "vitest";
import { clientGalleryZipUrl, parseClientGalleryZipAsset, parseClientGalleryZipReference } from "./client-gallery-zip-contract";
const id = `file-${"a".repeat(40)}-zip`;
const reference = () => ({ _type: "file", asset: { _type: "reference", _ref: id } });
describe("closed technical ZIP identities", () => {
  it.each([null, undefined])("keeps absence optional: %s", value => expect(parseClientGalleryZipReference(value)).toBeUndefined());
  it.each(["project\n", "../project", "https://other.test", "PROJECT", ""]) ("rejects unsafe URL targets without normalization: %j", project => {
    expect(() => clientGalleryZipUrl(project, "production", id)).toThrow("Invalid client gallery ZIP");
    expect(() => clientGalleryZipUrl("project", project, id)).toThrow("Invalid client gallery ZIP");
  });
  it("does not execute accessors or accept inherited/nonenumerable/symbol reference fields", () => {
    const getter = vi.fn(() => { throw new Error("PRIVATE"); });
    for (const value of [Object.create(reference()), Object.defineProperty(reference(), "asset", { get: getter }),
      Object.defineProperty(reference(), "asset", { enumerable: false }), Object.assign(reference(), { [Symbol("extra")]: 1 })]) {
      expect(() => parseClientGalleryZipReference(value)).toThrow("Invalid client gallery ZIP");
    }
    expect(getter).not.toHaveBeenCalled();
    expect(() => parseClientGalleryZipAsset(Object.defineProperty({}, "_id", { get: getter }), id)).toThrow("Invalid client gallery ZIP");
    expect(getter).not.toHaveBeenCalled();
  });
});

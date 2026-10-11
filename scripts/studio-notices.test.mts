import { describe, expect, it } from "vitest";
import { installedPackagePaths, isNoticeFile, packageNotice } from "./studio-notices.mts";

describe("Studio dependency notices", () => {
  it("accepts scoped and nested lock entries, omitting the root", () => {
    expect(installedPackagePaths({ "": {}, "node_modules/@scope/pkg/node_modules/child": {}, "node_modules/pkg": {} }))
      .toEqual(["node_modules/@scope/pkg/node_modules/child", "node_modules/pkg"]);
  });
  it.each(["../private", "node_modules/../private", "node_modules/pkg/../../private", "node_modules/pkg/LICENSE", "node_modules/pkg\\..\\private"])(
    "rejects a lock path that could read outside an installed package: %s", (path) => {
      expect(() => installedPackagePaths({ [path]: {} })).toThrow("Invalid Studio dependency path");
    },
  );
  it("recognizes common standalone license and attribution filenames", () => {
    expect(["LICENSE", "LICENSE-MIT", "LICENCE.txt", "NOTICE", "COPYING.md"].every(isNoticeFile)).toBe(true);
    expect(["package.json", "index.js", "LICENSES"].some(isNoticeFile)).toBe(false);
  });
  it("preserves the complete original notice and source/artifact references", () => {
    const original = "LICENSE\nOriginal copyright\nComplete permission and conditions.\n";
    const notice = packageNotice({ name: "example", version: "1.0.0", license: { type: "MIT" }, repository: { url: "https://example.com/source" } }, "https://example.com/release.tgz", [original]);
    expect(notice).toContain(original);
    expect(notice).toContain("License: MIT");
    expect(notice).toContain("Upstream source: https://example.com/source");
    expect(notice).toContain("Upstream artifact: https://example.com/release.tgz");
  });
});

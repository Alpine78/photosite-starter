import { describe, expect, it } from "vitest";
import * as runtime from "./content-inline";
import * as studio from "../../sanity/schemas/content-inline";

for (const [name, api] of Object.entries({ runtime, studio })) {
  describe(`${name} inline text boundary`, () => {
    it("allows bounded HTTP(S), local paths and heading fragments", () => {
      for (const href of ["https://example.org/a?q=1#part", "http://example.org", "/stories/overview", "#gallery"]) {
        expect(api.isContentInlineHref(href), href).toBe(true);
      }
    });
    it("refuses executable schemes, network paths, credentials and URL parser evasions", () => {
      for (const href of ["javascript:alert(1)", "data:text/html,test", "//example.org", "/\\example.org", "/%2fexample.org", "https://user:password@example.org", " https://example.org", "https://example.org/\n", "https://example.org/%0a", "https:\\example.org", "#", "relative/path", "https://", "/" + "a".repeat(2048)]) {
        expect(api.isContentInlineHref(href), href).toBe(false);
      }
    });
    it("projects only text and href, retaining whitespace between linked words", () => {
      expect(api.readContentInlineSpans([
        {_type: "contentInlineSpan", _key: "a", text: "Read "},
        {_type: "contentInlineSpan", _key: "b", text: "this", href: "/stories"},
        {text: " ", href: null}, {text: "next"},
      ])).toEqual([{text: "Read "}, {text: "this", href: "/stories"}, {text: " "}, {text: "next"}]);
    });
    it("rejects malformed, blank, oversized and private fields at every nested boundary", () => {
      for (const spans of [[], null, [{text: " "}], [{text: " ", href: "/stories"}], [{text: "a", archiveLocator: "private"}], [{text: "a", href: 1}], [{text: "a", _type: "other"}], [{text: "a".repeat(10001)}], Array.from({length: 101}, () => ({text: "a"})), [{text: "a".repeat(6000)}, {text: "b".repeat(6000)}]]) {
        expect(() => api.readContentInlineSpans(spans)).toThrow();
      }
      expect(() => api.readContentRichItems([{spans: [{text: "a"}], private: "secret"}])).toThrow();
      expect(() => api.readContentRichItems(Array.from({length: 101}, () => ({spans: [{text: "a"}]})))).toThrow();
    });
  });
}
it("keeps standalone Studio and public projection bounds aligned", () => {
  for (const key of ["MAX_CONTENT_INLINE_SPANS", "MAX_CONTENT_INLINE_TEXT", "MAX_CONTENT_INLINE_HREF", "MAX_CONTENT_RICH_ITEMS"] as const) expect(runtime[key]).toBe(studio[key]);
});

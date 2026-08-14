import { describe, expect, it } from "vitest";

import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import {
  projectNavigationItems,
  readOptionalString,
  readRequiredString,
  readSingletonDocument,
  STATIC_PATH,
} from "@/lib/sanity-site-values";
import { ROOT_RELATIVE_PATH } from "../../sanity/schemas/site-link";

const config = buildLocaleRouteConfig({
  locales: [{ locale: "fi-FI", prefix: null, storyNamespace: "tarinat" }],
  reservedRootSegments: [],
  reservedLocaleRouteSegments: [],
});

const localized = (fi: string) => [{ language: "fi", value: fi }];

describe("STATIC_PATH", () => {
  it("stays equal to the Studio schema's own root-relative-path pattern", () => {
    expect(STATIC_PATH.source).toBe(ROOT_RELATIVE_PATH.source);
  });
});

describe("readRequiredString", () => {
  it("rejects a missing, empty, or whitespace-only value", () => {
    expect(() => readRequiredString(undefined, "field", fail)).toThrow();
    expect(() => readRequiredString("", "field", fail)).toThrow();
    expect(() => readRequiredString("   ", "field", fail)).toThrow();
  });

  it("trims surrounding whitespace", () => {
    expect(readRequiredString("  hello  ", "field", fail)).toBe("hello");
  });
});

describe("readOptionalString", () => {
  it("treats an empty or whitespace-only value the same way: absent", () => {
    expect(readOptionalString("", "field", fail)).toBeUndefined();
    expect(readOptionalString("   ", "field", fail)).toBeUndefined();
    expect(readOptionalString(undefined, "field", fail)).toBeUndefined();
    expect(readOptionalString(null, "field", fail)).toBeUndefined();
  });

  it("rejects a non-string value", () => {
    expect(() => readOptionalString(42, "field", fail)).toThrow();
  });

  it("trims surrounding whitespace on real text", () => {
    expect(readOptionalString("  hello  ", "field", fail)).toBe("hello");
  });
});

describe("projectNavigationItems", () => {
  const options = {
    language: "fi",
    locale: "fi-FI",
    config,
    field: "navigation",
    reject: fail,
  };

  it("rejects a static link that repeats the generated story root's own path", () => {
    const value = [
      { label: localized("Tarinat"), target: "story-root" },
      { label: localized("Tarinat uudelleen"), target: "static", href: "/tarinat" },
    ];
    expect(() => projectNavigationItems(value, options)).toThrow(
      /repeats destination/,
    );
  });

  it("rejects fewer items than minItems even when every entry is well-formed", () => {
    expect(() =>
      projectNavigationItems([], { ...options, minItems: 1 }),
    ).toThrow();
  });

  it("allows an empty list when no minimum is set", () => {
    expect(projectNavigationItems([], options)).toEqual([]);
  });
});

describe("readSingletonDocument", () => {
  it("rejects a non-list result, an empty result, and more than one document", () => {
    expect(() => readSingletonDocument({}, "thing", fail)).toThrow();
    expect(() => readSingletonDocument([], "thing", fail)).toThrow();
    expect(() =>
      readSingletonDocument([{ a: 1 }, { a: 2 }], "thing", fail),
    ).toThrow();
  });

  it("returns the one published document", () => {
    expect(readSingletonDocument([{ a: 1 }], "thing", fail)).toEqual({
      a: 1,
    });
  });
});

function fail(...args: readonly unknown[]): never {
  throw new Error(`unexpected rejection: ${JSON.stringify(args)}`);
}

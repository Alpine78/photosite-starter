import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_PATH_LENGTH,
  REQUEST_HAS_CURSOR_VALUE,
  isCarryableRequestPath,
  isPotentialStoryRequestPath,
  readRequestHasCursor,
  readRequestPath,
} from "@/lib/request-path";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";

const localeRoutes = buildLocaleRouteConfig({
  locales: [
    { locale: "en-GB", prefix: null, storyNamespace: "stories" },
    { locale: "fi", prefix: "fi", storyNamespace: "tarinat" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

describe("isCarryableRequestPath", () => {
  it.each([
    "/",
    "/stories",
    "/stories/portfolio/large-archive",
    "/fi/tarinat/portfolio/suuri-arkisto",
  ])("carries an ordinary content path: %s", (path) => {
    expect(isCarryableRequestPath(path)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["relative", "stories/portfolio"],
    ["protocol-relative", "//example.com/stories"],
    ["backslash-escaped", "/\\example.com/stories"],
    ["carrying a backslash", "/stories\\portfolio"],
    ["absolute URL", "https://example.com/stories"],
    ["carrying a query", "/stories?cursor=token"],
    ["carrying a fragment", "/stories#gallery"],
    ["carrying a newline", "/stories\n/injected"],
    ["carrying a space", "/stories /portfolio"],
  ])("refuses a path that is %s", (_case, path) => {
    expect(isCarryableRequestPath(path)).toBe(false);
  });

  it("refuses a path longer than the header bound", () => {
    // Omitted rather than truncated: a truncated path could name a different,
    // real route, and the 404 would then offer a page nobody asked for.
    const overlong = `/${"a".repeat(MAX_REQUEST_PATH_LENGTH)}`;

    expect(overlong.length).toBeGreaterThan(MAX_REQUEST_PATH_LENGTH);
    expect(isCarryableRequestPath(overlong)).toBe(false);
    expect(isCarryableRequestPath(overlong.slice(0, MAX_REQUEST_PATH_LENGTH))).toBe(
      true,
    );
  });
});

describe("readRequestPath", () => {
  it("reads a path the Proxy carried", () => {
    expect(readRequestPath("/stories/portfolio/large-archive")).toBe(
      "/stories/portfolio/large-archive",
    );
  });

  it.each([
    ["absent", null],
    ["unset", undefined],
  ])("reads nothing when the header is %s", (_case, value) => {
    expect(readRequestPath(value)).toBeUndefined();
  });

  it.each([
    "https://example.com/stories",
    "//example.com/stories",
    "/stories?cursor=token",
    "not-a-path",
  ])("validates again rather than trusting the header: %s", (value) => {
    // The Proxy overwrites this header on every matched request, so a client
    // cannot choose its value there. A path the matcher excludes never passes
    // through the Proxy at all, though, so the reader treats the header as
    // untrusted input in its own right.
    expect(readRequestPath(value)).toBeUndefined();
  });
});

describe("readRequestHasCursor", () => {
  it("reads the flag the Proxy writes", () => {
    expect(readRequestHasCursor(REQUEST_HAS_CURSOR_VALUE)).toBe(true);
  });

  it.each([
    ["absent", null],
    ["unset", undefined],
    ["empty", ""],
    ["a different truthy word", "true"],
    ["a cursor value", "AnOpaque-Token_v1"],
  ])("reads %s as no cursor", (_case, value) => {
    // Exact-match, so a client's own guess at this header name never turns into
    // a link. The Proxy overwrites it anyway; this is the second lock.
    expect(readRequestHasCursor(value)).toBe(false);
  });
});

describe("isPotentialStoryRequestPath", () => {
  it.each([
    "/stories/portfolio/large-archive/",
    "/STORIES/portfolio/large-archive/",
    "/en/stories/portfolio/large-archive/",
    "/fi/tarinat/portfolio/suuri-arkisto/",
    "/FI/TARINAT/portfolio/suuri-arkisto/",
  ])("recognizes every configured spelling that the story resolver owns: %s", (path) => {
    expect(isPotentialStoryRequestPath(localeRoutes, path)).toBe(true);
  });

  it.each([
    "/",
    "/services/",
    "/fi/services/",
    "/api/contact/",
    "/unknown/path/",
    "//example.com/stories/portfolio/",
  ])("leaves a non-story path to ordinary slash normalization: %s", (path) => {
    expect(isPotentialStoryRequestPath(localeRoutes, path)).toBe(false);
  });
});

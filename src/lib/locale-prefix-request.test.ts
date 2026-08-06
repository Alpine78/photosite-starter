import { describe, expect, it, vi } from "vitest";

import { resolveLocalePrefixRequest } from "@/lib/locale-prefix-request";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";

const config = buildLocaleRouteConfig({
  locales: [
    { locale: "fi", prefix: null, storyNamespace: "tarinat" },
    { locale: "en", prefix: "en", storyNamespace: "stories" },
  ],
  reservedRootSegments: ["services"],
  reservedLocaleRouteSegments: ["services"],
});

describe("resolveLocalePrefixRequest", () => {
  it("redirects a redundant default prefix only when the exact route exists", async () => {
    const defaultLocaleRouteExists = vi.fn().mockResolvedValue(true);

    await expect(
      resolveLocalePrefixRequest({
        config,
        prefix: "fi",
        segments: ["services", "portraits"],
        searchParams: {},
        defaultLocaleRouteExists,
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location: "/services/portraits",
    });
    expect(defaultLocaleRouteExists).toHaveBeenCalledWith(
      "/services/portraits",
    );
  });

  it("returns not-found when the unprefixed target does not exist", async () => {
    await expect(
      resolveLocalePrefixRequest({
        config,
        prefix: "fi",
        segments: ["nothing-here"],
        searchParams: {},
        defaultLocaleRouteExists: vi.fn().mockResolvedValue(false),
      }),
    ).resolves.toEqual({ kind: "not-found" });
  });

  it("never redirects a configured non-default or unknown prefix", async () => {
    const defaultLocaleRouteExists = vi.fn();

    await expect(
      resolveLocalePrefixRequest({
        config,
        prefix: "en",
        segments: ["stories"],
        searchParams: {},
        defaultLocaleRouteExists,
      }),
    ).resolves.toEqual({ kind: "not-found" });
    await expect(
      resolveLocalePrefixRequest({
        config,
        prefix: "sv",
        segments: ["berattelser"],
        searchParams: {},
        defaultLocaleRouteExists,
      }),
    ).resolves.toEqual({ kind: "not-found" });
    expect(defaultLocaleRouteExists).not.toHaveBeenCalled();
  });

  it.each([["/services"], ["\\services"], [".."], ["."]])(
    "rejects an unsafe canonical segment %j before route lookup",
    async (segment) => {
      const defaultLocaleRouteExists = vi.fn().mockResolvedValue(true);

      await expect(
        resolveLocalePrefixRequest({
          config,
          prefix: "fi",
          segments: [segment],
          searchParams: {},
          defaultLocaleRouteExists,
        }),
      ).resolves.toEqual({ kind: "not-found" });
      expect(defaultLocaleRouteExists).not.toHaveBeenCalled();
    },
  );

  it("preserves repeated query values and encodes them as data", async () => {
    await expect(
      resolveLocalePrefixRequest({
        config,
        prefix: "fi",
        searchParams: {
          tag: ["one", "two"],
          next: "/services?draft=true&mode=full",
          absent: undefined,
        },
        defaultLocaleRouteExists: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toEqual({
      kind: "redirect",
      location:
        "/?tag=one&tag=two&next=%2Fservices%3Fdraft%3Dtrue%26mode%3Dfull",
    });
  });
});

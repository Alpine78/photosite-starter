import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomePortfolio } from "@/components/home-portfolio";
import { getBuiltInLabels } from "@/lib/deployment-config";
import type { GallerySlice } from "@/lib/gallery-slice";

vi.mock("@/components/gallery-lightbox", async () => {
  const { createElement } = await import("react");
  return {
    GalleryLightbox: ({ enquiryBasePath, children }: { enquiryBasePath?: string; children: ReactNode }) =>
      createElement("div", { "data-enquiry-base": enquiryBasePath ?? "disabled" }, children),
  };
});

vi.mock("@/components/gallery-masonry-list", () => ({ GalleryMasonryList: () => null }));

const slice = { items: [{}], slides: [], nextCursor: null } as unknown as GallerySlice;

describe("featured gallery enquiry permission", () => {
  it.each([
    [false, "disabled"],
    [true, "/stories/featured"],
  ] as const)("passes a lightbox enquiry route only when enabled is %s", (enquiriesEnabled, expected) => {
    const markup = renderToStaticMarkup(createElement(HomePortfolio, {
      galleryPath: "/stories/featured",
      sections: [],
      slice,
      enquiriesEnabled,
      locale: "en",
      labels: getBuiltInLabels("en"),
    }));
    expect(markup).toContain(`data-enquiry-base="${expected}"`);
  });
});

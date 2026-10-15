import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
vi.mock("@/lib/site-settings", () => settings);

import { GET } from "./route";

beforeEach(() => settings.getSiteSettings.mockReset());

describe("direct favicon requests", () => {
  it("redirects to the published site logo without storing a stale redirect", async () => {
    settings.getSiteSettings.mockResolvedValue({
      logo: { rendition: { src: "https://cdn.sanity.io/images/example/logo-v2.png" } },
    });
    const response = await GET(new Request("https://example.com/favicon.ico"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://cdn.sanity.io/images/example/logo-v2.png");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses a generic local mark when branding is absent or unavailable", async () => {
    settings.getSiteSettings.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("CMS unavailable"));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await GET(new Request("https://example.com/favicon.ico"));
      expect(response.headers.get("location")).toBe(
        "https://example.com/gallery/site-mark.924ff9b1d397.png",
      );
    }
  });
});

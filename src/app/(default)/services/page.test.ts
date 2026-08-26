import { describe, expect, it, vi } from "vitest";

/**
 * A route-level test, not just a seam-level one: it renders the actual
 * `/services` page component (not `services.ts` directly, already covered by
 * `services.test.ts`) and asserts that Sanity-shaped content — supplied here
 * by stubbing `getServices`/`getServicesIntro` themselves — reaches the
 * rendered React element tree, and that a classified adapter failure
 * propagates out of the page rather than rendering an empty or fixture page.
 * `getPageMetadata` is stubbed too: its own correctness is unrelated,
 * pre-existing behavior this story does not touch.
 */
vi.mock("@/lib/deployment-config", () => ({
  getDefaultLocaleLabels: () => ({ pages: { services: "Palvelut" } }),
}));

const servicesModule = vi.hoisted(() => ({
  getServices: vi.fn(),
  getServicesIntro: vi.fn(),
}));
vi.mock("@/lib/services", () => servicesModule);

const pageMetadataModule = vi.hoisted(() => ({
  getPageMetadata: vi.fn(async (input: { title: string; description?: string }) => ({
    title: input.title,
    description: input.description,
  })),
}));
vi.mock("@/lib/page-metadata", () => pageMetadataModule);

import ServicesPage, { generateMetadata } from "@/app/(default)/services/page";

type ReactElementLike = { readonly type: unknown; readonly props: Record<string, unknown> };

function childrenOf(element: ReactElementLike): readonly ReactElementLike[] {
  const children = element.props.children;
  return Array.isArray(children) ? (children as ReactElementLike[]) : [children as ReactElementLike];
}

describe("ServicesPage", () => {
  it("renders a Sanity-projected catalog into the grid", async () => {
    servicesModule.getServices.mockResolvedValue([
      {
        slug: "sanity-portraits",
        name: "Sanity portraits",
        shortDescription: "Straight from the CMS.",
        description: ["Straight from the CMS."],
      },
    ]);
    servicesModule.getServicesIntro.mockResolvedValue("An intro from Sanity.");

    const page = (await ServicesPage()) as unknown as ReactElementLike;
    const [header, list] = childrenOf(page);

    const introParagraph = childrenOf(header)[1] as ReactElementLike;
    expect(introParagraph.props.children).toBe("An intro from Sanity.");

    const [firstItem] = childrenOf(list);
    const card = (firstItem.props.children as ReactElementLike);
    expect(card.props.service).toMatchObject({ slug: "sanity-portraits", name: "Sanity portraits" });
  });

  it("omits the intro paragraph entirely when none was authored", async () => {
    servicesModule.getServices.mockResolvedValue([]);
    servicesModule.getServicesIntro.mockResolvedValue(undefined);

    const page = (await ServicesPage()) as unknown as ReactElementLike;
    const [header] = childrenOf(page);

    expect(childrenOf(header)[1]).toBe(false);
  });

  it("propagates a classified Sanity failure rather than rendering an empty page", async () => {
    servicesModule.getServices.mockRejectedValue(new Error("classified sanity failure"));
    servicesModule.getServicesIntro.mockResolvedValue(undefined);

    await expect(ServicesPage()).rejects.toThrow("classified sanity failure");
  });
});

describe("generateMetadata", () => {
  it("passes the Sanity-authored intro through as the page description", async () => {
    servicesModule.getServicesIntro.mockResolvedValue("An intro from Sanity.");

    const metadata = await generateMetadata();

    expect(metadata).toMatchObject({
      title: "Palvelut",
      description: "An intro from Sanity.",
    });
  });

  it("passes no description when none was authored, letting the site default apply", async () => {
    servicesModule.getServicesIntro.mockResolvedValue(undefined);

    const metadata = await generateMetadata();

    expect(metadata.description).toBeUndefined();
  });
});

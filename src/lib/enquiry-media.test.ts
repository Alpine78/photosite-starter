import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertEnquiryEligible,
  EnquiryResolutionError,
  resolveEnquiryTarget,
  type EnquiryTargetRequest,
} from "@/lib/enquiry-media";
import { buildLocaleRouteConfig } from "@/lib/locale-routes";

/**
 * `enquiry-media.ts` is the server-only seam AB#60 adds: it validates a public
 * enquiry reference, authorizes a curated request's container against the
 * public content tree, and dispatches to the mock or Sanity source. These
 * tests run the real mock path end to end — real content tree, real
 * `mock-gallery` fixtures, real `mock-enquiry-media` records — and mock only
 * the deployment config, the same way `content.test.ts` does.
 */
const deploymentConfig = vi.hoisted(() => ({
  contentSource: "mock" as "mock" | "sanity",
  localeRoutes: undefined as unknown as ReturnType<typeof buildLocaleRouteConfig>,
}));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => deploymentConfig,
}));

deploymentConfig.localeRoutes = buildLocaleRouteConfig({
  locales: [
    { locale: "en-GB", prefix: null, storyNamespace: "stories" },
    { locale: "fi-FI", prefix: "fi", storyNamespace: "tarinat" },
  ],
  reservedRootSegments: ["services", "contact"],
  reservedLocaleRouteSegments: ["services", "contact"],
});

beforeEach(() => {
  deploymentConfig.contentSource = "mock";
});

async function rejectionOf(
  request: unknown,
): Promise<InstanceType<typeof EnquiryResolutionError>> {
  try {
    await resolveEnquiryTarget(request);
  } catch (error) {
    if (error instanceof EnquiryResolutionError) return error;
    throw error;
  }
  throw new Error("expected resolveEnquiryTarget to throw");
}

const curated = (
  contentId: string,
  itemId: string,
  locale = "en-GB",
): EnquiryTargetRequest => ({ kind: "curated", locale, contentId, itemId });

const dynamic = (itemId: string, locale = "en-GB"): EnquiryTargetRequest => ({
  kind: "dynamic",
  locale,
  itemId,
});

describe("assertEnquiryEligible", () => {
  it("passes a fully enquirable curated photograph", () => {
    expect(() =>
      assertEnquiryEligible(
        { publiclyRenderable: true, enquiryEligible: true },
        "curated",
      ),
    ).not.toThrow();
  });

  it("fails closed when a flag is missing rather than assuming enquirable", () => {
    expect(() =>
      assertEnquiryEligible(
        { publiclyRenderable: true, enquiryEligible: undefined as unknown as boolean },
        "curated",
      ),
    ).toThrowError(EnquiryResolutionError);
  });

  it("treats private-only as not-public, regardless of the other flags", () => {
    const error = (() => {
      try {
        assertEnquiryEligible(
          { publiclyRenderable: true, enquiryEligible: true, privateOnly: true },
          "curated",
        );
      } catch (thrown) {
        return thrown as InstanceType<typeof EnquiryResolutionError>;
      }
      throw new Error("expected a throw");
    })();
    expect(error.rejection).toBe("not-public");
  });

  it("requires dynamic discoverability only for a dynamic request", () => {
    const flags = {
      publiclyRenderable: true,
      enquiryEligible: true,
      dynamicallyDiscoverable: false,
    };
    expect(() => assertEnquiryEligible(flags, "curated")).not.toThrow();
    expect(() => assertEnquiryEligible(flags, "dynamic")).toThrowError(
      EnquiryResolutionError,
    );
  });
});

describe("resolveEnquiryTarget — curated", () => {
  it("resolves an enquirable placement to its media, placement, and archive locator", async () => {
    const target = await resolveEnquiryTarget(
      curated("content-selected-work", "selected-work-coastal-landscape"),
    );

    expect(target).toEqual({
      kind: "curated",
      mediaId: "coastal-landscape",
      placementId: "selected-work-coastal-landscape",
      contentId: "content-selected-work",
      archiveLocator: "/Volumes/Archive/2019/coast/DSCF1042.RAF",
      caption: "Quiet coast",
    });
  });

  it("preserves the selected placement's own context when one photograph is in two galleries", async () => {
    const inSelectedWork = await resolveEnquiryTarget(
      curated("content-selected-work", "selected-work-coastal-landscape"),
    );
    const inCoastalMornings = await resolveEnquiryTarget(
      curated("content-coastal-mornings", "coastal-mornings-coastal-landscape"),
    );

    expect(inSelectedWork.mediaId).toBe("coastal-landscape");
    expect(inCoastalMornings.mediaId).toBe("coastal-landscape");
    expect(inSelectedWork.placementId).not.toBe(inCoastalMornings.placementId);
    expect(inSelectedWork.contentId).not.toBe(inCoastalMornings.contentId);
    // The caption is the placement's, not the media default — the context, not
    // just the identity, follows the selection.
    expect(inSelectedWork.caption).toBe("Quiet coast");
    expect(inCoastalMornings.caption).toBe("First light");
  });

  it("omits the archive locator when the fixture recorded none, and still resolves", async () => {
    const target = await resolveEnquiryTarget(
      curated("content-selected-work", "selected-work-misty-birch"),
    );

    expect("archiveLocator" in target).toBe(false);
    expect(target).toMatchObject({
      kind: "curated",
      mediaId: "misty-birch",
      caption: "Morning mist",
      credit: "Placeholder credit",
    });
  });

  it("rejects an unknown occurrence id inside a real public gallery", async () => {
    expect((await rejectionOf(curated("content-selected-work", "selected-work-nope"))).rejection).toBe(
      "unknown-item",
    );
  });

  it("rejects an item whose container is an unpublished gallery draft", async () => {
    expect(
      (await rejectionOf(curated("content-unpublished-gallery-draft", "any-valid-id"))).rejection,
    ).toBe("container-unavailable");
  });

  it("rejects an item whose container id is a routed article, not a gallery", async () => {
    expect(
      (await rejectionOf(curated("content-reading-coastal-light", "any-valid-id"))).rejection,
    ).toBe("container-unavailable");
  });

  it("rejects an item whose container id is an unplaced draft", async () => {
    expect(
      (await rejectionOf(curated("content-unplaced-draft", "any-valid-id"))).rejection,
    ).toBe("container-unavailable");
  });

  it("rejects a hidden occurrence as an unavailable container", async () => {
    expect(
      (await rejectionOf(curated("content-polar-night-sessions", "polar-night-hidden-occurrence")))
        .rejection,
    ).toBe("container-unavailable");
  });

  it("rejects a photograph that is public but not opted in to enquiries", async () => {
    expect(
      (await rejectionOf(curated("content-selected-work", "selected-work-lakeside-reeds"))).rejection,
    ).toBe("not-enquirable");
  });

  it("rejects a private-only photograph as not-public", async () => {
    expect(
      (await rejectionOf(curated("content-selected-work", "selected-work-lichen-stones"))).rejection,
    ).toBe("not-public");
  });
});

describe("resolveEnquiryTarget — dynamic", () => {
  it("resolves a discoverable, enquirable mediaId with no placement context", async () => {
    const target = await resolveEnquiryTarget(dynamic("forest-stream"));

    expect(target).toEqual({
      kind: "dynamic",
      mediaId: "forest-stream",
      archiveLocator: "catalogue://plates/forest-stream-0007",
    });
    expect("placementId" in target).toBe(false);
    expect("contentId" in target).toBe(false);
    expect("sectionId" in target).toBe(false);
  });

  it("rejects an enquirable photograph that is not dynamically discoverable", async () => {
    expect((await rejectionOf(dynamic("misty-birch"))).rejection).toBe("not-enquirable");
  });

  it("rejects an unknown mediaId", async () => {
    expect((await rejectionOf(dynamic("no-such-photo"))).rejection).toBe("unknown-item");
  });
});

describe("resolveEnquiryTarget — one string, two kinds", () => {
  it("resolves a placementId/mediaId collision by the caller's kind, with no cross-talk", async () => {
    const asPlacement = await resolveEnquiryTarget(
      curated("content-polar-night-sessions", "open-marsh"),
    );
    const asMedia = await resolveEnquiryTarget(dynamic("open-marsh"));

    expect(asPlacement).toMatchObject({
      kind: "curated",
      placementId: "open-marsh",
      mediaId: "coastal-landscape",
    });
    expect(asMedia).toMatchObject({ kind: "dynamic", mediaId: "open-marsh" });
    expect(asPlacement.mediaId).not.toBe(asMedia.mediaId);
  });
});

describe("resolveEnquiryTarget — request shape", () => {
  it.each([
    "Selected-Work",
    "has space",
    "under_score",
    "trailing-",
    "a".repeat(257),
  ])("rejects a malformed itemId %j without echoing it", async (itemId) => {
    const error = await rejectionOf(curated("content-selected-work", itemId));
    expect(error.rejection).toBe("malformed-request");
    expect(error.message).not.toContain(itemId);
  });

  it("rejects a malformed contentId without echoing it", async () => {
    const error = await rejectionOf(curated("Bad Content Id", "selected-work-coastal-landscape"));
    expect(error.rejection).toBe("malformed-request");
    expect(error.message).not.toContain("Bad Content Id");
  });

  it("rejects a locale the deployment does not publish", async () => {
    const error = await rejectionOf(curated("content-selected-work", "selected-work-coastal-landscape", "de-DE"));
    expect(error.rejection).toBe("malformed-request");
    expect(error.message).not.toContain("de-DE");
  });

  it.each([
    null,
    "a string",
    42,
    {},
    { kind: "curated", locale: "en-GB" },
    { kind: "curated", locale: "en-GB", contentId: "content-selected-work", itemId: 7 },
    { kind: "curated", locale: 5, contentId: "content-selected-work", itemId: "x" },
    { kind: "evil", locale: "en-GB", itemId: "selected-work-coastal-landscape" },
  ])("rejects an untrusted request shape %j", async (request) => {
    expect((await rejectionOf(request)).rejection).toBe("malformed-request");
  });

  it("does not authorize or dispatch a request whose kind is unrecognized", async () => {
    const source = vi.fn();
    const error = await (async () => {
      try {
        await resolveEnquiryTarget(
          {
            kind: "evil",
            locale: "en-GB",
            contentId: "content-selected-work",
            itemId: "selected-work-coastal-landscape",
          },
          source,
        );
      } catch (thrown) {
        return thrown as InstanceType<typeof EnquiryResolutionError>;
      }
      throw new Error("expected a throw");
    })();

    expect(error.rejection).toBe("malformed-request");
    expect(source).not.toHaveBeenCalled();
  });
});

describe("resolveEnquiryTarget — container check short-circuits the source", () => {
  it("does not call the source resolver when the container is unauthorized", async () => {
    const source = vi.fn();
    const error = await (async () => {
      try {
        await resolveEnquiryTarget(
          curated("content-unpublished-gallery-draft", "selected-work-coastal-landscape"),
          source,
        );
      } catch (thrown) {
        return thrown as InstanceType<typeof EnquiryResolutionError>;
      }
      throw new Error("expected a throw");
    })();

    expect(error.rejection).toBe("container-unavailable");
    expect(source).not.toHaveBeenCalled();
  });

  it("calls the source resolver with the derived language once the container is authorized", async () => {
    const source = vi
      .fn()
      .mockResolvedValue({ kind: "dynamic", mediaId: "coastal-landscape" });

    await resolveEnquiryTarget(
      curated("content-selected-work", "selected-work-coastal-landscape"),
      source,
    );

    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "curated" }),
      "en",
    );
  });
});

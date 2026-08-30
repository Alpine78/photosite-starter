/**
 * The mock content source's answer to "resolve this public enquiry reference"
 * (AB#60), used until the Sanity adapter is the deployment's source.
 *
 * `import "server-only"` for the same reason `sanity-enquiry-media.ts` carries
 * it: this module stores and returns `archiveLocator`, which ADR-0002 §1 keeps
 * off every public surface. Guarding the module means a client component that
 * tried to import it fails the build, not only the facade in front of it. Only
 * `resolveMockEnquiryTarget` is exported; the per-photograph enquiry records
 * stay private to this file.
 *
 * The records are keyed by `mediaId` because enquiry eligibility, dynamic
 * discoverability, private-only status, and the archive locator are all
 * media-owned (ADR-0002 §3/§4) — a placement never overrides them. A photograph
 * with no record here is treated as not enquirable and not discoverable, which
 * is the opt-in default ADR-0002 §4 requires.
 */

import "server-only";

import {
  assertEnquiryEligible,
  EnquiryResolutionError,
  type EnquiryTargetRequest,
  type ResolvedEnquiryTarget,
} from "@/lib/enquiry-media";
import { findMockCuratedPlacement } from "@/lib/mock-gallery";
import { findMockImageByMediaId } from "@/lib/mock-media";

type MockEnquiryRecord = {
  readonly enquiryEligible: boolean;
  readonly dynamicallyDiscoverable: boolean;
  readonly privateOnly?: boolean;
  /** Optional (ADR-0002 §1): a master's location, when one was recorded. */
  readonly archiveLocator?: string;
};

/**
 * One record per demo photograph. The spread deliberately covers every
 * combination the resolver's boundaries need to be tested against:
 *
 * - `coastal-landscape`, `forest-stream`, `open-marsh`: fully enquirable, with a
 *   recorded archive locator. `open-marsh` is also the `mediaId` a colliding
 *   `placementId` in the polar-night fixture points at.
 * - `misty-birch`: enquirable but not dynamically discoverable, and with no
 *   archive locator — the "curated resolves, dynamic is refused, locator absent"
 *   case.
 * - `lakeside-reeds`: not opted in to enquiries — `not-enquirable`.
 * - `lichen-stones`: private-only — `not-public`, which wins over everything.
 */
const MOCK_ENQUIRY_RECORDS: Readonly<Record<string, MockEnquiryRecord>> = {
  "coastal-landscape": {
    enquiryEligible: true,
    dynamicallyDiscoverable: true,
    archiveLocator: "/Volumes/Archive/2019/coast/DSCF1042.RAF",
  },
  "forest-stream": {
    enquiryEligible: true,
    dynamicallyDiscoverable: true,
    archiveLocator: "catalogue://plates/forest-stream-0007",
  },
  "open-marsh": {
    enquiryEligible: true,
    dynamicallyDiscoverable: true,
    archiveLocator: "Drive B / 2021 / marsh / DSCF7781",
  },
  "misty-birch": {
    enquiryEligible: true,
    dynamicallyDiscoverable: false,
  },
  "lakeside-reeds": {
    enquiryEligible: false,
    dynamicallyDiscoverable: false,
  },
  "lichen-stones": {
    enquiryEligible: false,
    dynamicallyDiscoverable: false,
    privateOnly: true,
  },
};

function eligibilityOf(mediaId: string): MockEnquiryRecord {
  return (
    MOCK_ENQUIRY_RECORDS[mediaId] ?? {
      enquiryEligible: false,
      dynamicallyDiscoverable: false,
    }
  );
}

export function resolveMockEnquiryTarget(
  request: EnquiryTargetRequest,
  language: string,
): ResolvedEnquiryTarget {
  if (request.kind === "dynamic") {
    const media = findMockImageByMediaId(language, request.itemId);
    if (media === undefined) {
      throw new EnquiryResolutionError("unknown-item");
    }

    const record = eligibilityOf(media.mediaId);
    assertEnquiryEligible(
      {
        publiclyRenderable: true,
        enquiryEligible: record.enquiryEligible,
        privateOnly: record.privateOnly,
        dynamicallyDiscoverable: record.dynamicallyDiscoverable,
      },
      "dynamic",
    );

    return {
      kind: "dynamic",
      mediaId: media.mediaId,
      ...(record.archiveLocator === undefined
        ? {}
        : { archiveLocator: record.archiveLocator }),
      ...(media.caption === undefined ? {} : { caption: media.caption }),
      ...(media.credit === undefined ? {} : { credit: media.credit }),
    };
  }

  const placement = findMockCuratedPlacement(
    language,
    request.contentId,
    request.itemId,
  );
  // The caller already resolved `contentId` to a supported public gallery route,
  // so a missing placement means either an unknown occurrence id or a fixture
  // that disagrees with the content tree.
  if (placement === undefined) {
    throw new EnquiryResolutionError("unknown-item");
  }
  if (!placement.visible) {
    throw new EnquiryResolutionError("container-unavailable");
  }

  const { mediaId } = placement.media;
  const record = eligibilityOf(mediaId);
  assertEnquiryEligible(
    {
      publiclyRenderable: true,
      enquiryEligible: record.enquiryEligible,
      privateOnly: record.privateOnly,
    },
    "curated",
  );

  const caption = placement.captionOverride ?? placement.media.caption;

  return {
    kind: "curated",
    mediaId,
    placementId: placement.placementId,
    contentId: request.contentId,
    ...(placement.sectionId === undefined
      ? {}
      : { sectionId: placement.sectionId }),
    ...(record.archiveLocator === undefined
      ? {}
      : { archiveLocator: record.archiveLocator }),
    ...(caption === undefined ? {} : { caption }),
    ...(placement.media.credit === undefined
      ? {}
      : { credit: placement.media.credit }),
  };
}

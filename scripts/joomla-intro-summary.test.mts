import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  findVersionConflicts,
  planIntroSummaries,
  recomputeIntroSummaryDigest,
  reconcileIntroSummaries,
  type IntroSummarySourceDocument,
} from "./joomla-intro-summary.mts";
import { parseArguments } from "./write-joomla-intro-summary.mts";

const target = { projectId: "abc123", dataset: "production" };
const intro = { _key: "k1", _type: "contentParagraphBlock", text: "  The intro.  " };
const full = { _key: "k2", _type: "contentParagraphBlock", text: "The intro. And the rest." };

const gallery = (overrides: Partial<IntroSummarySourceDocument> = {}): IntroSummarySourceDocument => ({
  _id: "gallery-2018-fi",
  _rev: "rev-1",
  _type: "gallery",
  contentId: "rally-2018",
  language: "fi",
  body: [intro, full],
  ...overrides,
});

describe("planIntroSummaries", () => {
  it("moves the first paragraph into a listing-only summary under a revision guard", () => {
    const plan = planIntroSummaries([gallery()], target);
    expect(plan.changes).toEqual([
      {
        documentId: "gallery-2018-fi",
        rev: "rev-1",
        type: "gallery",
        contentId: "rally-2018",
        language: "fi",
        summary: "The intro.",
        originalBody: [intro, full],
      },
    ]);
    expect(plan.mutations).toEqual([
      {
        patch: {
          id: "gallery-2018-fi",
          ifRevisionID: "rev-1",
          set: { summary: "The intro.", summaryListingOnly: true },
          unset: ["body[0]"],
        },
      },
    ]);
    expect(plan.excluded).toEqual([]);
  });

  it.each([
    ["an existing summary", { summary: "Lead" }, "already has a summary"],
    ["a blank summary", { summary: "  " }, "malformed summary (blank string)"],
    ["a non-string summary", { summary: 5 }, "malformed summary (not a string)"],
    ["the flag already set", { summaryListingOnly: false }, "already carries the listing-only flag"],
    ["no body", { body: undefined }, "no body"],
    ["a single paragraph", { body: [intro] }, "the body is a single block, so it is the whole text rather than an intro"],
    ["a heading first", { body: [{ _key: "h", _type: "contentHeadingBlock", text: "H" }, full] }, "the body does not start with a paragraph"],
    ["extra paragraph fields", { body: [{ ...intro, marks: [] }, full] }, "the first paragraph carries fields beyond _key, _type and text"],
    ["an empty paragraph", { body: [{ ...intro, text: " " }, full] }, "the first paragraph has no text"],
    ["another document type", { _type: "service" }, "not an article or gallery (service)"],
  ])("reports and leaves alone a page with %s", (_case, overrides, reason) => {
    const plan = planIntroSummaries([gallery(overrides)], target);
    expect(plan.changes).toEqual([]);
    expect(plan.excluded).toEqual([
      expect.objectContaining({ documentId: "gallery-2018-fi", reason }),
    ]);
  });

  it("plans only from published documents", () => {
    const plan = planIntroSummaries([gallery({ _id: "drafts.gallery-2018-fi" })], target);
    expect(plan.changes).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it("orders deterministically and binds the digest to content, revision and target", () => {
    const a = gallery({ _id: "b-doc" });
    const b = gallery({ _id: "a-doc" });
    const plan = planIntroSummaries([a, b], target);
    expect(plan.changes.map((change) => change.documentId)).toEqual(["a-doc", "b-doc"]);
    expect(planIntroSummaries([b, a], target).digest).toBe(plan.digest);
    expect(recomputeIntroSummaryDigest(plan)).toBe(plan.digest);

    // Key order in a response must not matter; content and revision must.
    const reordered = gallery({ _id: "a-doc", body: [{ text: intro.text, _type: intro._type, _key: intro._key }, full] });
    expect(planIntroSummaries([a, reordered], target).digest).toBe(plan.digest);
    expect(planIntroSummaries([a, gallery({ _id: "a-doc", _rev: "rev-2" })], target).digest).not.toBe(plan.digest);
    expect(planIntroSummaries([a, gallery({ _id: "a-doc", body: [intro, { ...full, text: "Edited." }] })], target).digest)
      .not.toBe(plan.digest);
    expect(planIntroSummaries([a, b], { ...target, dataset: "preview" }).digest).not.toBe(plan.digest);
  });
});

describe("findVersionConflicts", () => {
  it("reports drafts and release versions of planned pages only", () => {
    const plan = planIntroSummaries([gallery()], target);
    expect(findVersionConflicts(plan, [
      "gallery-2018-fi",
      "drafts.gallery-2018-fi",
      "versions.r1.gallery-2018-fi",
      "drafts.some-other-page",
    ])).toEqual(["drafts.gallery-2018-fi", "versions.r1.gallery-2018-fi"]);
  });
});

describe("reconcileIntroSummaries", () => {
  const plan = planIntroSummaries([gallery()], target);

  it("recognizes an untouched page as pending", () => {
    expect(reconcileIntroSummaries(plan, [gallery()])).toEqual({ applied: [], pending: ["gallery-2018-fi"], unexpected: [] });
  });

  it("recognizes the exact planned result as applied", () => {
    const written = gallery({ _rev: "rev-2", summary: "The intro.", summaryListingOnly: true, body: [full] });
    expect(reconcileIntroSummaries(plan, [written]).applied).toEqual(["gallery-2018-fi"]);
  });

  it.each([
    ["a body that lost more than the intro", { body: [] }],
    ["a missing flag", { summaryListingOnly: undefined }],
    ["a different summary", { summary: "Other" }],
  ])("flags %s as unexpected", (_case, overrides) => {
    const written = gallery({ _rev: "rev-2", summary: "The intro.", summaryListingOnly: true, body: [full], ...overrides });
    expect(reconcileIntroSummaries(plan, [written]).unexpected).toHaveLength(1);
  });

  it("flags a vanished page as unexpected", () => {
    expect(reconcileIntroSummaries(plan, []).unexpected).toEqual([
      { documentId: "gallery-2018-fi", reason: "the document no longer exists" },
    ]);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined values", () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: undefined, e: null })).toBe('{"b":[{"c":2,"d":1}],"e":null}');
  });
});

describe("parseArguments", () => {
  const digest = "a".repeat(64);

  it("is a dry run unless --yes is given, and --yes needs an approved digest", () => {
    expect(parseArguments(["--out", "o"]).apply).toBe(false);
    expect(parseArguments(["--out", "o", "--approved-digest", digest, "--yes"]))
      .toMatchObject({ apply: true, approvedDigest: digest });
    expect(() => parseArguments(["--out", "o", "--yes"])).toThrow(/approved-digest/);
  });

  it("refuses unknown options, a malformed digest, and a missing --out", () => {
    expect(() => parseArguments(["--out", "o", "--approve", digest])).toThrow(/unknown option/);
    expect(() => parseArguments(["--out", "o", "--approved-digest", "xyz"])).toThrow(/64-character/);
    expect(() => parseArguments([])).toThrow(/--out/);
  });
});

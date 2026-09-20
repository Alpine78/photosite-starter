import { describe, expect, it } from "vitest";

import {
  SERVICE_WRITE_PLAN_VERSION,
  parseArguments,
  serviceDatasetIssues,
  serviceDocumentsDigest,
  serviceWriteWaves,
  validateServiceDocuments,
  validateServiceWritePlan,
  type ServiceWriteDocument,
} from "./write-sanity-services.mts";

const documents: readonly ServiceWriteDocument[] = [
  {
    _id: "migrated--service--weddings--fi",
    _type: "service",
    serviceId: "weddings",
    language: "fi",
    slug: "haakuvaus",
    name: "Hääkuvaus",
    shortDescription: "Kuvaus.",
    description: ["Kappale."],
    order: 10,
  },
  {
    _id: "migrated--service--portraits--fi",
    _type: "service",
    serviceId: "portraits",
    language: "fi",
    parentServiceId: "weddings",
    slug: "muotokuvat",
    name: "Muotokuvat",
    shortDescription: "Kuvaus.",
    description: ["Kappale."],
    order: 20,
  },
];

describe("service write plan validation", () => {
  it("accepts a complete localized parent-child plan", () => {
    const result = validateServiceWritePlan({
      version: SERVICE_WRITE_PLAN_VERSION,
      documents,
    });
    expect(result.issues).toEqual([]);
    expect(result.plan?.documents).toHaveLength(2);
  });

  it("rejects unsupported fields and a non-deterministic id", () => {
    const result = validateServiceDocuments([
      { ...documents[0], _id: "other", secret: "must not be written" },
    ]);
    expect(result.issues).toContain(
      "documents[0] has unsupported field(s): secret",
    );
    expect(result.issues).toContain(
      'documents[0]._id must be "migrated--service--weddings--fi"',
    );
  });

  it("rejects missing parents, sibling slug collisions, and cycles", () => {
    const result = validateServiceDocuments([
      { ...documents[0], parentServiceId: "portraits" },
      { ...documents[1], slug: "haakuvaus" },
      {
        ...documents[1],
        _id: "migrated--service--third--fi",
        serviceId: "third",
        parentServiceId: "missing",
      },
    ]);
    expect(result.issues.some((issue) => issue.includes("cycle"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("missing parent"))).toBe(true);
  });

  it("binds approval to normalized document content", () => {
    const first = serviceDocumentsDigest(documents);
    const reordered = serviceDocumentsDigest([...documents].reverse());
    const changed = serviceDocumentsDigest([
      { ...documents[0], name: "Changed" },
      documents[1],
    ]);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("writes parents before their children", () => {
    const waves = serviceWriteWaves([...documents].reverse());
    expect(waves.map((wave) => wave.map((document) => document.serviceId))).toEqual([
      ["weddings"],
      ["portraits"],
    ]);
  });

  it("allows an identical rerun but refuses to overwrite edited content or a draft", () => {
    expect(serviceDatasetIssues(documents, documents)).toEqual([]);
    expect(
      serviceDatasetIssues(
        [{ ...documents[0], name: "Owner edit" }],
        documents,
      ),
    ).toContain(
      'planned document "migrated--service--weddings--fi" already exists with different content',
    );
    expect(
      serviceDatasetIssues(
        [{ ...documents[0], _id: `drafts.${documents[0]._id}` }],
        documents,
      ),
    ).toContain(
      'planned document "migrated--service--weddings--fi" has an unpublished draft',
    );
    expect(
      serviceDatasetIssues(
        [
          {
            _id: `drafts.${documents[0]._id}`,
            _type: "article",
          },
        ],
        documents,
      ),
    ).toContain(
      'planned document "migrated--service--weddings--fi" has an unpublished draft',
    );
  });
});

describe("service write CLI", () => {
  it("is dry-run by default and accepts the apply guard explicitly", () => {
    expect(parseArguments(["--plan", "plan.json"])).toEqual({
      plan: "plan.json",
      apply: false,
    });
    expect(
      parseArguments([
        "--plan",
        "plan.json",
        "--approved-digest",
        "a".repeat(64),
        "--yes",
      ]),
    ).toEqual({
      plan: "plan.json",
      approvedDigest: "a".repeat(64),
      apply: true,
    });
  });
});

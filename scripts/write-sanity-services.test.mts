import { describe, expect, it, vi } from "vitest";

import {
  SERVICE_WRITE_PLAN_VERSION,
  parseArguments,
  serviceDatasetIssues,
  buildServicePreflightQuery,
  preflightServices,
  serviceDocumentsDigest,
  serviceWriteWaves,
  normalizeServiceReadback,
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

  it("normalizes GROQ null optional fields before validating a read-back", () => {
    const readBack = documents.map((document) =>
      document.parentServiceId === undefined
        ? {
            ...document,
            parentServiceId: null,
            coverMedia: null,
            startingPrice: null,
            pricing: null,
          }
        : {
            ...document,
            coverMedia: null,
            startingPrice: null,
            pricing: null,
          },
    );

    const normalized = readBack.map(
      normalizeServiceReadback,
    ) as ServiceWriteDocument[];
    expect(validateServiceDocuments(normalized).issues).toEqual([]);
    expect(serviceDocumentsDigest(validateServiceDocuments(normalized).documents)).toBe(
      serviceDocumentsDigest(documents),
    );
    expect(serviceDatasetIssues(normalized, documents)).toEqual([]);
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

describe("CLI UTF-8 input integrity", () => {
  const marker = "Åä 😀 \uFFFD";
  const networkGuard = "data:text/javascript," + encodeURIComponent("globalThis.fetch = () => { process.stderr.write('UNEXPECTED_NETWORK'); process.exit(86); };");
  async function execute(bytes: Buffer, apply = false) {
    const { mkdtemp, writeFile, rm, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const root = await mkdtemp(path.join(tmpdir(), "utf8-plan-"));
    try {
      const planPath = path.join(root, "plan.json");
      await writeFile(planPath, bytes);
      const digest = serviceDocumentsDigest(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")).documents);
      const args = ["--import", networkGuard, path.join(import.meta.dirname, "write-sanity-services.mts"), "--plan", planPath, ...["--approved-digest", digest], ...(apply ? ["--yes"] : [])];
      const result = await promisify(execFile)(process.execPath, args, { env: { NODE_ENV: "test", NODE_NO_WARNINGS: "1" } })
        .then((value) => ({ code: 0, ...value }), (error: { code: number; stdout: string; stderr: string }) => error);
      expect(result.stderr).not.toContain("UNEXPECTED_NETWORK");
      expect(await readdir(root)).toEqual(["plan.json"]);
      return { ...result, digest };
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  function fixture() { return { version: SERVICE_WRITE_PLAN_VERSION, documents: documents.map((d) => ({ ...d, name: marker })) }; }
  function corrupt(bad: number[]) {
    const text = JSON.stringify(fixture());
    const at = text.indexOf("\uFFFD");
    expect(at).toBeGreaterThan(-1);
    return Buffer.concat([Buffer.from(text.slice(0, at)), Buffer.from(bad), Buffer.from(text.slice(at + 1))]);
  }
  it("preserves valid Unicode, an intentional replacement character and its approval digest", async () => {
    const result = await execute(Buffer.from(JSON.stringify(fixture())));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry run only");
    expect(result.stdout).toContain(`Approved digest: ${result.digest}`);
  });
  it.each([[0xff], [0xc2], [0xc0, 0x80], [0xed, 0xa0, 0x80]])("refuses malformed UTF-8 %j before parsing or local output", async (...bad) => {
    const result = await execute(corrupt(bad));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/UTF-8|utf-8/);
  });
  it("refuses malformed UTF-8 with --yes before resolving credentials", async () => {
    const result = await execute(corrupt([0xff]), true);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/UTF-8|utf-8/);
    expect(result.stderr).not.toContain("SANITY_");
  });
  it("retains the JSON BOM rejection instead of silently removing it", async () => {
    const result = await execute(Buffer.from("\uFEFF" + JSON.stringify(fixture())));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
  });
});


describe("service preflight row integrity (AB#243)", () => {
  it("does not silently discard malformed identity rows", () => {
    for (const row of [null, [], 3, "PRIVATE_SENTINEL", {}, { _id: "drafts.", _type: "service" }, { _id: " ", _type: "service" }, { _id: "id", _type: "" }]) {
      const issues = serviceDatasetIssues([row], documents); expect(issues.length).toBeGreaterThan(0); expect(issues.join(" ")).not.toContain("PRIVATE_SENTINEL");
    }
    expect(serviceDatasetIssues([documents[0], documents[0]], documents).join(" ")).toContain("repeats a document ID");
  });
  it("refuses foreign services with missing, oversized or unsafe route identities", () => {
    const foreign = { _id: "foreign-service", _type: "service", serviceId: "foreign", language: "fi", slug: "foreign" };
    for (const field of ["serviceId", "language", "slug", "parentServiceId"]) for (const value of ["", 7, "PRIVATE_SENTINEL\n", "PRIVATE_SENTINEL".repeat(200)]) {
      const issues = serviceDatasetIssues([{ ...foreign, [field]: value }], documents);
      expect(issues.join(" ")).toContain("malformed route identity"); expect(issues.join(" ")).not.toContain("PRIVATE_SENTINEL");
    }
  });
  it("includes missing-language services in the actual preflight request", async () => {
    const connection = { projectId: "synthetic", dataset: "preview", apiVersion: "v2026-06-24", token: "synthetic-token" };
    const query = vi.fn(async (...args: unknown[]) => { void args; return [{ _id: "foreign", _type: "service", serviceId: "foreign", slug: "foreign" }]; });
    expect(await preflightServices(connection, documents, query)).toContain("Sanity service preflight has malformed route identity rows");
    expect(query.mock.calls[0]).toEqual([connection, buildServicePreflightQuery(documents)]);
    expect(buildServicePreflightQuery(documents).query).toContain("!defined(language)");
  });
});

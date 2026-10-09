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
  verifyWritten,
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

describe("service write prices", () => {
  const tier = { _key: "basic", _type: "object" as const, name: "Basic", price: "100 €", note: "One session" };
  const priced: readonly ServiceWriteDocument[] = [{ ...documents[0], startingPrice: "100 €", pricing: [tier] }, documents[1]];

  it("preserves validated price fields and the recorded no-price digest", () => {
    expect(validateServiceDocuments(priced)).toEqual({ documents: priced, issues: [] });
    expect(serviceDocumentsDigest(documents)).toBe("18a0ed9a9ac31d1dd1ad93992f1bd32e593e4048295dac53d0b57025325891c6");
    expect(serviceDocumentsDigest(priced)).not.toBe(serviceDocumentsDigest(documents));
    for (const field of ["_key", "name", "price", "note"] as const) {
      expect(serviceDocumentsDigest([{ ...priced[0], pricing: [{ ...tier, [field]: "changed" }] }, priced[1]])).not.toBe(serviceDocumentsDigest(priced));
    }
    expect(serviceDocumentsDigest([{ ...priced[0], startingPrice: "200 €" }, priced[1]])).not.toBe(serviceDocumentsDigest(priced));
  });

  it.each([null, "100 €", [], [null], [{ ...tier, privateLocator: "forbidden" }], [{ ...tier, _key: "" }], [{ ...tier, _type: "other" }], [{ ...tier, name: " " }], [{ ...tier, price: 100 }], [{ ...tier, note: null }], [tier, tier]])("refuses malformed pricing instead of discarding it: %j", (pricing) => {
    const result = validateServiceWritePlan({ version: SERVICE_WRITE_PLAN_VERSION, documents: [{ ...documents[0], pricing }, documents[1]] });
    expect(result.plan).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it.each([null, 100, true, "", " "])("refuses malformed listing price: %j", (startingPrice) => {
    expect(validateServiceWritePlan({ version: SERVICE_WRITE_PLAN_VERSION, documents: [{ ...documents[0], startingPrice }, documents[1]] }).plan).toBeUndefined();
  });

  it("keeps price array order significant and requires unique stable keys", () => {
    const second = { ...tier, _key: "extended", name: "Extended", price: "200 €" };
    const forward = [{ ...priced[0], pricing: [tier, second] }, priced[1]];
    const reverse = [{ ...priced[0], pricing: [second, tier] }, priced[1]];
    expect(validateServiceDocuments(forward).issues).toEqual([]);
    expect(serviceDocumentsDigest(forward)).not.toBe(serviceDocumentsDigest(reverse));
  });

  it("accepts exact priced reruns and refuses mismatches in both directions", () => {
    expect(serviceDatasetIssues(priced, priced)).toEqual([]);
    for (const [existing, planned] of [[priced, documents], [documents, priced], [[{ ...priced[0], pricing: [{ ...tier, price: "200 €" }] }, priced[1]], priced]] as const) {
      expect(serviceDatasetIssues(existing, planned)).toContain('planned document "migrated--service--weddings--fi" already exists with different content');
    }
    expect(serviceDatasetIssues([{ ...priced[0], pricing: [{ ...tier, unexpected: true }] }], priced)).toContain('planned document "migrated--service--weddings--fi" already exists with different content');
  });

  it("reads actual prices back and detects dropped or changed prices", async () => {
    const connection = { projectId: "test1234", dataset: "production", apiVersion: "v2025-02-19", token: "synthetic" };
    const query = vi.fn(async (_connection: unknown, request: { query: string }) => {
      expect(request.query).toContain("startingPrice");
      expect(request.query).toContain("pricing");
      return priced;
    });
    expect(await verifyWritten(connection, priced, query)).toBe(true);
    expect(query.mock.calls[0]).toHaveLength(2);
    expect(await verifyWritten(connection, priced, vi.fn(async () => documents))).toBe(false);
    expect(await verifyWritten(connection, documents, vi.fn(async () => priced))).toBe(false);
    expect(await verifyWritten(connection, priced, vi.fn(async () => [{ ...priced[0], pricing: [{ ...tier, price: "200 €" }] }, priced[1]]))).toBe(false);
  });
});

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
  it("dry-runs priced documents without resolving credentials or using the network", async () => {
    const priced = { ...fixture(), documents: [{ ...fixture().documents[0], startingPrice: "100 €", pricing: [{ _key: "basic", _type: "object", name: "Basic", price: "100 €" }] }, fixture().documents[1]] };
    const result = await execute(Buffer.from(JSON.stringify(priced)));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry run only");
    expect(result.stdout).toContain(`Approved digest: ${result.digest}`);
  });

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

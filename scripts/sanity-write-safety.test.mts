import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalJson } from "./joomla-intro-summary.mts";
import { reuploadApprovalDigest } from "./legacy-image-reupload-match.mts";
import { buildSeedFixtures, collectSeedIdentities, GALLERY_PLACEMENT_TYPE_NAME } from "./sanity-seed-fixtures.mts";
import { MUTATION_BATCH_SIZE, parseSeedConnection, runSeedMutationBatches } from "./sanity-seed-http.mts";
import {
  formatPartialRunLine,
  formatWriteTarget,
  PARTIAL_RUN_LINE_PREFIX,
  readWriteToken,
  refusePublicTokenCopy,
  WriteCredentialError,
  WriteRunProgress,
} from "./sanity-write-safety.mts";

import {
  CLI_TIMEOUT,
  expectRefusedBeforeNetwork,
  expectTargetBeforeNetwork,
  runWriterCli as runCli,
  runWriterCliWithFakeSanity,
  SYNTHETIC_TARGET as TARGET,
  SYNTHETIC_TARGET_LINE as TARGET_LINE,
  SYNTHETIC_TOKEN as TOKEN,
} from "./write-safety-cli-support.mts";

describe("shared write-token check (AB#421)", () => {
  it("returns the token from the environment", () => {
    expect(readWriteToken({ SANITY_MIGRATION_TOKEN: TOKEN }, "SANITY_MIGRATION_TOKEN")).toBe(TOKEN);
  });

  it("refuses a NEXT_PUBLIC_ copy even when the server-only token is also set, without echoing either", () => {
    const error = (() => {
      try {
        readWriteToken({ SANITY_SEED_TOKEN: TOKEN, NEXT_PUBLIC_SANITY_SEED_TOKEN: TOKEN }, "SANITY_SEED_TOKEN");
      } catch (cause) {
        return cause;
      }
    })();
    expect(error).toBeInstanceOf(WriteCredentialError);
    expect(error).toMatchObject({ code: "PUBLIC_TOKEN_REFUSED", variable: "SANITY_SEED_TOKEN" });
    expect((error as Error).message).toContain("NEXT_PUBLIC_SANITY_SEED_TOKEN is set");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("treats an empty public copy as absent and an empty token as missing", () => {
    expect(() => refusePublicTokenCopy({ NEXT_PUBLIC_SANITY_SEED_TOKEN: "  " }, "SANITY_SEED_TOKEN")).not.toThrow();
    expect(() => readWriteToken({ SANITY_SEED_TOKEN: " " }, "SANITY_SEED_TOKEN")).toThrow(
      expect.objectContaining({ code: "TOKEN_REQUIRED", message: "SANITY_SEED_TOKEN is required (this tool never accepts a token as a flag)" }),
    );
  });
});

describe("target line and partial-run record (AB#421)", () => {
  it("names project, dataset and API version and never the token of a connection", () => {
    const connection = parseSeedConnection({ ...TARGET, token: TOKEN });
    expect(formatWriteTarget(connection)).toBe(TARGET_LINE);
  });

  it("records uploads and the last completed batch in a fixed, token-free form", () => {
    const progress = new WriteRunProgress(parseSeedConnection({ ...TARGET, token: TOKEN }));
    expect(progress.started).toBe(false);
    progress.start();
    progress.recordUpload("image-aaa-10x10-jpg");
    progress.batchRecorder("media")(1, 3);
    progress.batchRecorder("media")(2, 3);
    const record = progress.toRecord();
    expect(record).toMatchObject({
      version: 1,
      target: TARGET,
      uploadedAssetIds: ["image-aaa-10x10-jpg"],
      completedBatches: 2,
      lastCompletedBatch: "media 2/3",
    });
    const line = formatPartialRunLine(record);
    expect(line.startsWith(PARTIAL_RUN_LINE_PREFIX)).toBe(true);
    expect(JSON.parse(line.slice(PARTIAL_RUN_LINE_PREFIX.length))).toEqual(record);
    expect(line).not.toContain(TOKEN);
  });

  it("reports only the batches the dataset accepted before a failed one", async () => {
    const connection = parseSeedConnection({ ...TARGET, token: TOKEN });
    const progress = new WriteRunProgress(connection);
    let calls = 0;
    const fetchImplementation = (async () => {
      calls += 1;
      return new Response(calls === 2 ? "{}" : "{}", { status: calls === 2 ? 500 : 200 });
    }) as typeof fetch;
    const mutations = Array.from({ length: 3 }, (_, index) => ({ createIfNotExists: { _id: `doc-${index}`, _type: "fixture" } }));
    await expect(
      runSeedMutationBatches(connection, mutations, { batchSize: 1, fetchImplementation, onBatchCommitted: progress.batchRecorder("wave 1/1") }),
    ).rejects.toThrow(/Mutation batch 2\/3 failed/);
    expect(progress.toRecord()).toMatchObject({ completedBatches: 1, lastCompletedBatch: "wave 1/1 1/3" });
  });
});

describe("writer CLIs print the target before the first request (AB#421)", () => {
  let folder: string;
  beforeEach(async () => { folder = await mkdtemp(path.join(tmpdir(), "write-safety-")); });
  afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

  it("seed:sanity --yes", () => {
    expectTargetBeforeNetwork(runCli("seed-sanity-content.mts", ["--yes"], { SANITY_SEED_TOKEN: TOKEN }), "stdout");
  }, CLI_TIMEOUT);

  it("seed:sanity --delete-all --yes", () => {
    expectTargetBeforeNetwork(runCli("seed-sanity-content.mts", ["--delete-all", "--yes"], { SANITY_SEED_TOKEN: TOKEN }), "stdout");
  }, CLI_TIMEOUT);

  it("recompute:shuffled-order --yes", () => {
    expectTargetBeforeNetwork(
      runCli("recompute-shuffled-order.mts", ["--gallery", "fixture-gallery", "--language", "fi", "--yes"], { SANITY_SEED_TOKEN: TOKEN }),
      "stdout",
    );
  }, CLI_TIMEOUT);

  it("create:localized-draft --yes", () => {
    expectTargetBeforeNetwork(
      runCli("create-localized-draft.mts", ["--content-id", "fixture", "--from", "fi", "--to", "en", "--yes"], {
        SANITY_LOCALIZATION_TOKEN: TOKEN,
        SITE_LOCALE_ROUTES: "fi||tarinat,en|en|stories",
      }),
      "stdout",
    );
  }, CLI_TIMEOUT);

  it("sync:keywords --yes", () => {
    expectTargetBeforeNetwork(
      runCli("keyword-sync.mts", ["--out", path.join(folder, "out"), "--approved-digest", "a".repeat(64), "--yes"], { SANITY_MIGRATION_TOKEN: TOKEN }),
      "stderr",
    );
  }, CLI_TIMEOUT);

  it("fix:joomla-intro --yes, and its published-content dry run", () => {
    const apply = runCli("write-joomla-intro-summary.mts", ["--out", path.join(folder, "apply"), "--approved-digest", "a".repeat(64), "--yes"], {
      SANITY_MIGRATION_TOKEN: TOKEN,
    });
    expectTargetBeforeNetwork(apply, "stdout");
    expectTargetBeforeNetwork(runCli("write-joomla-intro-summary.mts", ["--out", path.join(folder, "plan")], {}), "stdout");
  }, CLI_TIMEOUT);

  it("write-reviewed-content-plan --yes", async () => {
    const before = { _id: "sample-service", _rev: "rev-1", _type: "service", pricing: [{ label: "A", price: "1" }, { label: "B", price: "2" }] };
    const unsigned = {
      version: "reviewed-content-v1",
      target: { projectId: TARGET.projectId, dataset: TARGET.dataset },
      rows: [{ id: before._id, revision: before._rev, before, after: { ...before, pricing: [{ label: "B", price: "2" }] } }],
    };
    const digest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
    const planPath = path.join(folder, "plan.json");
    await writeFile(planPath, JSON.stringify({ ...unsigned, digest }));
    expectTargetBeforeNetwork(
      runCli("write-reviewed-content-plan.mts", ["--plan", planPath, "--approved-digest", digest, "--out", path.join(folder, "recovery"), "--yes"], {
        SANITY_MIGRATION_TOKEN: TOKEN,
      }),
      "stdout",
    );
  }, CLI_TIMEOUT);

  it("benchmark:keywords seed --yes", () => {
    expectTargetBeforeNetwork(runCli("keyword-benchmark.mts", ["seed", "--yes"], { SANITY_BENCHMARK_TOKEN: TOKEN }), "stdout");
  }, CLI_TIMEOUT);

  it("write:legacy-image-reupload --yes prints the target when it opens the write connection", async () => {
    const planPath = path.join(folder, "plan.json");
    await writeFile(planPath, JSON.stringify({ schemaVersion: 1, planned: [] }));
    const digest = reuploadApprovalDigest([], new Set(), false);
    const result = runCli(
      "write-legacy-image-reupload.mts",
      ["--plan", planPath, "--image-root", folder, "--out", path.join(folder, "out"), "--approved-digest", digest, "--yes"],
      { SANITY_MIGRATION_TOKEN: TOKEN },
    );
    // An empty plan makes no request at all; the target line still comes first.
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(`${TARGET_LINE}\n`);
    expect(result.stdout).not.toContain(TOKEN);
  }, CLI_TIMEOUT);
});

describe("previously unguarded token readers refuse a NEXT_PUBLIC_ copy before any request (AB#421)", () => {
  let folder: string;
  beforeEach(async () => { folder = await mkdtemp(path.join(tmpdir(), "write-safety-")); });
  afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

  it("seed:sanity", () => {
    expectRefusedBeforeNetwork(
      runCli("seed-sanity-content.mts", ["--yes"], { SANITY_SEED_TOKEN: TOKEN, NEXT_PUBLIC_SANITY_SEED_TOKEN: TOKEN }),
      "SANITY_SEED_TOKEN",
    );
  }, CLI_TIMEOUT);

  it("recompute:shuffled-order, also in its reading dry run", () => {
    const args = ["--gallery", "fixture-gallery", "--language", "fi"];
    const environment = { SANITY_SEED_TOKEN: TOKEN, NEXT_PUBLIC_SANITY_SEED_TOKEN: TOKEN };
    expectRefusedBeforeNetwork(runCli("recompute-shuffled-order.mts", [...args, "--yes"], environment), "SANITY_SEED_TOKEN");
    expectRefusedBeforeNetwork(runCli("recompute-shuffled-order.mts", args, environment), "SANITY_SEED_TOKEN");
  }, CLI_TIMEOUT);

  it("benchmark:keywords", () => {
    expectRefusedBeforeNetwork(
      runCli("keyword-benchmark.mts", ["seed", "--yes"], { SANITY_BENCHMARK_TOKEN: TOKEN, NEXT_PUBLIC_SANITY_BENCHMARK_TOKEN: TOKEN }),
      "SANITY_BENCHMARK_TOKEN",
    );
  }, CLI_TIMEOUT);

  it("write:legacy-image-reupload", async () => {
    const planPath = path.join(folder, "plan.json");
    await writeFile(planPath, JSON.stringify({ schemaVersion: 1, planned: [] }));
    const result = runCli(
      "write-legacy-image-reupload.mts",
      ["--plan", planPath, "--image-root", folder, "--out", path.join(folder, "out"), "--approved-digest", reuploadApprovalDigest([], new Set(), false), "--yes"],
      { SANITY_MIGRATION_TOKEN: TOKEN, NEXT_PUBLIC_SANITY_MIGRATION_TOKEN: TOKEN },
    );
    expectRefusedBeforeNetwork(result, "SANITY_MIGRATION_TOKEN");
    expect(await readdir(path.join(folder, "out"))).toEqual([]);
  }, CLI_TIMEOUT);
});

describe("a run that fails after it began writing leaves a partial-run record (AB#421)", () => {
  it("seed:sanity prints the uploaded asset ids and the last completed batch on stderr", () => {
    const result = runWriterCliWithFakeSanity("seed-sanity-content.mts", ["--yes"], { SANITY_SEED_TOKEN: TOKEN }, {
      failWhenBodyContains: '"createOrReplace"',
      failAt: 2,
      queryResults: [{ singletons: [], media: [], categories: [], services: [], content: [] }],
    });
    expect(result.status).toBe(1);
    const line = result.stderr.split("\n").find((entry) => entry.startsWith(PARTIAL_RUN_LINE_PREFIX));
    expect(line).toBeDefined();
    const record = JSON.parse((line as string).slice(PARTIAL_RUN_LINE_PREFIX.length));
    expect(record).toMatchObject({ version: 1, target: TARGET, completedBatches: 1 });
    expect(record.lastCompletedBatch).toMatch(/^documents 1\/\d+$/);
    expect([...record.uploadedAssetIds].sort()).toEqual(Array.from({ length: 6 }, (_, index) => `image-fixture${index + 1}-10x10-webp`).sort());
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  }, CLI_TIMEOUT);

  function partialRecord(stderr: string) {
    const line = stderr.split("\n").find((entry) => entry.startsWith(PARTIAL_RUN_LINE_PREFIX));
    expect(line).toBeDefined();
    return JSON.parse((line as string).slice(PARTIAL_RUN_LINE_PREFIX.length));
  }
  const EMPTY_PREFLIGHT = [{ singletons: [], media: [], categories: [], services: [], content: [] }];
  const { documents } = buildSeedFixtures();
  const documentBatches = Math.ceil(documents.length / MUTATION_BATCH_SIZE);
  const preflightResults = [
    ...EMPTY_PREFLIGHT,
    // Placement identity preflight queries use chunks of 100 ids.
    ...Array.from({ length: Math.ceil(collectSeedIdentities(documents).placementIds.length / 100) }, () => []),
  ];

  it.each(["--delete-all", "--prune-stale"])("seed:sanity %s records the deletion batch committed before a rejection", (mode) => {
    const stale = Array.from({ length: MUTATION_BATCH_SIZE + 1 }, (_, index) => ({
      _id: `seed--stale-placement-${index}`,
      _type: GALLERY_PLACEMENT_TYPE_NAME,
    }));
    const result = runWriterCliWithFakeSanity("seed-sanity-content.mts", [mode, "--yes"], { SANITY_SEED_TOKEN: TOKEN }, {
      failWhenBodyContains: '"delete"',
      failAt: 2,
      queryResults: mode === "--delete-all" ? [stale] : [...preflightResults, stale],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Mutation batch 2/2 failed with HTTP 500");
    expect(partialRecord(result.stderr)).toMatchObject({
      version: 1,
      target: TARGET,
      completedBatches: mode === "--delete-all" ? 1 : documentBatches + 1,
      lastCompletedBatch: "deletions wave 1/1 1/2",
      ...(mode === "--delete-all" ? { uploadedAssetIds: [] } : {}),
    });
    expect(result.stderr.split("\n").filter((entry) => entry.startsWith(PARTIAL_RUN_LINE_PREFIX))).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  }, CLI_TIMEOUT);

  it("seed:sanity reports all uploaded assets and completed batches when post-write verification fails", () => {
    const result = runWriterCliWithFakeSanity("seed-sanity-content.mts", ["--yes"], { SANITY_SEED_TOKEN: TOKEN }, {
      failWhenBodyContains: '"createOrReplace"',
      failAt: 0,
      // No stale documents, then two missing singletons and an invalid count carrying sensitive error text.
      queryResults: [...preflightResults, [], null, null, { error: `raw verification error ${TOKEN}` }],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Sanity seeding failed: 9 live verification check(s) failed. The write already completed — see docs/sanity-seeding.md.");
    const record = partialRecord(result.stderr);
    expect(record).toMatchObject({
      version: 1,
      target: TARGET,
      completedBatches: documentBatches,
      lastCompletedBatch: `documents ${documentBatches}/${documentBatches}`,
    });
    expect([...record.uploadedAssetIds].sort()).toEqual(Array.from({ length: 6 }, (_, index) => `image-fixture${index + 1}-10x10-webp`).sort());
    expect(result.stderr.split("\n").filter((entry) => entry.startsWith(PARTIAL_RUN_LINE_PREFIX))).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain("raw verification error");
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  }, CLI_TIMEOUT);

  it("seed:sanity records an asset whose filename cleanup failed after the upload was accepted", () => {
    const result = runWriterCliWithFakeSanity("seed-sanity-content.mts", ["--yes"], { SANITY_SEED_TOKEN: TOKEN }, {
      failWhenBodyContains: '"originalFilename"',
      failAt: 1,
      queryResults: EMPTY_PREFLIGHT,
    });
    expect(result.status).toBe(1);
    const record = partialRecord(result.stderr);
    expect(record.completedBatches).toBe(0);
    // Every upload was accepted; the first cleanup failed, yet no accepted asset is missing.
    expect([...record.uploadedAssetIds].sort()).toEqual(Array.from({ length: 6 }, (_, index) => `image-fixture${index + 1}-10x10-webp`).sort());
  }, CLI_TIMEOUT);

  it("seed:sanity waits for every concurrent upload before recording a rejected one", () => {
    const result = runWriterCliWithFakeSanity("seed-sanity-content.mts", ["--yes"], { SANITY_SEED_TOKEN: TOKEN }, {
      failWhenBodyContains: '"createOrReplace"',
      failAt: 1,
      queryResults: EMPTY_PREFLIGHT,
      failUploadAt: 1,
      acceptedUploadDelayMs: 200,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Asset upload failed with HTTP 500");
    const record = partialRecord(result.stderr);
    expect(record.completedBatches).toBe(0);
    expect([...record.uploadedAssetIds].sort()).toEqual([2, 3, 4, 5, 6].map((index) => `image-fixture${index}-10x10-webp`).sort());
  }, CLI_TIMEOUT);
});

import { describe, expect, test, vi, afterEach } from "vitest";
import defaultConfig from "../../vitest.config.mts";
import liveConfig from "../../vitest.cleanup-readiness.config.mts";
import otherLiveConfig from "../../vitest.live.config.mts";
import adapterConfig from "../../vitest.live-adapters.config.mts";
import {
  cleanupReadinessSettings, parseCleanupReadinessManifest, cleanupReadinessFetch,
  createCleanupReadinessReader, verifyCleanupReadiness, cleanupReadinessError,
} from "./client-gallery-cleanup-readiness";

const now = Date.parse("2026-10-24T12:00:00.000Z");
const token = "synthetic-dedicated-token";
function manifest() {
  return {
    version: 1,
    target: { projectId: "synthetic", dataset: "test", apiVersion: "v2026-10-01" },
    canaries: {
      published: { id: "probe-random", type: "cleanupCanary" },
      private: { id: "cleanupProbe.private-random", type: "cleanupCanary" },
      draft: { id: "drafts.probe-random", type: "cleanupCanary" },
      release: { id: "versions.release-random.probe-random", type: "cleanupCanary" },
    },
    missingDocumentId: "missing-random",
  };
}
function parse(value: unknown = manifest()) {
  return parseCleanupReadinessManifest(new TextEncoder().encode(JSON.stringify(value)), token, new Date(now));
}
function documents() {
  return Object.values(manifest().canaries).map(c => ({ _id: c.id, _type: c.type, _rev: "revision1", title: "private-authored-value" }));
}
function response(body: string, status = 200) { return new Response(body, { status, headers: { date: new Date(now).toUTCString() } }); }
function harness(options: {
  exportDocuments?: Record<string, unknown>[]; docDocuments?: Record<string, unknown>[];
  omitted?: unknown[]; status?: number; headerDate?: string; fetch?: typeof fetch;
} = {}) {
  const config = parse();
  const exported = options.exportDocuments ?? documents();
  const fetcher = vi.fn<typeof fetch>(options.fetch ?? (async input => {
    const result = String(input).includes("/export/")
      ? response(exported.map(d => JSON.stringify(d)).join("\n") + "\n", options.status)
      : response(JSON.stringify({ documents: options.docDocuments ?? exported,
        omitted: options.omitted ?? [{ id: config.missingDocumentId, reason: "existence" }] }));
    if (options.headerDate !== undefined) result.headers.set("date", options.headerDate);
    return result;
  }));
  const reader = createCleanupReadinessReader(config, { fetch: fetcher, now: () => now });
  return { config, fetcher, reader, run: (opts = {}) => verifyCleanupReadiness(config, reader, { now: () => now, ...opts }) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("private operator input", () => {
  const env = { CLIENT_GALLERY_CLEANUP_READINESS: "enabled", CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST: "/private/manifest.json", SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: token };
  test("explicit opt-in and token; site flags and ambient targets do not select the probe", () => {
    expect(cleanupReadinessSettings({ ...env, SANITY_PROJECT_ID: "other", CLIENT_GALLERY_CLEANUP: "off" })).toEqual({ filename: env.CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST, token });
    vi.stubEnv("SANITY_PROJECT_ID", "ambient-other");
    vi.stubEnv("SANITY_DATASET", "ambient-other");
    vi.stubEnv("SANITY_API_VERSION", "v2099-01-01");
    vi.stubEnv("SANITY_READ_TOKEN", "different-token");
    expect(parse().target).toEqual(manifest().target);
  });
  test.each([
    { CLIENT_GALLERY_CLEANUP_READINESS: "" }, { CLIENT_GALLERY_CLEANUP_READINESS: "true" },
    { CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST: "relative.json" }, { CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST: "/a\0b" },
    { SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: "" }, { SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: "token\n" },
    { NEXT_PUBLIC_SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: token },
  ])("refuses invalid settings before file/network IO: %j", overrides => {
    expect(() => cleanupReadinessSettings({ ...env, ...overrides })).toThrow("configuration_invalid");
  });
  test.each([
    "", "{}", '{"version":1,"version":1}', "\ufeff{}", "x".repeat(32769),
  ])("refuses malformed/duplicate/oversized/BOM manifest", input => {
    expect(() => parseCleanupReadinessManifest(new TextEncoder().encode(input), token)).toThrow("manifest_invalid");
  });
  test("refuses damaged UTF-8 and unknown properties", () => {
    expect(() => parseCleanupReadinessManifest(new Uint8Array([0xff]), token)).toThrow("manifest_invalid");
    expect(() => parse({ ...manifest(), arbitrary: "private" })).toThrow("manifest_invalid");
  });
  test.each([
    { projectId: "other\n" }, { dataset: "Test" }, { apiVersion: "v2026-02-31" },
    { apiVersion: "v2099-01-01" }, { apiVersion: "v2025-02-18" }, { token: "not-allowed" },
  ])("refuses invalid target %j", target => {
    expect(() => parse({ ...manifest(), target: { ...manifest().target, ...target } })).toThrow("manifest_invalid");
  });
  test.each([
    { maxDocuments: 99 }, { maxSnapshotBytes: 1024 }, { exportTimeoutMs: 60001 },
    { maxLineBytes: 1024 }, { maxDocuments: "100" },
  ])("refuses invalid or non-production limit overrides %j", limits => {
    expect(() => parse({ ...manifest(), limits })).toThrow("manifest_invalid");
  });
  test("accepts only bounded production overrides and fingerprints original bytes", () => {
    const config = parse({ ...manifest(), limits: { maxDocuments: 100, maxSnapshotBytes: 1048576, exportTimeoutMs: 5000 } });
    expect(config.limits.maxDocuments).toBe(100);
    expect(config.limits.maxLineBytes).toBe(1048576);
    const bytes = new TextEncoder().encode(JSON.stringify(manifest()) + "\n");
    const changed = parseCleanupReadinessManifest(bytes, token, new Date(now));
    expect(changed.manifestFingerprint).not.toBe(parse().manifestFingerprint);
    expect(changed.targetFingerprint).toBe(parse().targetFingerprint);
  });
  test.each([
    ["published", { id: "private.dot" }], ["private", { id: "flat" }],
    ["private", { id: "drafts.other" }], ["private", { id: "versions.rel.other" }],
    ["draft", { id: "drafts.other" }], ["release", { id: "versions..probe-random" }],
    ["release", { id: "versions.rel.other" }], ["draft", { type: "otherType" }],
    ["release", { type: "otherType" }], ["published", { id: "probe-random\n" }],
  ] as const)("refuses inconsistent %s canary", (kind, overrides) => {
    const m = manifest(); Object.assign(m.canaries[kind], overrides);
    expect(() => parse(m)).toThrow("manifest_invalid");
  });
  test.each(["probe-random", "drafts.other", "invalid/other"])("refuses unsafe missing id %s", missingDocumentId => {
    expect(() => parse({ ...manifest(), missingDocumentId })).toThrow("manifest_invalid");
  });
  test.each([{ id: "clientGalleryCleanup.synthetic" }, { type: "clientGalleryCleanup" }])("refuses canaries that would enter the worker's active control inventory: %j", overrides => {
    const m = manifest(); Object.assign(m.canaries.private, overrides);
    expect(() => parse(m)).toThrow("manifest_invalid");
  });
});

describe("real bounded transport with synthetic provider responses", () => {
  test("matches all copies, reports measurements only, and exposes no write operation", async () => {
    const docs = [...documents(), { _id: "versions.another.probe-random", _type: "cleanupCanary", _rev: "r2",
      reference: { _type: "reference", _ref: "unrelated", _weak: true } }];
    const h = harness({ exportDocuments: docs });
    expect(Object.keys(h.reader).sort()).toEqual(["read", "snapshot"]);
    const report = await h.run({ monotonicNow: (() => { let n = 0; return () => n++ * 10; })() });
    expect(report).toMatchObject({ readyToDelete: false, readyToActivate: false, fullReadGrantProven: false, writeGrantsVerified: false,
      knownCanaries: 4, knownVersionDocuments: 5, existenceOmissions: 1,
      export: { documents: 5, references: 1, elapsedMs: 10 } });
    expect(report.export.bytes).toBeGreaterThan(report.export.maxLineBytes);
    expect(report.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    const output = JSON.stringify(report);
    for (const secret of [token, "private-authored-value", ...docs.map(d => d._id), "cleanupCanary", "synthetic", "test"]) {
      expect(output).not.toContain(secret);
    }
    expect(report.remainingChecks).toContain("token_role_identity");
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of h.fetcher.mock.calls) expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  });
  test.each(["published", "private", "draft", "release"] as const)("identifies a missing or wrong-type %s canary without its ID", async kind => {
    const config = parse();
    await expect(harness({ exportDocuments: documents().filter(d => d._id !== config.canaries[kind].id) }).run()).rejects.toThrow(`canary_${kind}_not_observed`);
    await expect(harness({ exportDocuments: documents().map(d => d._id === config.canaries[kind].id ? { ...d, _type: "unexpected" } : d) }).run()).rejects.toThrow(`canary_${kind}_not_observed`);
  });
  test.each([
    documents().slice(0, 3),
    documents().map((d, i) => i === 0 ? { ...d, _rev: "changed" } : d),
    [...documents(), { _id: "versions.late.probe-random", _type: "cleanupCanary", _rev: "new" }],
  ].map(docDocuments => ({ docDocuments })))("refuses missing, changed and newly appeared Doc copies", async ({ docDocuments }) => {
    await expect(harness({ docDocuments }).run()).rejects.toThrow("canary_changed");
  });
  test.each([[], [{ id: "missing-random", reason: "permission" }]].map(omitted => ({ omitted })))("refuses unreported or permission omission", async ({ omitted }) => {
    await expect(harness({ omitted }).run()).rejects.toThrow("provider_invalid");
  });
  test("refuses a supposedly missing document that exists", async () => {
    await expect(harness({ exportDocuments: [...documents(), { _id: "missing-random", _rev: "r1", _type: "cleanupCanary" }] }).run()).rejects.toThrow("missing_not_absent");
  });
  test.each([401, 403])("separates permission refusal %s from unavailable provider", async status => {
    await expect(harness({ status }).run()).rejects.toThrow("provider_refused");
  });
  test("redacts native exceptions, bodies and error causes", async () => {
    const h = harness({ fetch: async () => { throw new Error(token, { cause: "private-authored-value" }); } });
    const error = await h.run().catch(cleanupReadinessError);
    expect(error).toMatchObject({ message: "provider_unavailable" });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain(token);
    expect(String(error)).not.toContain("private-authored-value");
  });
  test("refuses malformed export and untrusted provider clock", async () => {
    await expect(harness({ fetch: async () => response('{"error":"private-authored-value"}\n') }).run()).rejects.toThrow("snapshot_invalid");
    await expect(harness({ headerDate: "yesterday" }).run()).rejects.toThrow("clock_untrusted");
  });
  test.each([NaN, -1])("refuses invalid monotonic elapsed time %s", async elapsed => {
    let calls = 0;
    await expect(harness().run({ monotonicNow: () => calls++ === 0 ? 0 : elapsed })).rejects.toThrow("clock_invalid");
  });
  test("abort and ignored-abort header waits are bounded", async () => {
    const controller = new AbortController(); controller.abort();
    const h = harness();
    await expect(h.run({ signal: controller.signal })).rejects.toThrow("deadline_exceeded");
    expect(h.fetcher).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const pending = harness({ fetch: () => new Promise(() => {}) }).run();
    const assertion = expect(pending).rejects.toThrow("deadline_exceeded");
    await vi.advanceTimersByTimeAsync(30001); await assertion;
  });
});

test("only exact export/all-version Doc GET requests can reach the network", async () => {
  const config = parse(), fetcher = vi.fn<typeof fetch>();
  const guarded = cleanupReadinessFetch(config, fetcher);
  const base = `https://synthetic.api.sanity.io/v2026-10-01/data`;
  for (const [input, init] of [
    [`${base}/mutate/test`, { method: "POST", body: "{}" }],
    [`${base}/export/test`, { method: "GET", body: "{}" }],
    [`${base}/export/test?cursor=bad`, { method: "GET" }],
    [`${base}/query/test`, { method: "GET" }],
    ["https://other.api.sanity.io/v2026-10-01/data/export/test", { method: "GET" }],
    [`${base}/export/test`, { method: "GET", redirect: "follow", cache: "no-store" }],
    [new Request(`${base}/export/test`), { method: "GET" }],
  ] as const) expect(() => guarded(input, init)).toThrow("request_refused");
  expect(fetcher).not.toHaveBeenCalled();
});

test("live probe has separate discovery and is excluded from all routine suites", () => {
  const filename = "src/lib/client-gallery-cleanup-readiness-live.test.ts";
  expect(defaultConfig.test?.exclude).toContain(filename);
  expect(liveConfig.test?.include).toEqual([filename]);
  expect(liveConfig.envDir).toBe(false);
  expect(otherLiveConfig.test?.include).not.toContain(filename);
  expect(adapterConfig.test?.include).not.toContain(filename);
});

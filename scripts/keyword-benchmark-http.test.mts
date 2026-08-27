import { describe, expect, it, vi } from "vitest";

import {
  BenchmarkHttpError,
  countAllDocuments,
  parseReadConnection,
  runMeasuredQuery,
  runRepeatedQuery,
  summarizeSamples,
  type MeasuredQueryResult,
} from "./keyword-benchmark-http.mts";

const CONNECTION = parseReadConnection({
  projectId: "abc123",
  dataset: "kwbench",
  apiVersion: "v2024-01-01",
  token: "test-token",
});

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("runMeasuredQuery", () => {
  it("targets the direct API host and records server ms, payload bytes, and cache headers", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("https://abc123.api.sanity.io/v2024-01-01/data/query/kwbench");
      expect(String(url)).toContain("perspective=published"); // production perspective by default

      return jsonResponse({ ms: 12, result: [{ mediaId: "m-1" }, { mediaId: "m-2" }] }, { headers: { age: "0", "x-cache": "MISS" } });
    });

    const measured = await runMeasuredQuery(
      CONNECTION,
      { query: "*[_type == $t]", params: { t: "benchmarkMedia" }, endpoint: "api" },
      { fetchImplementation: fetchImpl as unknown as typeof fetch },
    );

    expect(measured.endpoint).toBe("api");
    expect(measured.serverMs).toBe(12);
    expect(measured.resultCount).toBe(2);
    expect(measured.payloadBytes).toBeGreaterThan(0);
    expect(measured.cacheHeaders).toMatchObject({ age: "0", "x-cache": "MISS" });
    expect(measured.wallMs).toBeGreaterThanOrEqual(0);
  });

  it("targets the CDN host when the endpoint is apicdn", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("https://abc123.apicdn.sanity.io/");
      return jsonResponse({ ms: 3, result: 42 });
    });
    const measured = await runMeasuredQuery(
      CONNECTION,
      { query: "count(*)", endpoint: "apicdn" },
      { fetchImplementation: fetchImpl as unknown as typeof fetch },
    );
    expect(measured.endpoint).toBe("apicdn");
    expect(measured.resultCount).toBe(1); // scalar
    expect(measured.result).toBe(42);
  });

  it("sends the token only as a bearer header, never in the URL", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).not.toContain("test-token");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      expect(init?.redirect).toBe("error");
      return jsonResponse({ result: [] });
    });
    await runMeasuredQuery(
      CONNECTION,
      { query: "*[]", endpoint: "api" },
      { fetchImplementation: fetchImpl as unknown as typeof fetch },
    );
  });

  it("raises a typed error on a non-2xx response without echoing the body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "secret detail" }, { status: 500 }));
    await expect(
      runMeasuredQuery(
        CONNECTION,
        { query: "*[]", endpoint: "api" },
        { fetchImplementation: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("rejects an over-long query URL before sending it", async () => {
    const huge = "x".repeat(12 * 1024);
    await expect(
      runMeasuredQuery(
        CONNECTION,
        { query: `*[_id == "${huge}"]`, endpoint: "api" },
        { fetchImplementation: (async () => jsonResponse({ result: [] })) as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/GET limit/);
  });
});

describe("summarizeSamples", () => {
  const sample = (wallMs: number, payloadBytes: number, serverMs: number): MeasuredQueryResult => ({
    endpoint: "api",
    wallMs,
    serverMs,
    payloadBytes,
    resultCount: 10,
    result: [],
    cacheHeaders: {},
  });

  it("reports median and p95 wall time and median payload", () => {
    const summary = summarizeSamples([
      sample(10, 100, 4),
      sample(20, 100, 5),
      sample(30, 120, 6),
      sample(40, 120, 7),
      sample(100, 130, 8),
    ]);
    expect(summary.samples).toBe(5);
    expect(summary.medianWallMs).toBe(30);
    expect(summary.p95WallMs).toBeGreaterThan(40);
    expect(summary.medianServerMs).toBe(6);
    expect(summary.medianPayloadBytes).toBe(120);
  });

  it("refuses to summarize samples that disagree on result count (dataset changed mid-run)", () => {
    expect(() =>
      summarizeSamples([sample(10, 100, 4), { ...sample(10, 100, 4), resultCount: 11 }]),
    ).toThrow(/dataset changed mid-measurement/);
  });
});

describe("runRepeatedQuery / countAllDocuments", () => {
  it("issues exactly `repetitions` requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ms: 1, result: [] }));
    const results = await runRepeatedQuery(
      CONNECTION,
      { query: "*[]", endpoint: "api" },
      4,
      { fetchImplementation: fetchImpl as unknown as typeof fetch },
    );
    expect(results).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("countAllDocuments returns the scalar count over the raw perspective", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("count(");
      expect(String(url)).toContain("perspective=raw"); // must also see drafts / releases
      return jsonResponse({ result: 448 });
    });
    expect(
      await countAllDocuments(CONNECTION, { fetchImplementation: fetchImpl as unknown as typeof fetch }),
    ).toBe(448);
  });

  it("rejects a non-positive repetition count", async () => {
    await expect(
      runRepeatedQuery(CONNECTION, { query: "*[]", endpoint: "api" }, 0),
    ).rejects.toThrow(BenchmarkHttpError);
  });
});

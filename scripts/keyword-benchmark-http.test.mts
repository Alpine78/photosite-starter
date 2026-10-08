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

describe("benchmark response integrity", () => {
  const request = { query: "count(*)", endpoint: "api" } as const;
  const run = (response: Response) => runMeasuredQuery(CONNECTION, request, { fetchImplementation: vi.fn().mockResolvedValue(response) });
  it.each([new Error("synthetic-provider-detail"), new DOMException("synthetic-provider-detail", "TimeoutError")])
    ("redacts body stream errors and preserves timeout classification: %s", async (error) => {
      const response = new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
      const result = await run(response).catch((failure: unknown) => failure);
      expect(result).toBeInstanceOf(BenchmarkHttpError);
      expect(result).toMatchObject({ status: undefined, message: `[keyword-benchmark-http] ${error.name === "TimeoutError" ? "Response body timed out" : "Response body could not be read"}` });
      expect(result).not.toHaveProperty("cause");
      expect(String(result)).not.toContain("synthetic-provider-detail");
      expect((result as Error).stack).not.toContain("synthetic-provider-detail");
    });
  it("classifies HTTP failure without consuming or awaiting a stalled body", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ pull() { return new Promise<void>(() => {}); }, cancel }), { status: 503 });
    const read = vi.spyOn(response, "arrayBuffer"), text = vi.spyOn(response, "text"), json = vi.spyOn(response, "json");
    await expect(run(response)).rejects.toMatchObject({ status: 503, message: "[keyword-benchmark-http] Query failed with HTTP 503" });
    expect(cancel).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
  });
  it("observes cancellation rejection without replacing the HTTP status", async () => {
    const response = new Response(new ReadableStream({ cancel() { return Promise.reject(new Error("synthetic-provider-detail")); } }), { status: 502 });
    await expect(run(response)).rejects.toMatchObject({ status: 502 });
    await expect(run(new Response(null, { status: 502 }))).rejects.toMatchObject({ status: 502 });
  });
  it.each([[0xff], [0xc0, 0x80], [0xe2, 0x82]].map(bytes => ({ bytes })))("rejects malformed UTF-8 inside otherwise parseable JSON: %j", async ({ bytes: corruption }) => {
    const bytes = Buffer.concat([Buffer.from('{"result":"'), Buffer.from(corruption), Buffer.from('"}')]);
    await expect(run(new Response(bytes))).rejects.toMatchObject({ message: "[keyword-benchmark-http] Query returned invalid UTF-8" });
  });
  it.each([false, true])("measures received Unicode bytes, including a leading BOM: %s", async (bom) => {
    const body = { result: "\u00e4\u20ac\ud83d\ude00\ufffd", ms: 4 };
    const bytes = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(JSON.stringify(body))]);
    expect(await run(new Response(bytes))).toMatchObject({ result: body.result, serverMs: 4, payloadBytes: bytes.byteLength, resultCount: 1 });
  });
});

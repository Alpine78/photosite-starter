import { describe, expect, it, vi } from "vitest";

import {
  chunk,
  MUTATION_BATCH_SIZE,
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  SanitySeedConfigurationError,
  SanitySeedHttpError,
  type SeedConnection,
  type SeedMutation,
  uploadSeedImageAsset,
} from "./sanity-seed-http.mts";

describe("chunk", () => {
  it("splits an array into groups of the given size, with a shorter final group", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when size exceeds the array length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns no chunks for an empty array", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow(TypeError);
    expect(() => chunk([1], -1)).toThrow(TypeError);
  });
});

const VALID_CONNECTION = {
  projectId: "abc123",
  dataset: "production",
  apiVersion: "v2026-06-24",
  token: "secret-write-token",
};

const TOKEN = VALID_CONNECTION.token;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseSeedConnection", () => {
  it("accepts a valid connection", () => {
    expect(parseSeedConnection(VALID_CONNECTION)).toEqual(VALID_CONNECTION);
  });

  it("rejects an invalid project id", () => {
    expect(() => parseSeedConnection({ ...VALID_CONNECTION, projectId: "Invalid_ID" })).toThrow(
      SanitySeedConfigurationError,
    );
  });

  it("rejects an invalid dataset name", () => {
    expect(() => parseSeedConnection({ ...VALID_CONNECTION, dataset: "-bad" })).toThrow(
      SanitySeedConfigurationError,
    );
  });

  it("rejects an undated API version", () => {
    expect(() => parseSeedConnection({ ...VALID_CONNECTION, apiVersion: "vX" })).toThrow(
      SanitySeedConfigurationError,
    );
  });

  it("rejects a calendar-impossible API version", () => {
    expect(() => parseSeedConnection({ ...VALID_CONNECTION, apiVersion: "v2026-02-31" })).toThrow(
      SanitySeedConfigurationError,
    );
  });

  it("rejects a token containing whitespace", () => {
    expect(() => parseSeedConnection({ ...VALID_CONNECTION, token: "has space" })).toThrow(
      SanitySeedConfigurationError,
    );
  });

  it("rejects an empty token", () => {
    expect(() => parseSeedConnection({ ...VALID_CONNECTION, token: "   " })).toThrow(
      SanitySeedConfigurationError,
    );
  });
});

describe("runSeedQuery", () => {
  const connection: SeedConnection = parseSeedConnection(VALID_CONNECTION);

  it("sends the token only in the Authorization header, requests published perspective, and returns result", async () => {
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).not.toContain(TOKEN);
      expect(String(url)).toContain("perspective=published");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({ result: [{ _id: "seed.category.landscapes" }] });
    });

    const result = await runSeedQuery(
      connection,
      { query: "*[_type == $type]", params: { type: "category" } },
      { fetchImplementation: fetchImplementation as unknown as typeof fetch },
    );

    expect(result).toEqual([{ _id: "seed.category.landscapes" }]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("defaults to the published perspective", async () => {
    const fetchImplementation = vi.fn(async (url: string) => {
      expect(String(url)).toContain("perspective=published");
      return jsonResponse({ result: [] });
    });
    await runSeedQuery(connection, { query: "*[]" }, { fetchImplementation: fetchImplementation as unknown as typeof fetch });
  });

  it("requests the raw perspective when asked", async () => {
    const fetchImplementation = vi.fn(async (url: string) => {
      expect(String(url)).toContain("perspective=raw");
      return jsonResponse({ result: [] });
    });
    await runSeedQuery(
      connection,
      { query: "*[]", perspective: "raw" },
      { fetchImplementation: fetchImplementation as unknown as typeof fetch },
    );
  });

  it("throws SanitySeedHttpError on a non-2xx response without leaking the token", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ error: { description: "nope" } }, 401));

    await expect(
      runSeedQuery(connection, { query: "*[]" }, { fetchImplementation: fetchImplementation as unknown as typeof fetch }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SanitySeedHttpError);
      expect((error as Error).message).not.toContain(TOKEN);
      expect((error as SanitySeedHttpError).status).toBe(401);
      return true;
    });
  });

  it("throws on a 200 response with no result envelope", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ notResult: true }));

    await expect(
      runSeedQuery(connection, { query: "*[]" }, { fetchImplementation: fetchImplementation as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(SanitySeedHttpError);
  });
});

describe("runSeedMutationBatches", () => {
  const connection: SeedConnection = parseSeedConnection(VALID_CONNECTION);

  function mutationsOf(count: number): readonly SeedMutation[] {
    return Array.from({ length: count }, (_unused, index) => ({
      createOrReplace: { _id: `seed.media.item-${index}`, _type: "media" },
    }));
  }

  it("splits mutations into batches at the given size and posts each as its own request", async () => {
    const bodies: unknown[] = [];
    const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.redirect).toBe("error");
      return jsonResponse({ results: [] });
    });

    const summary = await runSeedMutationBatches(connection, mutationsOf(5), {
      batchSize: 2,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    expect(summary).toEqual({ batchesRun: 3, mutationCount: 5 });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect((bodies[0] as { mutations: unknown[] }).mutations).toHaveLength(2);
    expect((bodies[1] as { mutations: unknown[] }).mutations).toHaveLength(2);
    expect((bodies[2] as { mutations: unknown[] }).mutations).toHaveLength(1);
  });

  it("uses the documented default batch size when none is given", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ results: [] }));
    const summary = await runSeedMutationBatches(connection, mutationsOf(MUTATION_BATCH_SIZE + 1), {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });
    expect(summary.batchesRun).toBe(2);
  });

  it("omits the visibility parameter by default and appends it when requested", async () => {
    const urls: string[] = [];
    const fetchImplementation = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ results: [] });
    });

    await runSeedMutationBatches(connection, mutationsOf(1), {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });
    expect(urls[0]).not.toContain("visibility=");

    await runSeedMutationBatches(connection, mutationsOf(1), {
      visibility: "async",
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });
    expect(urls[1]).toContain("/data/mutate/");
    expect(urls[1]).toContain("?visibility=async");
  });

  it("stops at the first failing batch and never sends a later one, without leaking the token", async () => {
    let callCount = 0;
    const fetchImplementation = vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? jsonResponse({ results: [] }) : jsonResponse({ error: "rejected" }, 400);
    });

    await expect(
      runSeedMutationBatches(connection, mutationsOf(6), {
        batchSize: 2,
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SanitySeedHttpError);
      expect((error as Error).message).not.toContain(TOKEN);
      expect((error as Error).message).toContain("2/3");
      return true;
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});

describe("uploadSeedImageAsset", () => {
  const connection: SeedConnection = parseSeedConnection(VALID_CONNECTION);
  const policy = { maxDimension: 2048, formatsByExtension: { webp: "image/webp", jpg: "image/jpeg" } };

  it("returns the asset id and dimensions on a valid, in-policy response", async () => {
    const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      return jsonResponse({
        document: {
          _id: "image-abc123-1200x800-webp",
          extension: "webp",
          mimeType: "image/webp",
          metadata: { dimensions: { width: 1200, height: 800 } },
        },
      });
    });

    const asset = await uploadSeedImageAsset(
      connection,
      { bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp" },
      policy,
      { fetchImplementation: fetchImplementation as unknown as typeof fetch },
    );

    expect(asset).toEqual({
      assetId: "image-abc123-1200x800-webp",
      width: 1200,
      height: 800,
      extension: "webp",
      mimeType: "image/webp",
    });
  });

  it("refuses an asset past the maximum public-delivery dimension", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        document: {
          _id: "image-oversized",
          extension: "webp",
          mimeType: "image/webp",
          metadata: { dimensions: { width: 4000, height: 3000 } },
        },
      }),
    );

    await expect(
      uploadSeedImageAsset(
        connection,
        { bytes: new Uint8Array([1]), contentType: "image/webp" },
        policy,
        { fetchImplementation: fetchImplementation as unknown as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(SanitySeedHttpError);
  });

  it("refuses a response whose extension and mimeType disagree with the policy", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        document: {
          _id: "image-mismatch",
          extension: "webp",
          mimeType: "image/tiff",
          metadata: { dimensions: { width: 800, height: 600 } },
        },
      }),
    );

    await expect(
      uploadSeedImageAsset(
        connection,
        { bytes: new Uint8Array([1]), contentType: "image/webp" },
        policy,
        { fetchImplementation: fetchImplementation as unknown as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(SanitySeedHttpError);
  });

  it("refuses a response missing expected fields", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ document: {} }));

    await expect(
      uploadSeedImageAsset(
        connection,
        { bytes: new Uint8Array([1]), contentType: "image/webp" },
        policy,
        { fetchImplementation: fetchImplementation as unknown as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(SanitySeedHttpError);
  });
});

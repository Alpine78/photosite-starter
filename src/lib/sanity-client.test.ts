import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSanityQueryUrl,
  createSanityClient,
  MAX_SANITY_GET_URL_BYTES,
  probeSanityConnectivity,
  SanityQueryError,
  type SanityErrorClass,
} from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";

/**
 * A fixture project and a fixture token. Nothing in this file addresses a
 * project anybody owns, carries a real credential, or reaches the network: the
 * client's `fetch` is injected in every test, so the suite exercises the real
 * request composition, the real classification, and the real response handling
 * against responses this file wrote.
 */
const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const authenticatedConfig: SanityConfig = {
  ...config,
  readToken: "sk-fixture-token",
};

/**
 * Fixture content, not production content: two invented documents with no
 * person, no location, and no photographer's work in them.
 */
const fixtureServices = [
  { _id: "fixture-service-1", _type: "service", title: "Fixture service" },
  { _id: "fixture-service-2", _type: "service", title: "Another fixture" },
];

type RecordedCall = { url: string; init: RequestInit | undefined };

function stubFetch(respond: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImplementation = (async (input: unknown, init?: RequestInit) => {
    const call: RecordedCall = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;

  return { fetchImplementation, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)?.[name];
}

/** Failures write one operational event, which tests assert rather than print. */
function silenceFailureLog() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildSanityQueryUrl", () => {
  it("composes the documented query endpoint for a published read", () => {
    const url = new URL(
      buildSanityQueryUrl(config, {
        query: '*[_type == "service"]',
        tag: "services.list",
      }),
    );

    expect(url.origin).toBe("https://zp7mbokg.api.sanity.io");
    expect(url.pathname).toBe("/v2026-06-24/data/query/production");
    expect(url.searchParams.get("query")).toBe('*[_type == "service"]');
    expect(url.searchParams.get("tag")).toBe("services.list");
  });

  it("always asks for the published perspective", () => {
    // Draft access is absent by construction, not off by default: there is no
    // setting, no option, and no argument that can change this value.
    for (const query of ["*[false]", '*[_type == "article"]']) {
      const url = new URL(buildSanityQueryUrl(config, { query, tag: "any" }));
      expect(url.searchParams.get("perspective")).toBe("published");
    }
  });

  it("suppresses the echoed query in the response", () => {
    const url = new URL(
      buildSanityQueryUrl(config, { query: "*[false]", tag: "probe" }),
    );
    expect(url.searchParams.get("returnQuery")).toBe("false");
  });

  it("encodes GROQ parameters as $-prefixed JSON literals", () => {
    const url = new URL(
      buildSanityQueryUrl(config, {
        query: "*[_type == $type && slug.current == $slug][0...$limit]",
        params: { type: "article", slug: "coastal-light", limit: 12 },
        tag: "article.detail",
      }),
    );

    expect(url.searchParams.get("$type")).toBe('"article"');
    expect(url.searchParams.get("$slug")).toBe('"coastal-light"');
    expect(url.searchParams.get("$limit")).toBe("12");
  });

  it("percent-encodes spaces rather than writing a plus", () => {
    // `+` means a space only under form encoding. `%20` needs no agreement
    // about how the far end decodes, and Sanity's own documentation warns
    // about encoding a query and its parameters together.
    const url = buildSanityQueryUrl(config, {
      query: "*[_type == $type]",
      tag: "services.list",
    });

    expect(url).toContain("query=*%5B_type%20%3D%3D%20%24type%5D");
    expect(url).not.toContain("+");
  });

  it("refuses a tag that is not a project-owned constant", () => {
    expect(() =>
      buildSanityQueryUrl(config, { query: "*[false]", tag: "Visitor Input!" }),
    ).toThrow("Invalid query tag");
  });

  it("measures the GET limit over the whole URL, not just the query", () => {
    // The bound is stated against the URL, so the origin, the API version, and
    // the dataset path count toward it. Measuring only the query string would
    // accept a request the service then rejects.
    const fixedOverhead = new TextEncoder().encode(
      buildSanityQueryUrl(config, { query: "", tag: "sized" }),
    ).length;

    const atTheLimit = buildSanityQueryUrl(config, {
      query: "a".repeat(MAX_SANITY_GET_URL_BYTES - fixedOverhead),
      tag: "sized",
    });
    expect(new TextEncoder().encode(atTheLimit).length).toBe(
      MAX_SANITY_GET_URL_BYTES,
    );

    expect(() =>
      buildSanityQueryUrl(config, {
        query: "a".repeat(MAX_SANITY_GET_URL_BYTES - fixedOverhead + 1),
        tag: "sized",
      }),
    ).toThrow("Query too large");
  });
});

describe("query", () => {
  it("returns the result from the documented response envelope", async () => {
    const { fetchImplementation } = stubFetch(() =>
      jsonResponse({ ms: 3, result: fixtureServices, syncTags: ["s1:fixture"] }),
    );
    const client = createSanityClient({ config, fetchImplementation });

    await expect(
      client.query({ query: '*[_type == "service"]', tag: "services.list" }),
    ).resolves.toEqual(fixtureServices);
  });

  it("returns a null result rather than calling it malformed", async () => {
    // GROQ evaluates to a value, so a document that does not exist is `null`.
    // That is a legitimate answer, not a broken response.
    const { fetchImplementation } = stubFetch(() =>
      jsonResponse({ ms: 1, result: null }),
    );
    const client = createSanityClient({ config, fetchImplementation });

    await expect(
      client.query({ query: '*[_id == "missing"][0]', tag: "article.detail" }),
    ).resolves.toBeNull();
  });

  it("sends no Authorization header for a public dataset", async () => {
    const { fetchImplementation, calls } = stubFetch(() =>
      jsonResponse({ result: [] }),
    );
    const client = createSanityClient({ config, fetchImplementation });

    await client.query({ query: "*[false]", tag: "probe" });

    expect(headerOf(calls[0], "Authorization")).toBeUndefined();
  });

  it("authorizes with a bearer token and keeps it out of the URL", async () => {
    const { fetchImplementation, calls } = stubFetch(() =>
      jsonResponse({ result: [] }),
    );
    const client = createSanityClient({
      config: authenticatedConfig,
      fetchImplementation,
    });

    await client.query({ query: "*[false]", tag: "probe" });

    expect(headerOf(calls[0], "Authorization")).toBe("Bearer sk-fixture-token");
    // A token in a URL reaches access logs, referrers, and error reports.
    expect(calls[0].url).not.toContain("sk-fixture-token");
  });

  it("does not let the runtime cache a content read", async () => {
    // Caching and revalidation are AB#83's decision, made on purpose rather
    // than inherited from whatever default the runtime applies.
    const { fetchImplementation, calls } = stubFetch(() =>
      jsonResponse({ result: [] }),
    );
    const client = createSanityClient({ config, fetchImplementation });

    await client.query({ query: "*[false]", tag: "probe" });

    expect(calls[0].init?.cache).toBe("no-store");
  });
});

describe("failure classification", () => {
  const cases: ReadonlyArray<
    readonly [number, SanityErrorClass, boolean]
  > = [
    [400, "query-rejected", false],
    [401, "unauthorized", false],
    [403, "unauthorized", false],
    [404, "not-found", false],
    [422, "query-rejected", false],
    [429, "rate-limited", true],
    [500, "unavailable", true],
    [503, "unavailable", true],
  ];

  it.each(cases)(
    "maps %i to %s",
    async (status, errorClass, retryable) => {
      silenceFailureLog();
      const { fetchImplementation } = stubFetch(() =>
        jsonResponse({ error: { description: "…", type: "queryParseError" } }, status),
      );
      const client = createSanityClient({ config, fetchImplementation });

      await expect(
        client.query({ query: "*[false]", tag: "probe" }),
      ).rejects.toMatchObject({ errorClass, retryable });
    },
  );

  it("classifies a timeout apart from an outage", async () => {
    silenceFailureLog();
    const { fetchImplementation } = stubFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const client = createSanityClient({ config, fetchImplementation });

    await expect(
      client.query({ query: "*[false]", tag: "probe" }),
    ).rejects.toMatchObject({ errorClass: "timeout", retryable: true });
  });

  it("treats a transport failure as a retryable outage", async () => {
    silenceFailureLog();
    const { fetchImplementation } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = createSanityClient({ config, fetchImplementation });

    await expect(
      client.query({ query: "*[false]", tag: "probe" }),
    ).rejects.toMatchObject({ errorClass: "unavailable", retryable: true });
  });

  it("refuses a 200 that is not JSON", async () => {
    silenceFailureLog();
    const { fetchImplementation } = stubFetch(
      () => new Response("<html>gateway</html>", { status: 200 }),
    );
    const client = createSanityClient({ config, fetchImplementation });

    await expect(
      client.query({ query: "*[false]", tag: "probe" }),
    ).rejects.toMatchObject({ errorClass: "malformed-response" });
  });

  it("refuses a 200 whose body carries no result", async () => {
    silenceFailureLog();
    const { fetchImplementation } = stubFetch(() => jsonResponse({ ms: 2 }));
    const client = createSanityClient({ config, fetchImplementation });

    await expect(
      client.query({ query: "*[false]", tag: "probe" }),
    ).rejects.toMatchObject({ errorClass: "malformed-response" });
  });

  it("never falls back to another source when the read fails", async () => {
    silenceFailureLog();
    const { fetchImplementation } = stubFetch(() =>
      jsonResponse({ error: { description: "…" } }, 500),
    );
    const client = createSanityClient({ config, fetchImplementation });

    // The only outcome of an unavailable Content Lake is a raised error. There
    // is no cached copy, no fixture, and no partial result to serve instead.
    await expect(
      client.query({ query: '*[_type == "service"]', tag: "services.list" }),
    ).rejects.toBeInstanceOf(SanityQueryError);
  });
});

describe("operational events", () => {
  it("writes one closed event per failure and nothing about the query", async () => {
    const logged = silenceFailureLog();
    const { fetchImplementation } = stubFetch(() =>
      jsonResponse(
        { error: { description: 'parse error near "coastal-light"' } },
        400,
      ),
    );
    const client = createSanityClient({
      config: authenticatedConfig,
      fetchImplementation,
    });

    const failure = await client
      .query({
        query: "*[_type == $type && slug.current == $slug][0]",
        params: { type: "article", slug: "coastal-light" },
        tag: "article.detail",
      })
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(SanityQueryError);
    expect(logged).toHaveBeenCalledTimes(1);

    const event = JSON.parse(logged.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;

    expect(event).toEqual({
      event: "sanity.query",
      correlationId: (failure as SanityQueryError).correlationId,
      state: "failed",
      tag: "article.detail",
      errorClass: "query-rejected",
    });

    // The closed schema is the point: no query, no parameter a visitor's URL
    // could have supplied, no provider prose, and no credential.
    const line = logged.mock.calls[0][0] as string;
    expect(line).not.toContain("coastal-light");
    expect(line).not.toContain("sk-fixture-token");
    expect(line).not.toContain("parse error");
  });
});

describe("probeSanityConnectivity", () => {
  it("reads no document while proving the address and credential", async () => {
    const { fetchImplementation, calls } = stubFetch(() =>
      jsonResponse({ ms: 1, result: [] }),
    );
    const client = createSanityClient({
      config: authenticatedConfig,
      fetchImplementation,
    });

    await expect(probeSanityConnectivity(client)).resolves.toEqual({
      status: "reachable",
    });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get("query")).toBe("*[false]");
    expect(url.searchParams.get("perspective")).toBe("published");
  });

  it("reports why the deployment cannot reach its own project", async () => {
    silenceFailureLog();
    const { fetchImplementation } = stubFetch(() =>
      jsonResponse({ error: { description: "Dataset not found" } }, 404),
    );
    const client = createSanityClient({ config, fetchImplementation });

    await expect(probeSanityConnectivity(client)).resolves.toEqual({
      status: "unreachable",
      errorClass: "not-found",
    });
  });
});

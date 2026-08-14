import { describe, expect, it, vi } from "vitest";

import { serviceType } from "../../sanity/schemas/service";
import {
  ORDERED_SERVICE_FIELDS,
  projectPublicService,
  PROJECTED_SERVICE_FIELDS,
  PUBLIC_SERVICE_FILTER,
  PUBLIC_SERVICE_ORDER,
  PUBLIC_SERVICE_PROJECTION,
  readPublicServiceBySlug,
  readPublicServices,
  SanityServiceError,
  SERVICE_DOCUMENT_TYPE,
  type RawPublicServiceDocument,
} from "@/lib/sanity-services";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const languages = { language: "en", fallbackLanguage: "fi" } as const;

function documentOf(
  overrides: Partial<RawPublicServiceDocument> = {},
): RawPublicServiceDocument {
  return {
    slug: "portrait-sessions",
    name: "Portrait sessions",
    shortDescription: "Relaxed, natural portraits.",
    description: ["A short, friendly session.", "Delivered through an online gallery."],
    ...overrides,
  };
}

function fakeClient(
  answer: unknown,
): { client: SanityClient; requests: SanityQueryRequest[] } {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        return answer;
      },
    },
  };
}

function rejectionOf(run: () => unknown): SanityServiceError {
  try {
    run();
  } catch (error) {
    if (error instanceof SanityServiceError) return error;
    throw error;
  }
  throw new Error("expected projection to throw");
}

describe("the query contract", () => {
  it("asks only for fields the schema declares", () => {
    const declared = new Set(serviceType.fields.map((field) => field.name));

    for (const field of [...PROJECTED_SERVICE_FIELDS, ...ORDERED_SERVICE_FIELDS]) {
      expect(declared.has(field)).toBe(true);
    }
    for (const field of PROJECTED_SERVICE_FIELDS) {
      expect(PUBLIC_SERVICE_PROJECTION).toContain(field);
    }

    expect(SERVICE_DOCUMENT_TYPE).toBe(serviceType.name);
    expect(PUBLIC_SERVICE_FILTER).toContain(SERVICE_DOCUMENT_TYPE);
    expect(PUBLIC_SERVICE_ORDER).toContain("order");
  });
});

describe("projecting one document", () => {
  it("maps a service with no cover, price, or pricing", () => {
    expect(projectPublicService(documentOf(), { ...languages, config })).toEqual({
      slug: "portrait-sessions",
      name: "Portrait sessions",
      shortDescription: "Relaxed, natural portraits.",
      description: [
        "A short, friendly session.",
        "Delivered through an online gallery.",
      ],
    });
  });

  it("maps a service with a starting price and a pricing breakdown", () => {
    const document = documentOf({
      startingPrice: "From 250 €",
      pricing: [
        { name: "Mini session", price: "From 250 €", note: "30 minutes." },
        { name: "Full session", price: "450 €" },
      ],
    });

    expect(
      projectPublicService(document, { ...languages, config }),
    ).toMatchObject({
      startingPrice: "From 250 €",
      pricing: [
        { name: "Mini session", price: "From 250 €", note: "30 minutes." },
        { name: "Full session", price: "450 €" },
      ],
    });
  });

  it("rejects a document with no usable slug", () => {
    const error = rejectionOf(() =>
      projectPublicService(documentOf({ slug: "Not A Slug" }), {
        ...languages,
        config,
      }),
    );
    expect(error.rejection).toBe("incomplete-document");
  });

  it.each([
    ["name", { name: undefined }],
    ["shortDescription", { shortDescription: undefined }],
    ["description", { description: [] }],
  ])("rejects a document missing %s", (_field, overrides) => {
    const error = rejectionOf(() =>
      projectPublicService(documentOf(overrides), { ...languages, config }),
    );
    expect(error.rejection).toBe("incomplete-document");
    expect(error.slug).toBe("portrait-sessions");
  });

  it("rejects a pricing package with no name or price", () => {
    const error = rejectionOf(() =>
      projectPublicService(
        documentOf({ pricing: [{ note: "missing name and price" }] }),
        { ...languages, config },
      ),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("reading the catalog", () => {
  it("orders by the author-controlled field, tie-broken by slug", async () => {
    const { client, requests } = fakeClient([]);

    await readPublicServices({ language: "en", client, config });

    expect(requests[0].query).toContain(PUBLIC_SERVICE_ORDER);
  });

  it("projects every document the store returns", async () => {
    const { client } = fakeClient([documentOf(), documentOf({ slug: "weddings", name: "Weddings" })]);

    const services = await readPublicServices({ language: "en", client, config });

    expect(services.map((service) => service.slug)).toEqual([
      "portrait-sessions",
      "weddings",
    ]);
  });

  it("refuses a listing where two published documents claim one slug", async () => {
    // Studio blocks this, but an API import bypasses Studio validation. If the
    // listing silently kept both cards, it would disagree with
    // readPublicServiceBySlug, which throws for the very same state.
    const { client } = fakeClient([documentOf(), documentOf()]);

    await expect(
      readPublicServices({ language: "en", client, config }),
    ).rejects.toMatchObject({ rejection: "ambiguous-slug" });
  });
});

describe("reading one service by slug", () => {
  it("returns undefined for an unknown or unpublished slug", async () => {
    const { client } = fakeClient([]);

    expect(
      await readPublicServiceBySlug("unknown", { language: "en", client, config }),
    ).toBeUndefined();
  });

  it("throws when two published documents claim one slug", async () => {
    const { client } = fakeClient([documentOf(), documentOf()]);

    await expect(
      readPublicServiceBySlug("portrait-sessions", {
        language: "en",
        client,
        config,
      }),
    ).rejects.toMatchObject({ rejection: "ambiguous-slug" });
  });

  it("projects the one matching document", async () => {
    const { client } = fakeClient([documentOf()]);

    const service = await readPublicServiceBySlug("portrait-sessions", {
      language: "en",
      client,
      config,
    });

    expect(service?.name).toBe("Portrait sessions");
  });
});

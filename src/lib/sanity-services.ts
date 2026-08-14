/**
 * The public services adapter: one Sanity `service` document in, one
 * validated `src/lib/services.ts#Service` out — the same boundary shape
 * `sanity-media.ts` established for a photograph, applied to a service entry.
 *
 * Services carry no locale of their own (`service.ts`'s module comment
 * explains why), so `language` here exists only to resolve a referenced
 * cover photograph's alt text and caption — the same two fields any other
 * media placement needs a language for.
 *
 * The projection is an allow-list, embedding `PUBLIC_MEDIA_PROJECTION` for the
 * optional cover exactly as `sanity-home-content.ts` does for the hero: one
 * photograph projection, reused everywhere a document references one.
 */

import "server-only";

import { getDeploymentConfig } from "@/lib/deployment-config";
import type { Service, ServicePricePackage } from "@/lib/services";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import { isRecord, readString } from "@/lib/sanity-values";

/**
 * The document type this adapter reads. Declared here rather than imported
 * from `sanity/schemas`: the Studio schema is content-store configuration, not
 * application code (ADR-0006). A test pins the two names together.
 */
export const SERVICE_DOCUMENT_TYPE = "service";

/** Fields the query reads. Exists as data so a test can check it against the schema. */
export const PROJECTED_SERVICE_FIELDS = [
  "slug",
  "name",
  "shortDescription",
  "description",
  "coverMedia",
  "startingPrice",
  "pricing",
] as const;

/** Fields the query sorts by. Read, never projected — see `PUBLIC_SERVICE_ORDER`. */
export const ORDERED_SERVICE_FIELDS = ["order", "slug"] as const;

export const PUBLIC_SERVICE_FILTER = `_type == "${SERVICE_DOCUMENT_TYPE}"`;

/** Author-controlled order, tie-broken by the identity every service has. */
export const PUBLIC_SERVICE_ORDER = `order(order asc, slug asc)`;

export const PUBLIC_SERVICE_PROJECTION = `{
  slug,
  name,
  shortDescription,
  description,
  "coverMedia": coverMedia->${PUBLIC_MEDIA_PROJECTION},
  startingPrice,
  pricing[]{name, price, note}
}`;

/** Why a document could not become a public service. */
export type SanityServiceRejection =
  /** Required identity, name, or description is missing or unusable. */
  | "incomplete-document"
  /** Two published documents claim one slug. */
  | "ambiguous-slug"
  /** The store answered with something that is not a list of documents. */
  | "malformed-result";

export class SanityServiceError extends Error {
  readonly rejection: SanityServiceRejection;
  readonly slug: string | undefined;

  constructor(
    rejection: SanityServiceRejection,
    detail: string,
    slug?: string,
  ) {
    super(
      `[sanity-services] ${detail}${slug === undefined ? "" : ` (slug "${slug}")`}`,
    );
    this.name = "SanityServiceError";
    this.rejection = rejection;
    this.slug = slug;
  }
}

/** The identity form `service.ts`'s Studio validation enforces, enforced again here. */
const SERVICE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type RawPricingPackage = {
  readonly name?: unknown;
  readonly price?: unknown;
  readonly note?: unknown;
};

/**
 * One document as the projection above returns it. Every field is `unknown`:
 * this is data that arrived over the network, typed as what it should be only
 * after it has been checked.
 */
export type RawPublicServiceDocument = {
  readonly slug?: unknown;
  readonly name?: unknown;
  readonly shortDescription?: unknown;
  readonly description?: unknown;
  readonly coverMedia?: unknown;
  readonly startingPrice?: unknown;
  readonly pricing?: unknown;
};

export type PublicServiceLanguage = {
  readonly language: string;
  readonly fallbackLanguage: string;
};

function readDescription(value: unknown, slug: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new SanityServiceError(
      "incomplete-document",
      "the service has no description paragraphs",
      slug,
    );
  }
  return value;
}

function readPricing(
  value: unknown,
  slug: string,
): readonly ServicePricePackage[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new SanityServiceError(
      "incomplete-document",
      "the service's pricing is not a list",
      slug,
    );
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new SanityServiceError(
        "incomplete-document",
        "the service has a malformed pricing package",
        slug,
      );
    }
    const raw = entry as RawPricingPackage;
    const name = readString(raw.name);
    const price = readString(raw.price);
    if (name === undefined || price === undefined) {
      throw new SanityServiceError(
        "incomplete-document",
        "a pricing package needs a name and a price",
        slug,
      );
    }
    const note = readString(raw.note);
    return { name, price, ...(note === undefined ? {} : { note }) };
  });
}

/**
 * Projects one document into the public contract. Pure and exported for the
 * same reason `sanity-media.ts#projectPublicMedia` is: testable without an
 * environment, and reusable by any future adapter that reads a service.
 */
export function projectPublicService(
  document: RawPublicServiceDocument,
  options: PublicServiceLanguage & { readonly config: SanityConfig },
): Service {
  const slug = readString(document.slug);
  if (slug === undefined || !SERVICE_SLUG.test(slug)) {
    throw new SanityServiceError(
      "incomplete-document",
      "a service document has no usable slug, so nothing can reference it",
    );
  }

  const name = readString(document.name);
  if (name === undefined) {
    throw new SanityServiceError(
      "incomplete-document",
      "the service has no name",
      slug,
    );
  }

  const shortDescription = readString(document.shortDescription);
  if (shortDescription === undefined) {
    throw new SanityServiceError(
      "incomplete-document",
      "the service has no short description",
      slug,
    );
  }

  const description = readDescription(document.description, slug);
  const coverMedia = isRecord(document.coverMedia)
    ? projectPublicMedia(document.coverMedia as RawPublicMediaDocument, options)
    : undefined;
  const startingPrice = readString(document.startingPrice);
  const pricing = readPricing(document.pricing, slug);

  return {
    slug,
    name,
    shortDescription,
    description: [...description],
    ...(coverMedia === undefined ? {} : { coverMedia }),
    ...(startingPrice === undefined ? {} : { startingPrice }),
    ...(pricing === undefined ? {} : { pricing: [...pricing] }),
  };
}

/**
 * Reads the documented answer shape, or says so. A query that evaluates to
 * something other than a list of documents is a broken contract, not an
 * empty catalog.
 */
function readDocuments(result: unknown): readonly RawPublicServiceDocument[] {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityServiceError(
      "malformed-result",
      "the content store answered with something other than a list of service documents",
    );
  }
  return result;
}

/** The locale that owns the unprefixed routes — the one alternative text falls back to. */
function getFallbackLocale(): string {
  return getDeploymentConfig().localeRoutes.defaultLocale;
}

export type PublicServiceReadOptions = {
  readonly language: string;
  /** Injected in tests; production resolves the deployment's own client. */
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

function resolveRead(options: PublicServiceReadOptions): {
  client: SanityClient;
  config: SanityConfig;
  languages: PublicServiceLanguage;
} {
  return {
    client: options.client ?? getSanityClient(),
    config: options.config ?? getSanityConfig(),
    languages: {
      language: options.language,
      fallbackLanguage: getFallbackLocale(),
    },
  };
}

/**
 * The whole services catalog, in listing order. Unbounded, like
 * `readPublicCategoryInputs`: a services list is a small, deployment-curated
 * catalog rather than an archive needing pagination.
 *
 * Studio blocks a duplicate slug, but that rule does not bind an API import,
 * so this read checks again: two published documents claiming one slug would
 * otherwise silently hand a visitor two listing cards for one URL, while
 * `readPublicServiceBySlug` throws for the very same state. Refusing here
 * keeps the listing and detail reads agreeing on what "this slug" means,
 * rather than the listing publishing a reference the detail read cannot
 * resolve unambiguously.
 */
export async function readPublicServices(
  options: PublicServiceReadOptions,
): Promise<readonly Service[]> {
  const { client, config, languages } = resolveRead(options);

  const result = await client.query({
    query: `*[${PUBLIC_SERVICE_FILTER}] | ${PUBLIC_SERVICE_ORDER}${PUBLIC_SERVICE_PROJECTION}`,
    tag: "service.list",
  });

  const services = readDocuments(result).map((document) =>
    projectPublicService(document, { ...languages, config }),
  );

  const slugs = new Set<string>();
  for (const service of services) {
    if (slugs.has(service.slug)) {
      throw new SanityServiceError(
        "ambiguous-slug",
        "two published documents claim one service slug",
        service.slug,
      );
    }
    slugs.add(service.slug);
  }

  return services;
}

/**
 * One service by its slug, or `undefined` when this deployment publishes none
 * under it — the defined behavior an unknown or unpublished slug gets, rather
 * than an error.
 */
export async function readPublicServiceBySlug(
  slug: string,
  options: PublicServiceReadOptions,
): Promise<Service | undefined> {
  const { client, config, languages } = resolveRead(options);

  const result = await client.query({
    query: `*[${PUBLIC_SERVICE_FILTER} && slug == $slug][0...2]${PUBLIC_SERVICE_PROJECTION}`,
    params: { slug },
    tag: "service.detail",
  });

  const documents = readDocuments(result);
  if (documents.length === 0) return undefined;
  if (documents.length > 1) {
    throw new SanityServiceError(
      "ambiguous-slug",
      "two published documents claim one service slug",
      slug,
    );
  }

  return projectPublicService(documents[0], { ...languages, config });
}

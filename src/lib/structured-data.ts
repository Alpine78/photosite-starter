/**
 * Typed JSON-LD structured data for the site's supported public page types.
 *
 * Scope (AB#86 refinement — owner-decided, not inferred):
 *
 *   - Home / site root .......... WebSite + Organization
 *   - Service detail route ...... Service
 *   - Article detail route ...... Article  (the `article` content variant only)
 *
 * Nothing else emits structured data: not a gallery detail, a category branch,
 * the story root, the `/services` listing, `/contact`, or any `?cursor=` /
 * `?section=` continuation. Adding a type is a refinement decision, recorded
 * here, not a code decision made in passing.
 *
 * Rules, from AB#86's acceptance criteria:
 *
 *   - Every value is an explicitly modelled `SiteSettings`, `Service`, or
 *     `ContentPage` field, or a deployment-config value. Nothing is inferred:
 *     no `author`, `publisher`, `provider`, `ContactPoint`, `PostalAddress`,
 *     `logo`, or `offers` entity is synthesized from data the model does not
 *     carry as such. In particular `Service.pricing[].price` is a pre-formatted
 *     display string ("From 450 €"), not a decomposable amount + currency, so
 *     no `Offer` is emitted from it.
 *   - `Organization.name` is `SiteSettings.siteName`: a deployment that opts
 *     into structured data accepts its site name as the public name of an
 *     organization. The `Organization` type (rather than `Person`) is the
 *     owner's choice at refinement, not a guess this module makes.
 *   - An absent optional field omits its property entirely — never `null`,
 *     never `""`. An entity with nothing left to say is omitted rather than
 *     emitted half-populated.
 *   - Every URL is absolute. A route URL uses this deployment's canonical base
 *     and ADR-0003's canonical path shape (`canonicalRouteUrl`); a media URL is
 *     resolved-or-preserved by `absoluteAssetUrl`, so a public CDN derivative
 *     (ADR-0005) keeps its own origin.
 *   - `serializeJsonLd` escapes `<`, `>`, `&`, U+2028, and U+2029 so an
 *     authored string containing `</script>` cannot terminate the block —
 *     `JSON.stringify` alone does not (Next.js's own JSON-LD guidance).
 *
 * Pure: no IO, no `getSiteSettings` / `getDeploymentConfig` call of its own. A
 * route passes the data it already loaded, and the Service and Article builders
 * take only the deployment config — never `SiteSettings` — so rendering them
 * adds no settings read to those paths.
 */

import { absoluteAssetUrl, canonicalRouteUrl } from "@/lib/canonical-url";
import type { ArticleContentPage } from "@/lib/content-page";
import type { DeploymentConfig } from "@/lib/deployment-config";
import type { ImageMedia } from "@/lib/media";
import type { Service } from "@/lib/services";
import type { SiteSettings } from "@/lib/site-settings";

const SCHEMA_CONTEXT = "https://schema.org";

/**
 * A JSON-LD tree. `undefined` is permitted as an object value so a builder can
 * write `key: maybeValue` and have the key vanish from the output when the
 * source field is absent — `JSON.stringify` drops `undefined`-valued keys.
 */
export type JsonLdObject = { readonly [key: string]: JsonLdValue | undefined };
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | JsonLdObject;

/**
 * `JSON.stringify` with the characters that let an authored value break out of
 * a `<script>` block (or trip a JSON-in-HTML parser) replaced by their `\uXXXX`
 * escapes. The result still `JSON.parse`s back to the identical value.
 */
export function serializeJsonLd(value: JsonLdValue): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A trimmed non-empty string, or `undefined` — the value to assign a key. */
function textOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/** The absolute URL of an image cover, or `undefined` when there is none. */
function coverAssetUrl(
  cover: ImageMedia | undefined,
  canonicalBaseUrl: URL,
): string | undefined {
  return cover === undefined
    ? undefined
    : absoluteAssetUrl(cover.rendition.src, canonicalBaseUrl);
}

export type SiteEntityJsonLdInput = {
  readonly settings: SiteSettings;
  readonly deployment: DeploymentConfig;
};

/**
 * The site itself. `name` and `url` are the only facts the model carries for
 * it; `inLanguage` is the deployment's own locale. No `potentialAction` /
 * `SearchAction` — there is no site-search route to point one at yet.
 */
export function buildWebSiteJsonLd({
  settings,
  deployment,
}: SiteEntityJsonLdInput): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    name: settings.siteName,
    url: canonicalRouteUrl("/", deployment.canonicalBaseUrl),
    inLanguage: deployment.locale,
  };
}

/**
 * The organization behind the site. `name` is the site name (see the module
 * header), `url` its canonical base, and `sameAs` its social profile URLs —
 * omitted entirely when none are configured. Nothing else: no `logo` (the
 * deployment default social image is a card, not a brand mark), no
 * `contactPoint` (a synthesized entity the model does not carry as such).
 */
export function buildOrganizationJsonLd({
  settings,
  deployment,
}: SiteEntityJsonLdInput): JsonLdObject {
  const sameAs = settings.socialLinks.map((link) => link.url);
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    name: settings.siteName,
    url: canonicalRouteUrl("/", deployment.canonicalBaseUrl),
    ...(sameAs.length === 0 ? {} : { sameAs }),
  };
}

export type ServiceJsonLdInput = {
  readonly service: Service;
  readonly deployment: DeploymentConfig;
};

/**
 * One offered service. `description` is the same short summary its card and
 * `<meta name="description">` use. `image` is the cover's public rendition when
 * the cover is an image — a video cover, or no cover, omits it. No `provider`
 * and no `offers` (see the module header).
 */
export function buildServiceJsonLd({
  service,
  deployment,
}: ServiceJsonLdInput): JsonLdObject {
  const image = coverAssetUrl(
    service.coverMedia?.type === "image" ? service.coverMedia : undefined,
    deployment.canonicalBaseUrl,
  );
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Service",
    name: service.name,
    description: service.shortDescription,
    url: canonicalRouteUrl(
      `/services/${service.slug}`,
      deployment.canonicalBaseUrl,
    ),
    ...(image === undefined ? {} : { image }),
  };
}

export type ArticleJsonLdInput = {
  readonly page: ArticleContentPage;
  readonly deployment: DeploymentConfig;
  /**
   * The article's canonical route path — the route resolves this from the tree
   * (`buildStoryPath(config, locale, getStoryRoutePath(tree, route))`), so the
   * builder takes it rather than recomputing it.
   */
  readonly canonicalPath: string;
  /** The locale of the route space this article is being rendered in. */
  readonly locale: string;
};

/**
 * One editorial article. `headline`, `datePublished`, `inLanguage`, and
 * `mainEntityOfPage` are always present; `description` (the lead), `image` (an
 * image cover), and `keywords` (tags) are each omitted when the page has none.
 * No `author`, `publisher`, or `dateModified` — the content model carries none
 * of them, and inventing one would fabricate a business fact.
 */
export function buildArticleJsonLd({
  page,
  deployment,
  canonicalPath,
  locale,
}: ArticleJsonLdInput): JsonLdObject {
  const description = textOrUndefined(page.summary);
  const image = coverAssetUrl(page.cover, deployment.canonicalBaseUrl);
  // The tag model does not forbid a blank string (neither the Sanity schema nor
  // its adapter trims one), so join only the non-blank tags and omit `keywords`
  // entirely when nothing is left — a `keywords: "  , "` would be exactly the
  // placeholder value the omission contract exists to prevent.
  const keywords = (page.tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .join(", ");
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: page.title,
    datePublished: page.publishedAt,
    inLanguage: locale,
    mainEntityOfPage: canonicalRouteUrl(
      canonicalPath,
      deployment.canonicalBaseUrl,
    ),
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image }),
    ...(keywords.length === 0 ? {} : { keywords }),
  };
}

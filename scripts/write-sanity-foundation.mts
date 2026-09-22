#!/usr/bin/env node
/**
 * Writes the two owner-approved public singletons: site settings and home page.
 *
 * A foundation plan is deliberately small and strict.  It is not a general
 * purpose Sanity mutation tool: no field outside the public singleton schemas
 * is accepted, dry runs are offline, and an apply can only create an absent
 * singleton or prove that an earlier identical run already created it.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  type SeedConnection,
} from "./sanity-seed-http.mts";

export const FOUNDATION_WRITE_PLAN_VERSION = "sanity-foundation-write-plan-v1";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const DOCUMENT_ID_PATTERN = /^migrated--(?:site-settings|home-page)-[a-z0-9-]+$/u;
const LANGUAGE_PATTERN = /^[a-z]{2,3}$/u;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STATIC_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/u;
const LOCALIZED_FIELDS = new Set(["_key", "_type", "language", "value"]);
const LINK_FIELDS = new Set(["_key", "_type", "label", "target", "href"]);
const SECTION_FIELDS = new Set(["_key", "_type", "title", "description", "target", "href"]);
const SITE_FIELDS = new Set([
  "_id", "_type", "siteName", "photographerName", "tagline", "servicesIntro",
  "featuredGalleryId", "navigation", "contact", "socialLinks", "footerLinks",
  "copyrightHolder", "defaultSeo",
]);
const HOME_FIELDS = new Set(["_id", "_type", "heroMedia", "heroAction", "intro", "sections"]);

type LocalizedText = {
  readonly _key: string;
  readonly _type: "localizedText";
  readonly language: string;
  readonly value: string;
};

type SiteLink = {
  /** Navigation array entries need a key; the single home action does not. */
  readonly _key?: string;
  readonly _type: "navigationItem" | "homeAction";
  readonly label: readonly LocalizedText[];
  readonly target: "static" | "story-root" | "featured-gallery";
  readonly href?: string;
};

type HomeSection = {
  readonly _key: string;
  readonly _type: "homeSection";
  readonly title: readonly LocalizedText[];
  readonly description: readonly LocalizedText[];
  readonly target: "static" | "story-root" | "featured-gallery";
  readonly href?: string;
};

export type SiteSettingsWriteDocument = {
  readonly _id: string;
  readonly _type: "siteSettings";
  readonly siteName: string;
  readonly photographerName: string;
  readonly tagline: readonly LocalizedText[];
  readonly servicesIntro?: readonly LocalizedText[];
  readonly featuredGalleryId?: string;
  readonly navigation: readonly SiteLink[];
  readonly contact: {
    readonly _type: "object";
    readonly email: string;
    readonly phone?: string;
    readonly businessId?: string;
    readonly address?: readonly LocalizedText[];
    readonly privacyNotice: {
      readonly _type: "object";
      readonly collected: readonly LocalizedText[];
      readonly purpose: readonly LocalizedText[];
      readonly recipient: readonly LocalizedText[];
      readonly retention: readonly LocalizedText[];
    };
  };
  readonly socialLinks: readonly {
    readonly _key: string;
    readonly _type: "object";
    readonly platform: string;
    readonly url: string;
    readonly label: readonly LocalizedText[];
  }[];
  readonly footerLinks: readonly SiteLink[];
  readonly copyrightHolder: string;
  readonly defaultSeo: {
    readonly _type: "object";
    readonly titleTemplate: readonly LocalizedText[];
    readonly description: readonly LocalizedText[];
  };
};

export type HomePageWriteDocument = {
  readonly _id: string;
  readonly _type: "homePage";
  readonly heroMedia: { readonly _type: "reference"; readonly _ref: string };
  readonly heroAction?: SiteLink;
  readonly intro: readonly LocalizedText[];
  readonly sections: readonly HomeSection[];
};

export type FoundationWritePlan = {
  readonly version: typeof FOUNDATION_WRITE_PLAN_VERSION;
  readonly documents: readonly [SiteSettingsWriteDocument, HomePageWriteDocument] | readonly [HomePageWriteDocument, SiteSettingsWriteDocument];
};

type FoundationDocument = SiteSettingsWriteDocument | HomePageWriteDocument;
type ExistingDocument = Readonly<Record<string, unknown>>;

const FOUNDATION_DOCUMENT_PROJECTION = `_id, _type,
  siteName, photographerName, tagline, servicesIntro, featuredGalleryId,
  navigation[]{_key, _type, label, target, href},
  contact{_type, email, phone, address, businessId, privacyNotice{_type, collected, purpose, recipient, retention}},
  socialLinks[]{_key, _type, platform, url, label},
  footerLinks[]{_key, _type, label, target, href},
  copyrightHolder, defaultSeo{_type, titleTemplate, description},
  heroMedia{_type, _ref}, heroAction{_key, _type, label, target, href}, intro,
  sections[]{_key, _type, title, description, target, href}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function publishedIdOf(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

/** GROQ projects absent optional fields as null; plans intentionally omit them. */
function normalizeFoundationReadback(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFoundationReadback);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== null)
      .map(([key, field]) => [key, normalizeFoundationReadback(field)]),
  );
}

function unknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: string[]): void {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) issues.push(`${path} has unsupported field(s): ${unknown.join(", ")}`);
}

function parseLocalized(value: unknown, path: string, issues: string[]): readonly LocalizedText[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path} must be a non-empty localized text array`);
    return undefined;
  }
  const languages = new Set<string>();
  const parsed: LocalizedText[] = [];
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) { issues.push(`${entryPath} is not an object`); continue; }
    unknownFields(entry, LOCALIZED_FIELDS, entryPath, issues);
    if (entry._type !== "localizedText") issues.push(`${entryPath}._type must be "localizedText"`);
    if (typeof entry.language !== "string" || !LANGUAGE_PATTERN.test(entry.language)) issues.push(`${entryPath}.language is invalid`);
    if (typeof entry._key !== "string" || entry._key !== entry.language) issues.push(`${entryPath}._key must equal its language`);
    if (!isNonBlank(entry.value)) issues.push(`${entryPath}.value must be non-empty`);
    if (typeof entry.language === "string" && languages.has(entry.language)) issues.push(`${path} repeats language "${entry.language}"`);
    if (typeof entry.language === "string") languages.add(entry.language);
    if (entry._type === "localizedText" && typeof entry._key === "string" && typeof entry.language === "string" && typeof entry.value === "string") {
      parsed.push({ _key: entry._key, _type: "localizedText", language: entry.language, value: entry.value });
    }
  }
  return parsed.length === value.length ? parsed : undefined;
}

function parseTarget(value: Record<string, unknown>, path: string, issues: string[]): "static" | "story-root" | "featured-gallery" | undefined {
  if (value.target !== "static" && value.target !== "story-root" && value.target !== "featured-gallery") {
    issues.push(`${path}.target is invalid`);
    return undefined;
  }
  if (value.target === "static") {
    if (typeof value.href !== "string" || !STATIC_PATH.test(value.href) || value.href === "/") issues.push(`${path}.href must be a non-root static path`);
  } else if (value.href !== undefined) {
    issues.push(`${path}.href is only allowed for a static target`);
  }
  return value.target;
}

function parseLink(value: unknown, path: string, type: "navigationItem" | "homeAction", issues: string[]): SiteLink | undefined {
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, LINK_FIELDS, path, issues);
  if (type === "navigationItem" && !isNonBlank(value._key)) issues.push(`${path}._key must be non-empty`);
  if (type === "homeAction" && value._key !== undefined && !isNonBlank(value._key)) issues.push(`${path}._key must be non-empty when present`);
  if (value._type !== type) issues.push(`${path}._type must be "${type}"`);
  const label = parseLocalized(value.label, `${path}.label`, issues);
  const target = parseTarget(value, path, issues);
  if ((type === "navigationItem" && typeof value._key !== "string") || (value._key !== undefined && typeof value._key !== "string") || value._type !== type || label === undefined || target === undefined) return undefined;
  return { ...(typeof value._key === "string" ? { _key: value._key } : {}), _type: type, label, target, ...(target === "static" ? { href: value.href as string } : {}) };
}

function parseLinks(value: unknown, path: string, type: "navigationItem" | "homeAction", required: boolean, issues: string[]): readonly SiteLink[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || (required && value.length === 0)) {
    issues.push(`${path} must be ${required ? "a non-empty" : "an"} array`);
    return undefined;
  }
  const keys = new Set<string>();
  const parsed = value.map((entry, index) => parseLink(entry, `${path}[${index}]`, type, issues));
  for (const link of parsed) {
    if (link !== undefined && link._key !== undefined && keys.has(link._key)) issues.push(`${path} repeats key "${link._key}"`);
    if (link?._key !== undefined) keys.add(link._key);
  }
  return parsed.every((entry): entry is SiteLink => entry !== undefined) ? parsed : undefined;
}

function parseSection(value: unknown, path: string, issues: string[]): HomeSection | undefined {
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, SECTION_FIELDS, path, issues);
  if (!isNonBlank(value._key)) issues.push(`${path}._key must be non-empty`);
  if (value._type !== "homeSection") issues.push(`${path}._type must be "homeSection"`);
  const title = parseLocalized(value.title, `${path}.title`, issues);
  const description = parseLocalized(value.description, `${path}.description`, issues);
  const target = parseTarget(value, path, issues);
  if (typeof value._key !== "string" || value._type !== "homeSection" || title === undefined || description === undefined || target === undefined) return undefined;
  return { _key: value._key, _type: "homeSection", title, description, target, ...(target === "static" ? { href: value.href as string } : {}) };
}

function parseSiteSettings(value: unknown, path: string, issues: string[]): SiteSettingsWriteDocument | undefined {
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, SITE_FIELDS, path, issues);
  if (!isNonBlank(value._id) || !DOCUMENT_ID_PATTERN.test(value._id) || !value._id.startsWith("migrated--site-settings-")) issues.push(`${path}._id must be a migrated site settings identifier`);
  if (value._type !== "siteSettings") issues.push(`${path}._type must be "siteSettings"`);
  if (!isNonBlank(value.siteName)) issues.push(`${path}.siteName must be non-empty`);
  if (!isNonBlank(value.photographerName)) issues.push(`${path}.photographerName must be non-empty`);
  if (!isNonBlank(value.copyrightHolder)) issues.push(`${path}.copyrightHolder must be non-empty`);
  if (value.featuredGalleryId !== undefined && (typeof value.featuredGalleryId !== "string" || !ID_PATTERN.test(value.featuredGalleryId))) issues.push(`${path}.featuredGalleryId is invalid`);
  const tagline = parseLocalized(value.tagline, `${path}.tagline`, issues);
  const servicesIntro = value.servicesIntro === undefined ? undefined : parseLocalized(value.servicesIntro, `${path}.servicesIntro`, issues);
  const navigation = parseLinks(value.navigation, `${path}.navigation`, "navigationItem", true, issues);
  const footerLinks = parseLinks(value.footerLinks, `${path}.footerLinks`, "navigationItem", true, issues);
  const contact = parseContact(value.contact, `${path}.contact`, issues);
  const socialLinks = parseSocialLinks(value.socialLinks, `${path}.socialLinks`, issues);
  const defaultSeo = parseDefaultSeo(value.defaultSeo, `${path}.defaultSeo`, issues);
  if (typeof value._id !== "string" || value._type !== "siteSettings" || !isNonBlank(value.siteName) || !isNonBlank(value.photographerName) || !isNonBlank(value.copyrightHolder) || tagline === undefined || navigation === undefined || footerLinks === undefined || contact === undefined || socialLinks === undefined || defaultSeo === undefined || (value.servicesIntro !== undefined && servicesIntro === undefined)) return undefined;
  const needsFeatured = [...navigation, ...footerLinks].some((link) => link.target === "featured-gallery");
  if (needsFeatured && value.featuredGalleryId === undefined) { issues.push(`${path}.featuredGalleryId is required by a featured-gallery link`); return undefined; }
  return { _id: value._id, _type: "siteSettings", siteName: value.siteName, photographerName: value.photographerName, tagline, ...(servicesIntro === undefined ? {} : { servicesIntro }), ...(typeof value.featuredGalleryId === "string" ? { featuredGalleryId: value.featuredGalleryId } : {}), navigation, contact, socialLinks, footerLinks, copyrightHolder: value.copyrightHolder, defaultSeo };
}

function parseContact(value: unknown, path: string, issues: string[]): SiteSettingsWriteDocument["contact"] | undefined {
  const allowed = new Set(["_type", "email", "phone", "address", "businessId", "privacyNotice"]);
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, allowed, path, issues);
  if (value._type !== "object") issues.push(`${path}._type must be "object"`);
  if (!isNonBlank(value.email) || !/^[^\s@,;:<>'"\\[\]]+@[^\s@]+\.[^\s@]+$/u.test(value.email)) issues.push(`${path}.email is invalid`);
  if (value.phone !== undefined && !isNonBlank(value.phone)) issues.push(`${path}.phone must be non-empty when present`);
  if (value.businessId !== undefined && !isNonBlank(value.businessId)) issues.push(`${path}.businessId must be non-empty when present`);
  const address = value.address === undefined ? undefined : parseLocalized(value.address, `${path}.address`, issues);
  const privacy = parsePrivacy(value.privacyNotice, `${path}.privacyNotice`, issues);
  if (value._type !== "object" || !isNonBlank(value.email) || privacy === undefined || (value.address !== undefined && address === undefined)) return undefined;
  return { _type: "object", email: value.email, ...(typeof value.phone === "string" ? { phone: value.phone } : {}), ...(typeof value.businessId === "string" ? { businessId: value.businessId } : {}), ...(address === undefined ? {} : { address }), privacyNotice: privacy };
}

function parsePrivacy(value: unknown, path: string, issues: string[]): SiteSettingsWriteDocument["contact"]["privacyNotice"] | undefined {
  const allowed = new Set(["_type", "collected", "purpose", "recipient", "retention"]);
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, allowed, path, issues);
  if (value._type !== "object") issues.push(`${path}._type must be "object"`);
  const collected = parseLocalized(value.collected, `${path}.collected`, issues);
  const purpose = parseLocalized(value.purpose, `${path}.purpose`, issues);
  const recipient = parseLocalized(value.recipient, `${path}.recipient`, issues);
  const retention = parseLocalized(value.retention, `${path}.retention`, issues);
  if (value._type !== "object" || collected === undefined || purpose === undefined || recipient === undefined || retention === undefined) return undefined;
  return { _type: "object", collected, purpose, recipient, retention };
}

function parseSocialLinks(value: unknown, path: string, issues: string[]): SiteSettingsWriteDocument["socialLinks"] | undefined {
  if (!Array.isArray(value)) { issues.push(`${path} must be an array`); return undefined; }
  const parsed: SiteSettingsWriteDocument["socialLinks"][number][] = [];
  const platforms = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) { issues.push(`${entryPath} is not an object`); continue; }
    unknownFields(entry, new Set(["_key", "_type", "platform", "url", "label"]), entryPath, issues);
    if (!isNonBlank(entry._key)) issues.push(`${entryPath}._key must be non-empty`);
    if (entry._type !== "object") issues.push(`${entryPath}._type must be "object"`);
    if (typeof entry.platform !== "string" || !ID_PATTERN.test(entry.platform)) issues.push(`${entryPath}.platform is invalid`);
    if (typeof entry.url !== "string" || !isHttpsUrl(entry.url)) issues.push(`${entryPath}.url must be an HTTPS URL without credentials or a fragment`);
    const label = parseLocalized(entry.label, `${entryPath}.label`, issues);
    if (typeof entry.platform === "string" && platforms.has(entry.platform)) issues.push(`${path} repeats platform "${entry.platform}"`);
    if (typeof entry.platform === "string") platforms.add(entry.platform);
    if (typeof entry._key === "string" && entry._type === "object" && typeof entry.platform === "string" && typeof entry.url === "string" && label !== undefined) parsed.push({ _key: entry._key, _type: "object", platform: entry.platform, url: entry.url, label });
  }
  return parsed.length === value.length ? parsed : undefined;
}

function isHttpsUrl(value: string): boolean {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash; } catch { return false; }
}

function parseDefaultSeo(value: unknown, path: string, issues: string[]): SiteSettingsWriteDocument["defaultSeo"] | undefined {
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, new Set(["_type", "titleTemplate", "description"]), path, issues);
  if (value._type !== "object") issues.push(`${path}._type must be "object"`);
  const titleTemplate = parseLocalized(value.titleTemplate, `${path}.titleTemplate`, issues);
  const description = parseLocalized(value.description, `${path}.description`, issues);
  for (const entry of titleTemplate ?? []) if ((entry.value.match(/%s/g) ?? []).length !== 1) issues.push(`${path}.titleTemplate.${entry.language} must contain exactly one %s`);
  if (value._type !== "object" || titleTemplate === undefined || description === undefined) return undefined;
  return { _type: "object", titleTemplate, description };
}

function parseHomePage(value: unknown, path: string, issues: string[]): HomePageWriteDocument | undefined {
  if (!isRecord(value)) { issues.push(`${path} is not an object`); return undefined; }
  unknownFields(value, HOME_FIELDS, path, issues);
  if (!isNonBlank(value._id) || !DOCUMENT_ID_PATTERN.test(value._id) || !value._id.startsWith("migrated--home-page-")) issues.push(`${path}._id must be a migrated home page identifier`);
  if (value._type !== "homePage") issues.push(`${path}._type must be "homePage"`);
  let heroMedia: HomePageWriteDocument["heroMedia"] | undefined;
  if (!isRecord(value.heroMedia) || value.heroMedia._type !== "reference" || !isNonBlank(value.heroMedia._ref) || Object.keys(value.heroMedia).some((key) => key !== "_type" && key !== "_ref")) issues.push(`${path}.heroMedia must be a plain media reference`);
  else heroMedia = { _type: "reference", _ref: value.heroMedia._ref };
  const heroAction = value.heroAction === undefined ? undefined : parseLink(value.heroAction, `${path}.heroAction`, "homeAction", issues);
  const intro = parseLocalized(value.intro, `${path}.intro`, issues);
  if (!Array.isArray(value.sections) || value.sections.length === 0) issues.push(`${path}.sections must be a non-empty array`);
  const sections = Array.isArray(value.sections) ? value.sections.map((section, index) => parseSection(section, `${path}.sections[${index}]`, issues)) : [];
  if (typeof value._id !== "string" || value._type !== "homePage" || heroMedia === undefined || intro === undefined || !Array.isArray(value.sections) || value.sections.length === 0 || !sections.every((section): section is HomeSection => section !== undefined) || (value.heroAction !== undefined && heroAction === undefined)) return undefined;
  return { _id: value._id, _type: "homePage", heroMedia, ...(heroAction === undefined ? {} : { heroAction }), intro, sections };
}

function normalized(document: FoundationDocument): FoundationDocument {
  // Validation has already removed every unknown and optional null field. The
  // returned values are JSON-only, so this also creates a stable digest input.
  return document;
}

export function foundationDocumentsDigest(documents: readonly FoundationDocument[]): string {
  return createHash("sha256").update(JSON.stringify([...documents].sort((a, b) => a._id.localeCompare(b._id)).map(normalized)), "utf8").digest("hex");
}

export function validateFoundationWritePlan(raw: unknown): { readonly plan?: FoundationWritePlan; readonly issues: readonly string[] } {
  if (!isRecord(raw)) return { issues: ["the plan is not a JSON object"] };
  const issues: string[] = [];
  if (raw.version !== FOUNDATION_WRITE_PLAN_VERSION) issues.push(`plan.version must be "${FOUNDATION_WRITE_PLAN_VERSION}"`);
  if (!Array.isArray(raw.documents)) return { issues: [...issues, "plan.documents is not an array"] };
  const documents = raw.documents.map((document, index) => {
    if (isRecord(document) && document._type === "siteSettings") return parseSiteSettings(document, `documents[${index}]`, issues);
    if (isRecord(document) && document._type === "homePage") return parseHomePage(document, `documents[${index}]`, issues);
    issues.push(`documents[${index}] must be a siteSettings or homePage document`);
    return undefined;
  });
  const site = documents.filter((document): document is SiteSettingsWriteDocument => document?._type === "siteSettings");
  const home = documents.filter((document): document is HomePageWriteDocument => document?._type === "homePage");
  if (site.length !== 1 || home.length !== 1 || documents.length !== 2) issues.push("plan must contain exactly one siteSettings and one homePage document");
  const ids = new Set<string>();
  for (const document of documents) if (document !== undefined) {
    if (ids.has(document._id)) issues.push(`document _id "${document._id}" is present more than once`);
    ids.add(document._id);
  }
  if (issues.length > 0 || site.length !== 1 || home.length !== 1 || documents.length !== 2) return { issues: [...new Set(issues)].sort() };
  return { plan: { version: FOUNDATION_WRITE_PLAN_VERSION, documents: [site[0], home[0]] }, issues: [] };
}

function projectExistingDocument(row: ExistingDocument): FoundationDocument | undefined {
  const issues: string[] = [];
  if (row._type === "siteSettings") return parseSiteSettings(row, "existing", issues);
  if (row._type === "homePage") return parseHomePage(row, "existing", issues);
  return undefined;
}

/** Reject any other singleton, draft, or owner edit; an exact rerun is safe. */
export function foundationDatasetIssues(existing: readonly ExistingDocument[], planned: readonly FoundationDocument[]): readonly string[] {
  const issues: string[] = [];
  const plannedById = new Map(planned.map((document) => [document._id, document]));
  for (const row of existing) {
    if (typeof row._id !== "string") continue;
    const plannedDocument = plannedById.get(publishedIdOf(row._id));
    if (plannedDocument !== undefined) {
      if (row._id.startsWith("drafts.")) issues.push(`planned document "${plannedDocument._id}" has an unpublished draft`);
      else {
        const projected = projectExistingDocument(row);
        if (projected === undefined || foundationDocumentsDigest([projected]) !== foundationDocumentsDigest([plannedDocument])) issues.push(`planned document "${plannedDocument._id}" already exists with different content`);
      }
    } else if (row._type === "siteSettings" || row._type === "homePage") {
      issues.push(`another ${row._type} singleton already exists: "${publishedIdOf(row._id)}"`);
    }
  }
  return [...new Set(issues)].sort();
}

async function preflight(connection: SeedConnection, documents: readonly FoundationDocument[]): Promise<readonly string[]> {
  const site = documents.find((document): document is SiteSettingsWriteDocument => document._type === "siteSettings")!;
  const home = documents.find((document): document is HomePageWriteDocument => document._type === "homePage")!;
  const existing = await runSeedQuery(connection, { perspective: "raw", query: `*[_type in ["siteSettings", "homePage"]]{${FOUNDATION_DOCUMENT_PROJECTION}}` });
  if (!Array.isArray(existing)) return ["Sanity singleton preflight returned a malformed result"];
  const issues = [...foundationDatasetIssues(existing.map(normalizeFoundationReadback) as readonly ExistingDocument[], documents)];
  const refs = await runSeedQuery(connection, { query: `*[_id == $heroMedia || (_type == "gallery" && contentId == $featuredGalleryId)]{_id, _type, contentId}`, params: { heroMedia: home.heroMedia._ref, featuredGalleryId: site.featuredGalleryId ?? "" } });
  if (!Array.isArray(refs)) return [...issues, "Sanity foundation reference preflight returned a malformed result"];
  if (!refs.some((row) => isRecord(row) && row._id === home.heroMedia._ref && row._type === "media")) issues.push(`hero media "${home.heroMedia._ref}" does not exist as a published media document`);
  if (site.featuredGalleryId !== undefined && !refs.some((row) => isRecord(row) && row._type === "gallery" && row.contentId === site.featuredGalleryId)) issues.push(`featured gallery "${site.featuredGalleryId}" does not exist as a published gallery`);
  return [...new Set(issues)].sort();
}

async function verifyWritten(connection: SeedConnection, documents: readonly FoundationDocument[]): Promise<boolean> {
  const result = await runSeedQuery(connection, { query: `*[_id in $ids]{${FOUNDATION_DOCUMENT_PROJECTION}}`, params: { ids: documents.map((document) => document._id) } });
  if (!Array.isArray(result)) return false;
  const validated = validateFoundationWritePlan({ version: FOUNDATION_WRITE_PLAN_VERSION, documents: result.map(normalizeFoundationReadback) });
  return validated.plan !== undefined && foundationDocumentsDigest(validated.plan.documents) === foundationDocumentsDigest(documents);
}

type Options = { readonly plan: string; readonly approvedDigest?: string; readonly apply: boolean; readonly project?: string; readonly dataset?: string; readonly apiVersion?: string };

export function parseArguments(argv: readonly string[]): Options {
  const known = new Set(["plan", "approved-digest", "project", "dataset", "api-version"]);
  const values = new Map<string, string>(); let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--yes") { apply = true; continue; }
    if (!argument.startsWith("--") || !known.has(argument.slice(2))) throw new Error(`unknown argument "${argument}"`);
    const value = argv[index + 1]; if (value === undefined || value.startsWith("--")) throw new Error(`${argument} needs a value`);
    values.set(argument.slice(2), value); index += 1;
  }
  const plan = values.get("plan"); if (plan === undefined) throw new Error("--plan <foundation-write-plan.json> is required");
  return { plan, apply, ...(values.get("approved-digest") === undefined ? {} : { approvedDigest: values.get("approved-digest") }), ...(values.get("project") === undefined ? {} : { project: values.get("project") }), ...(values.get("dataset") === undefined ? {} : { dataset: values.get("dataset") }), ...(values.get("api-version") === undefined ? {} : { apiVersion: values.get("api-version") }) };
}

function required(value: string | undefined, message: string): string { if (value === undefined || value.trim().length === 0) throw new Error(message); return value; }
function migrationToken(): string { if (process.env.NEXT_PUBLIC_SANITY_MIGRATION_TOKEN?.trim()) throw new Error("NEXT_PUBLIC_SANITY_MIGRATION_TOKEN must be removed; a write credential must never be public"); return required(process.env.SANITY_MIGRATION_TOKEN, "SANITY_MIGRATION_TOKEN is required for --yes"); }

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const validated = validateFoundationWritePlan(JSON.parse(await readFile(options.plan, "utf8")) as unknown);
  if (validated.plan === undefined) throw new Error(`foundation plan failed ${validated.issues.length} check(s): ${validated.issues.join("; ")}`);
  const digest = foundationDocumentsDigest(validated.plan.documents);
  console.log(`Foundation plan valid: ${validated.plan.documents.length} singleton document(s).`);
  console.log(`Approved digest: ${digest}`);
  if (!options.apply) { console.log("Dry run only — no network request was made."); return; }
  if (options.approvedDigest === undefined || !DIGEST_PATTERN.test(options.approvedDigest)) throw new Error("--approved-digest <sha256> is required with --yes");
  if (options.approvedDigest !== digest) throw new Error("the foundation plan differs from the reviewed dry run; refusing to write");
  const connection = parseSeedConnection({ projectId: required(options.project ?? process.env.SANITY_PROJECT_ID, "SANITY_PROJECT_ID is required for --yes (or pass --project)"), dataset: required(options.dataset ?? process.env.SANITY_DATASET, "SANITY_DATASET is required for --yes (or pass --dataset)"), apiVersion: required(options.apiVersion ?? process.env.SANITY_API_VERSION, "SANITY_API_VERSION is required for --yes (or pass --api-version)"), token: migrationToken() });
  const issues = await preflight(connection, validated.plan.documents);
  if (issues.length > 0) throw new Error(`target dataset failed ${issues.length} foundation preflight check(s): ${issues.join("; ")}`);
  const result = await runSeedMutationBatches(connection, validated.plan.documents.map((document) => ({ createIfNotExists: document })));
  console.log(`Wrote ${validated.plan.documents.length} foundation document(s) in ${result.batchesRun} batch(es).`);
  if (!(await verifyWritten(connection, validated.plan.documents))) throw new Error("post-write verification did not read back the approved foundation documents");
  console.log(`Verification PASS: ${validated.plan.documents.length}/${validated.plan.documents.length} document(s).`);
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) main().catch((cause) => { console.error(`Foundation write failed: ${cause instanceof Error ? cause.message : String(cause)}`); process.exitCode = 1; });

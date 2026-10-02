/** Owner-run AB#125 action. Reads raw drafts, plans a linked target, and writes only after --yes. */
import { planLocalizedDraft, selectCurrentPlacementVersions } from "./localized-draft-plan.mts";
import { parseSeedConnection, runSeedMutationBatches, runSeedQuery } from "./sanity-seed-http.mts";

function option(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? undefined : process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function publishedId(id: string): string {
  return id.startsWith("drafts.") ? id.slice(7) : id;
}
function references(document: Record<string, unknown>, field: string): string[] {
  const value = document[field];
  if (isRecord(value) && typeof value._ref === "string") return [publishedId(value._ref)];
  if (Array.isArray(value)) return value.flatMap((entry) => isRecord(entry) && typeof entry._ref === "string" ? [publishedId(entry._ref)] : []);
  return [];
}
function mediaReferences(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { value.forEach((item) => mediaReferences(item, result)); return result; }
  if (!isRecord(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    if (["media", "cover", "first", "second"].includes(key) && isRecord(child) && typeof child._ref === "string") {
      result.add(publishedId(child._ref));
    } else mediaReferences(child, result);
  }
  return result;
}
function languagesFromRoutes(value: string | undefined): string[] {
  if (!value) throw new Error("SITE_LOCALE_ROUTES is required; the action cannot guess configured languages");
  const locales = value.split(",").map((route) => route.trim().split("|")[0]);
  if (locales.some((locale) => !/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(locale))) {
    throw new Error("SITE_LOCALE_ROUTES contains an invalid locale");
  }
  return [...new Set(locales.map((locale) => locale.split("-")[0]))];
}
async function main(): Promise<void> {
  if (process.argv.some((arg) => arg.startsWith("--") && !["--content-id", "--from", "--to", "--yes"].includes(arg))) {
    throw new Error("Allowed flags: --content-id, --from, --to, --yes");
  }
  const contentId = option("content-id");
  const from = option("from");
  const to = option("to");
  const yes = process.argv.includes("--yes");
  const languages = languagesFromRoutes(process.env.SITE_LOCALE_ROUTES);
  if (!languages.includes(from) || !languages.includes(to) || from === to) throw new Error("Source and target must be different configured languages");
  if (process.env.NEXT_PUBLIC_SANITY_LOCALIZATION_TOKEN?.trim()) throw new Error("Remove NEXT_PUBLIC_SANITY_LOCALIZATION_TOKEN; the write credential must be server-only");
  const connection = parseSeedConnection({
    projectId: process.env.SANITY_PROJECT_ID ?? "",
    dataset: process.env.SANITY_DATASET ?? "",
    apiVersion: process.env.SANITY_API_VERSION ?? "",
    token: process.env.SANITY_LOCALIZATION_TOKEN ?? "",
  });
  const versions = await runSeedQuery(connection, {
    query: '*[_type in ["article", "gallery"] && contentId == $contentId]',
    params: { contentId }, perspective: "raw",
  }) as Record<string, unknown>[];
  const candidates = versions.filter((version) => version.language === from && !String(version._id).startsWith("versions."));
  const drafts = candidates.filter((version) => String(version._id).startsWith("drafts."));
  const published = candidates.filter((version) => !String(version._id).startsWith("drafts."));
  if (drafts.length > 1 || published.length > 1 || (drafts.length === 0 && published.length === 0)) {
    throw new Error("Source language has no unambiguous saved article or gallery version");
  }
  const source = drafts[0] ?? published[0];
  const sourceId = publishedId(String(source._id));
  const placementType = source._type === "gallery" ? "galleryPlacement" : "articleEndGalleryPlacement";
  const referenceField = source._type === "gallery" ? "gallery" : "article";
  const placements = await runSeedQuery(connection, {
    query: `*[_type == $type && ${referenceField}._ref in $ids]`,
    params: { type: placementType, ids: [sourceId, `drafts.${sourceId}`] }, perspective: "raw",
  }) as Record<string, unknown>[];
  const selectedPlacements = selectCurrentPlacementVersions(placements);
  const categoryIds = [...new Set([...references(source, "canonicalCategory"), ...references(source, "secondaryCategories")])];
  const categories = categoryIds.length ? await runSeedQuery(connection, {
    query: '*[_type == "category" && _id in $ids]{_id, slug, label}',
    params: { ids: categoryIds }, perspective: "published",
  }) as Record<string, unknown>[] : [];
  const mediaIds = [...mediaReferences(source, mediaReferences(selectedPlacements))];
  const media = source._type === "gallery" && source.orderingRule === "capture-sequence"
    ? await runSeedQuery(connection, {
        query: '*[_type == "media" && (_id in $ids || captureSequence.galleryContentId == $contentId)]{_id, alt, caption}',
        params: { ids: mediaIds, contentId }, perspective: "published",
      }) as Record<string, unknown>[]
    : mediaIds.length ? await runSeedQuery(connection, {
        query: '*[_type == "media" && _id in $ids]{_id, alt, caption}',
        params: { ids: mediaIds }, perspective: "published",
      }) as Record<string, unknown>[] : [];
  const plan = planLocalizedDraft({ source, targetLanguage: to, configuredLanguages: languages, existingVersions: versions, placements: selectedPlacements, categories, media });
  const mutations = [plan.draft, ...plan.placementDrafts].map((document) => ({ create: document as Record<string, unknown> & { _id: string } }));
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ mutations })).length;
  if (bodyBytes > 3_500_000) throw new Error("The atomic draft transaction exceeds 3.5 MB; split this gallery authoring workflow before writing");
  console.log(`Source: ${source._type} ${contentId} (${from}); target: ${to}`);
  console.log(`Target draft: ${plan.draft._id}; placement drafts: ${plan.placementDrafts.length}; text fields to review: ${plan.reviewPaths.length}`);
  for (const path of plan.reviewPaths) console.log(`Review: ${path}`);
  for (const notice of plan.notices) console.log(`Notice: ${notice}`);
  if (!yes) { console.log("Dry run only. Re-run with --yes to create the target drafts."); return; }
  // Strict creates, all in one transaction: a second click at the same deterministic ID fails.
  await runSeedMutationBatches(connection, mutations, { batchSize: mutations.length });
  console.log(`Created ${mutations.length} draft documents. The source was not mutated.`);
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create:localized-draft failed: ${message}`);
  process.exitCode = 1;
});

/** Public Studio configuration; deliberately independent of server credentials. */
export type StudioEnvironment = Readonly<Record<string, string | undefined>>;
export type StudioSettings = {
  projectId: string;
  dataset: string;
  datasetVisibility: "public" | "private";
  title: string;
  storyRootPaths: string[];
};

function required(environment: StudioEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing Studio setting: ${name}`);
  return value;
}

/** Derive every story root from the same declared routing table the site uses. */
export function studioStoryRoots(value: string): string[] {
  const locales = new Set<string>();
  const prefixes = new Set<string>();
  const roots: string[] = [];
  let defaults = 0;
  const segment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const rows = value.split(",").map((row) => row.trim()).filter(Boolean);
  if (value.length > 4096 || rows.length > 32) {
    throw new Error("Invalid SANITY_STUDIO_LOCALE_ROUTES");
  }
  for (const row of rows) {
    const parts = row.split("|").map((field) => field.trim());
    if (![3, 4, 5].includes(parts.length)) throw new Error("Invalid SANITY_STUDIO_LOCALE_ROUTES");
    const [locale, prefix, namespace, services, search] = parts;
    if (
      !locale ||
      !segment.test(namespace ?? "") || (prefix !== "" && !segment.test(prefix ?? "")) ||
      (services !== undefined && (!segment.test(services) || services === namespace)) ||
      (search !== undefined && (!segment.test(search) || search === namespace || search === services))
    ) throw new Error("Invalid SANITY_STUDIO_LOCALE_ROUTES");
    let canonical: string;
    try {
      const parsed = new Intl.Locale(locale);
      if (!parsed.language) throw new Error();
      canonical = parsed.toString();
    } catch {
      throw new Error("Invalid SANITY_STUDIO_LOCALE_ROUTES locale");
    }
    if (locales.has(canonical) || prefixes.has(prefix)) {
      throw new Error("Duplicate SANITY_STUDIO_LOCALE_ROUTES locale or prefix");
    }
    locales.add(canonical);
    prefixes.add(prefix);
    if (prefix === "") defaults++;
    roots.push(prefix === "" ? `/${namespace}` : `/${prefix}/${namespace}`);
  }
  if (defaults !== 1 || new Set(roots).size !== roots.length) {
    throw new Error("SANITY_STUDIO_LOCALE_ROUTES needs exactly one unprefixed default");
  }
  return roots;
}

export function loadStudioSettings(environment: StudioEnvironment): StudioSettings {
  const projectId = required(environment, "SANITY_STUDIO_PROJECT_ID");
  const dataset = required(environment, "SANITY_STUDIO_DATASET");
  const datasetVisibility = required(environment, "SANITY_STUDIO_DATASET_VISIBILITY");
  const title = required(environment, "SANITY_STUDIO_TITLE");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectId)) {
    throw new Error("Invalid SANITY_STUDIO_PROJECT_ID");
  }
  if (!/^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(dataset)) {
    throw new Error("Invalid SANITY_STUDIO_DATASET");
  }
  if (datasetVisibility !== "public" && datasetVisibility !== "private") {
    throw new Error("Invalid SANITY_STUDIO_DATASET_VISIBILITY");
  }
  if (title.length > 120) throw new Error("SANITY_STUDIO_TITLE exceeds 120 characters");
  return {
    projectId, dataset, datasetVisibility, title,
    storyRootPaths: studioStoryRoots(required(environment, "SANITY_STUDIO_LOCALE_ROUTES")),
  };
}

import { argumentsOf, newPrivateDirectory, readPrivateBytes, writePrivateBytes } from "./private-operation-files.mts";
import { CENSUS_LIMITS, publicationLocaleCensus } from "./publication-locale-census.mts";
async function main() {
  const args = argumentsOf(process.argv.slice(2), ["snapshot", "languages", "out"]);
  const result = publicationLocaleCensus(await readPrivateBytes(args.snapshot, CENSUS_LIMITS.bytes), args.languages.split(","));
  const folder = await newPrivateDirectory(args.out);
  await writePrivateBytes(folder, "receipt.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ documentCount: result.documentCount, snapshotSha256: result.snapshotSha256, hasBlockers: result.hasBlockers,
    coverage: result.coverage.map(({ missing, ...c }) => ({ ...c, missing: missing.length })), publicationAuthorized: false, cmsMutated: false }));
  if (result.hasBlockers) process.exitCode = 1;
}
main().catch(() => { console.error("[audit-publication-locales] Invalid or unavailable private snapshot; audit refused."); process.exitCode = 1; });

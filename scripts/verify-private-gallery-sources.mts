/** Owner-run read-only preflight; this neither uploads nor locks later source bytes. */
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildPrivateGallerySourcePlan, PrivateSourcePlanError, refuse, type LocalAsset } from "./private-gallery-source-plan.mts";
import { noSymlinks, privatePath, ignoredArtifact, boundedRead, inspectAsset } from "./private-gallery-source-files.mts";
import { validateSavedPrivateSourcePlan, PRIVATE_SOURCE_MAX_PLAN_BYTES } from "./private-gallery-source-verification.mts";

type Options = { readonly plan: string; readonly sourceRoot: string; readonly expectedDigest: string };
export function parsePrivateSourceVerificationArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!["--plan", "--source-root", "--expected-digest"].includes(key) || values.has(key) || !value || value.startsWith("--")) refuse("INVALID_ARGUMENTS");
    values.set(key, value);
  }
  const expectedDigest = values.get("--expected-digest");
  if (values.size !== 3 || !expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) refuse("INVALID_ARGUMENTS");
  return { plan: path.resolve(values.get("--plan")!), sourceRoot: path.resolve(values.get("--source-root")!), expectedDigest };
}

export async function runPrivateSourceVerification(options: Options) {
  try {
    if (typeof options.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(options.expectedDigest)) refuse("INVALID_ARGUMENTS");
    await noSymlinks(options.plan);
    await privatePath(path.dirname(options.plan), true);
    await privatePath(options.plan, false);
    await ignoredArtifact(options.plan);
    const bytes = await boundedRead(options.plan, PRIVATE_SOURCE_MAX_PLAN_BYTES);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { refuse("INVALID_PLAN"); }
    const { plan, input } = validateSavedPrivateSourcePlan(value, options.expectedDigest);
    // No source path is touched until the complete selected report validates.
    await noSymlinks(options.sourceRoot);
    const root = await realpath(options.sourceRoot);
    if (!(await lstat(root)).isDirectory()) refuse("INVALID_PATH");
    const assets: LocalAsset[] = [];
    for (let index = 0; index < plan.localAssets.length; index++) {
      try {
        const actual = await inspectAsset(root, plan.localAssets[index].relativePath, index === input.images.length);
        if (actual.bytes !== plan.localAssets[index].bytes || actual.sha256 !== plan.localAssets[index].sha256) refuse("SOURCE_CHANGED");
        assets.push(actual);
      } catch (error) {
        throw new PrivateSourcePlanError(error instanceof PrivateSourcePlanError ? error.code : "LOCAL_IO_FAILED", index + 1);
      }
    }
    if (!isDeepStrictEqual(buildPrivateGallerySourcePlan(input, assets), plan)) refuse("SOURCE_CHANGED");
    return { status: "verified-offline", objects: plan.manifest.length, totalBytes: plan.totalBytes, digest: plan.digest,
      checks: { watermarks: plan.checks.watermarks, zip: plan.checks.zip,
        freshness: "verification-read-only-no-upload-lease", remote: "not-contacted" } };
  } catch (error) {
    if (error instanceof PrivateSourcePlanError) throw error;
    throw new PrivateSourcePlanError("LOCAL_IO_FAILED");
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPrivateSourceVerification(parsePrivateSourceVerificationArguments(process.argv.slice(2))))); }
  catch (error) {
    console.error(error instanceof PrivateSourcePlanError ? error.message : "[private-upload-source] LOCAL_IO_FAILED");
    process.exitCode = 1;
  }
}

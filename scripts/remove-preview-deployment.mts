#!/usr/bin/env node
/** Remove one verified immutable deployment, withholding unexpected provider diagnostics. */
import { fileURLToPath } from "node:url";
import { deletePreviewDeployment, deletePreviewDeploymentFromUrl, readVercelPreviewApiSettings } from "./vercel-preview-api.mts";

type Dependencies = {
  readSettings?: typeof readVercelPreviewApiSettings;
  deleteById?: typeof deletePreviewDeployment;
  deleteByUrl?: typeof deletePreviewDeploymentFromUrl;
};
export async function main(argv: readonly string[] = process.argv.slice(2), dependencies: Dependencies = {}): Promise<number> {
  const reference = argv[0];
  if (!reference) {
    console.error("Preview deployment cleanup failed: no deployment reference given. Usage: npm run remove:preview -- dpl_<immutable-id>|https://<deployment>.vercel.app");
    return 1;
  }
  try {
    const settings = (dependencies.readSettings ?? readVercelPreviewApiSettings)();
    const result = reference.trim().startsWith("dpl_")
      ? await (dependencies.deleteById ?? deletePreviewDeployment)(reference, settings)
      : await (dependencies.deleteByUrl ?? deletePreviewDeploymentFromUrl)(reference, settings);
    console.log(result.deleted ? `Removed unverified deployment ${result.id}.` : result.id ? `Deployment ${result.id} was already absent.` : "The unverified deployment URL was already absent.");
    return 0;
  } catch {
    console.error("Preview deployment cleanup failed: operation failed; details withheld");
    return 1;
  }
}
if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().then(code => { process.exitCode = code; }, () => {
    console.error("Preview deployment cleanup failed: operation failed; details withheld");
    process.exitCode = 1;
  });
}

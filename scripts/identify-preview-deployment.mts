#!/usr/bin/env node
/** Bind a deployment URL to the expected project/team; stdout is the verified ID only. */
import { fileURLToPath } from "node:url";
import { inspectPreviewDeployment, readVercelPreviewApiSettings } from "./vercel-preview-api.mts";

type Dependencies = {
  readSettings?: typeof readVercelPreviewApiSettings;
  inspect?: typeof inspectPreviewDeployment;
};
export async function main(argv: readonly string[] = process.argv.slice(2), dependencies: Dependencies = {}): Promise<number> {
  const url = argv[0];
  if (!url) {
    console.error("Preview deployment identification failed: no deployment URL given. Usage: npm run identify:preview -- https://<deployment>.vercel.app");
    return 1;
  }
  try {
    const settings = (dependencies.readSettings ?? readVercelPreviewApiSettings)();
    const identified = await (dependencies.inspect ?? inspectPreviewDeployment)(url, settings);
    process.stdout.write(identified.deployment.id);
    return 0;
  } catch {
    console.error("Preview deployment identification failed: operation failed; details withheld");
    return 1;
  }
}
if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().then(code => { process.exitCode = code; }, () => {
    console.error("Preview deployment identification failed: operation failed; details withheld");
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
/** Resolves and removes one verified Preview deployment during pipeline cleanup. */
import {
  deletePreviewDeployment,
  deletePreviewDeploymentFromUrl,
  readVercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

function fail(message: string): never {
  console.error(`Preview deployment cleanup failed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const deploymentReference = process.argv[2];
  if (!deploymentReference) {
    fail(
      "no deployment reference given. Usage: npm run remove:preview -- dpl_<immutable-id>|https://<deployment>.vercel.app",
    );
  }

  try {
    const settings = readVercelPreviewApiSettings();
    const result = deploymentReference.trim().startsWith("dpl_")
      ? await deletePreviewDeployment(deploymentReference, settings)
      : await deletePreviewDeploymentFromUrl(deploymentReference, settings);
    console.log(
      result.deleted
        ? `Removed unverified deployment ${result.id}.`
        : result.id
          ? `Deployment ${result.id} was already absent.`
          : "The unverified deployment URL was already absent.",
    );
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}

await main();

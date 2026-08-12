#!/usr/bin/env node
/**
 * Resolves a Vercel CLI deployment URL to its immutable deployment ID after
 * binding it to the expected customer-owned project and team.
 *
 * Stdout contains the ID only so a pipeline command substitution can capture
 * it without parsing human-readable output. Failures go to stderr.
 */
import {
  inspectPreviewDeployment,
  readVercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

function fail(message: string): never {
  console.error(`Preview deployment identification failed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    fail(
      "no deployment URL given. Usage: npm run identify:preview -- https://<deployment>.vercel.app",
    );
  }

  try {
    const settings = readVercelPreviewApiSettings();
    const identified = await inspectPreviewDeployment(url, settings);
    process.stdout.write(identified.deployment.id);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}

await main();

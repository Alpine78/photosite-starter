#!/usr/bin/env node
/**
 * Proves a Preview deployment is access-protected and non-indexable, before
 * anyone is told the URL exists.
 *
 *     npm run verify:preview -- https://<deployment>.vercel.app dpl_<id>
 *
 * Reads the automation bypass secret from `VERCEL_AUTOMATION_BYPASS_SECRET`
 * and from nowhere else. Not from an argument: a command line is visible to
 * every process on the machine and is echoed verbatim into pipeline logs. Not
 * appended to the URL either — the provider accepts the bypass as a query
 * parameter, and that is exactly the shape ADR-0004 §3 forbids, because a URL
 * carrying a secret survives in build logs, referrers, and request telemetry
 * long after the deployment is gone.
 *
 * Before either request, the script resolves the URL through Vercel's
 * authenticated deployment API and proves that its immutable ID, project ID,
 * team owner ID, and hostname match the expected pipeline settings. Only then
 * can the bypass secret leave this process. Two deployment requests follow,
 * because the two properties are independent: one without the bypass header,
 * which must be refused, and one with it, whose response must carry `noindex`.
 * The second is the response a reviewer actually sees.
 *
 * All decisions live in `preview-verification.mts`, which has tests. This file
 * wires settings, identity and the injectable header-only probe together,
 * prints fixed diagnostics, and sets the exit code.
 *
 * Runs on the Node major pinned in `package.json` (`engines.node`), which
 * executes TypeScript directly.
 */
import { fileURLToPath } from "node:url";
import { describePreviewFailure, probePreviewDeployment as probe } from "./preview-probe.mts";
import { verifyPreviewDeployment } from "./preview-verification.mts";
import {
  inspectPreviewDeployment,
  readVercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

/** The provider's documented header for Protection Bypass for Automation. */
const BYPASS_HEADER = "x-vercel-protection-bypass";

const BYPASS_SECRET_SETTING = "VERCEL_AUTOMATION_BYPASS_SECRET";

type ProbeResponse = Awaited<ReturnType<typeof probe>>;

function fail(message: string): never {
  console.error(`Preview verification failed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const urlArgument = process.argv[2];
  const deploymentIdArgument = process.argv[3];
  if (!urlArgument || !deploymentIdArgument) {
    fail(
      "deployment URL and immutable ID are required. Usage: npm run verify:preview -- https://<deployment>.vercel.app dpl_<id>",
    );
  }

  const bypassSecret = process.env[BYPASS_SECRET_SETTING]?.trim();
  if (!bypassSecret) {
    fail(
      `${BYPASS_SECRET_SETTING} is not set. Generate Protection Bypass for Automation on the Vercel project and pass it to this step as a secret.`,
    );
  }

  let identified: Awaited<ReturnType<typeof inspectPreviewDeployment>>;
  try {
    const settings = readVercelPreviewApiSettings();
    identified = await inspectPreviewDeployment(
      urlArgument,
      settings,
      deploymentIdArgument,
    );
  } catch (cause) {
    fail(
      `the deployment identity could not be verified before sending the bypass secret: ${describePreviewFailure(cause)}`,
    );
  }

  let probes: { protection: ProbeResponse; bypassed: ProbeResponse };
  try {
    probes = {
      protection: await probe(identified.url, {}),
      bypassed: await probe(identified.url, {
        [BYPASS_HEADER]: bypassSecret,
      }),
    };
  } catch (cause) {
    // Native header errors can echo the secret. Unknown causes are withheld.
    fail(
      `the deployment could not be reached: ${describePreviewFailure(cause)}`,
    );
  }

  const verification = verifyPreviewDeployment({
    protectionStatus: probes.protection.status,
    protectionLocation: probes.protection.location,
    bypassStatus: probes.bypassed.status,
    robotsTag: probes.bypassed.robotsTag,
  });

  console.log(`Preview deployment: ${identified.url.href}`);
  console.log(`  ok  identity: ${identified.deployment.id}`);
  for (const check of verification.checks) {
    console.log(`  ${check.ok ? "ok" : "FAILED"}  ${check.name}: ${check.detail}`);
  }

  if (!verification.ok) {
    fail("the deployment is not safe to publish. See the checks above.");
  }

  console.log(
    "Access protection and noindex both verified; the URL is safe to publish.",
  );
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch(() => fail("operation failed; details withheld"));
}

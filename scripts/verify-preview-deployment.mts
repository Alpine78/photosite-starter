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
 * is the part that cannot be tested without a network: read settings, make two
 * requests, print, set an exit code.
 *
 * Runs on the Node major pinned in `package.json` (`engines.node`), which
 * executes TypeScript directly.
 */
import { verifyPreviewDeployment } from "./preview-verification.mts";
import {
  inspectPreviewDeployment,
  readVercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

/** The provider's documented header for Protection Bypass for Automation. */
const BYPASS_HEADER = "x-vercel-protection-bypass";

const BYPASS_SECRET_SETTING = "VERCEL_AUTOMATION_BYPASS_SECRET";

/**
 * Bounds a hung pipeline step. Generous enough for a cold deployment's first
 * request, short enough that a wedged step fails rather than burning the job's
 * whole budget.
 */
const REQUEST_TIMEOUT_MS = 20_000;

type ProbeResponse = {
  readonly status: number;
  readonly location: string | null;
  readonly robotsTag: string | null;
};

async function probe(
  url: URL,
  headers: Record<string, string>,
): Promise<ProbeResponse> {
  const response = await fetch(url, {
    headers,
    // A redirect is an answer in itself here: following one would hide a
    // protection layer bouncing the request somewhere else, and report
    // whatever sat at the end of the chain instead.
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // The body is never read. It is either a provider challenge page or the
  // site's own HTML, and neither belongs in a retained pipeline log. The
  // `Location` header on an unauthenticated redirect is retained, though: it
  // is what `classifyProtection` binds to the provider's own SSO host and
  // path, and it names no secret or application content.
  return {
    status: response.status,
    location: response.headers.get("location"),
    robotsTag: response.headers.get("x-robots-tag"),
  };
}

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
      `the deployment identity could not be verified before sending the bypass secret: ${cause instanceof Error ? cause.message : String(cause)}`,
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
    // The message is the platform's own (a DNS failure, a timeout). It carries
    // the host, never the header that was sent with the request.
    fail(
      `the deployment could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
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

await main();

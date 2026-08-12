#!/usr/bin/env node
/**
 * Proves a Preview deployment is access-protected and non-indexable, before
 * anyone is told the URL exists.
 *
 *     npm run verify:preview -- https://<deployment>.vercel.app
 *
 * Reads the automation bypass secret from `VERCEL_AUTOMATION_BYPASS_SECRET`
 * and from nowhere else. Not from an argument: a command line is visible to
 * every process on the machine and is echoed verbatim into pipeline logs. Not
 * appended to the URL either — the provider accepts the bypass as a query
 * parameter, and that is exactly the shape ADR-0004 §3 forbids, because a URL
 * carrying a secret survives in build logs, referrers, and request telemetry
 * long after the deployment is gone.
 *
 * Two requests, because the two properties are independent: one without the
 * bypass header, which must be refused, and one with it, whose response must
 * carry `noindex`. The second is the response a reviewer actually sees.
 *
 * All decisions live in `preview-verification.mts`, which has tests. This file
 * is the part that cannot be tested without a network: read settings, make two
 * requests, print, set an exit code.
 *
 * Runs on the Node major pinned in `package.json` (`engines.node`), which
 * executes TypeScript directly.
 */
import { readFileSync } from "node:fs";

import {
  parseDeploymentUrl,
  verifyPreviewDeployment,
} from "./preview-verification.mts";

/** The provider's documented header for Protection Bypass for Automation. */
const BYPASS_HEADER = "x-vercel-protection-bypass";

const BYPASS_SECRET_SETTING = "VERCEL_AUTOMATION_BYPASS_SECRET";

/**
 * Optional override for the project whose deployments this run may talk to.
 * Normally unset: the linked project on disk already names it.
 */
const PROJECT_NAME_SETTING = "VERCEL_PROJECT_NAME";

/** Written by `vercel pull` in the pipeline and by `vercel link` locally. */
const LINKED_PROJECT_FILE = new URL("../.vercel/project.json", import.meta.url);

/**
 * Bounds a hung pipeline step. Generous enough for a cold deployment's first
 * request, short enough that a wedged step fails rather than burning the job's
 * whole budget.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Which project's deployment the bypass secret may be sent to.
 *
 * Read from the linked project on disk rather than taken as an argument: the
 * point of the check is to catch a wrong URL, and a caller who can pass the
 * wrong URL can pass a matching wrong project name just as easily. There is no
 * default and no guess — without a name the URL cannot be bound to anything,
 * and the run fails before a single request is made.
 */
function readExpectedProject(): string {
  const configured = process.env[PROJECT_NAME_SETTING]?.trim();
  if (configured) return configured;

  let linked: unknown;
  try {
    linked = JSON.parse(readFileSync(LINKED_PROJECT_FILE, "utf8"));
  } catch {
    fail(
      `no linked Vercel project found and ${PROJECT_NAME_SETTING} is not set, so the deployment URL cannot be bound to a project. Run "vercel pull" first, or set ${PROJECT_NAME_SETTING}.`,
    );
  }

  const name =
    typeof linked === "object" && linked !== null && "projectName" in linked
      ? (linked as { projectName?: unknown }).projectName
      : undefined;

  if (typeof name !== "string" || !name.trim()) {
    fail(
      `the linked Vercel project names no project, so the deployment URL cannot be bound to one. Set ${PROJECT_NAME_SETTING} instead.`,
    );
  }

  return name.trim();
}

type ProbeResponse = {
  readonly status: number;
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
  // site's own HTML, and neither belongs in a retained pipeline log.
  return {
    status: response.status,
    robotsTag: response.headers.get("x-robots-tag"),
  };
}

function fail(message: string): never {
  console.error(`Preview verification failed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const urlArgument = process.argv[2];
  if (!urlArgument) {
    fail(
      "no deployment URL given. Usage: npm run verify:preview -- https://<deployment>.vercel.app",
    );
  }

  const bypassSecret = process.env[BYPASS_SECRET_SETTING]?.trim();
  if (!bypassSecret) {
    fail(
      `${BYPASS_SECRET_SETTING} is not set. Generate Protection Bypass for Automation on the Vercel project and pass it to this step as a secret.`,
    );
  }

  const expectedProject = readExpectedProject();

  let url: URL;
  try {
    url = parseDeploymentUrl(urlArgument, expectedProject);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }

  let probes: { protection: ProbeResponse; bypassed: ProbeResponse };
  try {
    probes = {
      protection: await probe(url, {}),
      bypassed: await probe(url, { [BYPASS_HEADER]: bypassSecret }),
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
    bypassStatus: probes.bypassed.status,
    robotsTag: probes.bypassed.robotsTag,
  });

  console.log(`Preview deployment: ${url.href}`);
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

#!/usr/bin/env node
/**
 * Runs AB#83's bounded broad-revalidation recovery against one deployment.
 *
 *   npm run revalidate:public-cache -- https://example.com/api/revalidate
 *
 * The signing secret is read only from SANITY_WEBHOOK_SECRET. It never appears
 * in an argument, URL, request body, or log. The signed body identifies the
 * expected project and dataset and asks the endpoint to expire the single
 * global public-content tag.
 *
 * Against a deployment sitting behind Vercel Authentication (every Preview
 * deployment today), the request also needs the same automation bypass this
 * project already uses in `verify-preview-deployment.mts`: an optional
 * `VERCEL_AUTOMATION_BYPASS_SECRET`, sent as `x-vercel-protection-bypass`.
 * Without it, a protected deployment answers with its SSO challenge redirect
 * before this script's own request ever reaches `route.ts`. Production is
 * expected to run on a real custom domain, which Vercel's SSO protection
 * exempts, so the variable stays optional rather than required.
 *
 * The bypass secret is a reusable, project-wide credential, so it is never
 * attached to an unverified host: whenever it is set, this script first
 * resolves the endpoint's origin through Vercel's authenticated deployment
 * API — the same `inspectPreviewDeployment` binding
 * `verify-preview-deployment.mts` already uses — and refuses to send the
 * header to anything that does not resolve to the expected project and team.
 * That lookup needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`,
 * required only on this path; a Production run with no bypass secret needs
 * none of them.
 */

import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";

import {
  inspectPreviewDeployment,
} from "./vercel-preview-api.mts";
import { classifyRecoveryResult, describeRecoveryFailure, readRecoveryPreviewSettings, readRecoveryResponse } from "./revalidation-recovery.mts";

const REQUEST_TIMEOUT_MS = 20_000;
const BYPASS_HEADER = "x-vercel-protection-bypass";
const BYPASS_SECRET_SETTING = "VERCEL_AUTOMATION_BYPASS_SECRET";

function fail(message: string): never {
  console.error(`Public-cache revalidation failed: ${message}`);
  process.exit(1);
}

function requiredSetting(name: string): string {
  const value = process.env[name];
  if (!value || value === "[SENSITIVE]") fail(`${name} is not set`);
  return value;
}

function readEndpoint(argument: string | undefined): URL {
  if (!argument) {
    return fail(
      "the endpoint URL is required. Usage: npm run revalidate:public-cache -- https://<deployment>/api/revalidate",
    );
  }

  let url: URL;
  try {
    url = new URL(argument);
  } catch {
    return fail("the endpoint must be an absolute HTTPS URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/api/revalidate" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return fail(
      "the endpoint must be exactly https://<deployment>/api/revalidate with no credentials, query, or fragment",
    );
  }
  return url;
}

async function main(): Promise<void> {
  const endpoint = readEndpoint(process.argv[2]);
  const secret = requiredSetting("SANITY_WEBHOOK_SECRET");
  if (secret.length < 32) fail("SANITY_WEBHOOK_SECRET must be at least 32 bytes");

  const body = JSON.stringify({
    schemaVersion: 1,
    projectId: requiredSetting("SANITY_PROJECT_ID"),
    dataset: requiredSetting("SANITY_DATASET"),
    operation: "reconcile",
  });
  const signature = await encodeSignatureHeader(body, Date.now(), secret);
  const bypassSecret = process.env[BYPASS_SECRET_SETTING]?.trim();

  if (bypassSecret) {
    try {
      const settings = readRecoveryPreviewSettings();
      await inspectPreviewDeployment(`${endpoint.origin}/`, settings);
    } catch (cause) {
      const detail = describeRecoveryFailure(cause);
      return fail(
        `refusing to send ${BYPASS_SECRET_SETTING} to an unverified host: ${detail}`,
      );
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        [SIGNATURE_HEADER_NAME]: signature,
        ...(bypassSecret ? { [BYPASS_HEADER]: bypassSecret } : {}),
      },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    return fail(
      `the deployment could not be reached: ${describeRecoveryFailure(cause)}`,
    );
  }

  let result: unknown;
  try {
    result = await readRecoveryResponse(response);
  } catch {
    const hint =
      response.status >= 300 && response.status < 400 && !bypassSecret
        ? ` (a redirect with no ${BYPASS_SECRET_SETTING} set usually means Vercel Authentication challenged the request before it reached the deployment)`
        : "";
    return fail(`the endpoint returned non-JSON with HTTP ${response.status}${hint}`);
  }

  const outcome = classifyRecoveryResult(response, result);
  if (outcome.kind === "http-failure") {
    return fail(`the endpoint returned a failure response with HTTP ${outcome.status}`);
  }

  if (outcome.kind === "unverified") {
    return fail(`the purge outcome could not be verified with HTTP ${outcome.status}`);
  }

  console.log(
    `Public Sanity cache expired at ${endpoint.origin} (reference ${outcome.correlationId}).`,
  );
}

await main().catch(() => fail("operation failed; details withheld"));

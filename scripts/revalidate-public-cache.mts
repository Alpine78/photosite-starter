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
 */

import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";

const REQUEST_TIMEOUT_MS = 20_000;

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

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        [SIGNATURE_HEADER_NAME]: signature,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    return fail(
      `the deployment could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return fail(`the endpoint returned non-JSON with HTTP ${response.status}`);
  }

  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !("status" in result) ||
    result.status !== "accepted" ||
    !("correlationId" in result) ||
    typeof result.correlationId !== "string"
  ) {
    return fail(`the endpoint refused the purge with HTTP ${response.status}`);
  }

  console.log(
    `Public Sanity cache expired at ${endpoint.origin} (reference ${result.correlationId}).`,
  );
}

await main();

/**
 * AB#421 test support, not a test file: spawns an owner-run writer with `fetch` replaced, so a
 * test can prove the target line comes before the first request without any network, secret or
 * real dataset. The first request writes a marker to both streams and exits with 86.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect } from "vitest";

export const SYNTHETIC_TOKEN = "synthetic-write-token-421";
export const SYNTHETIC_TARGET = { projectId: "fixture1", dataset: "production", apiVersion: "v2026-01-01" } as const;
export const SYNTHETIC_TARGET_LINE = "Sanity target: project fixture1, dataset production, API version v2026-01-01";
/** Spawned CLIs are slower than Vitest's 5 s default under the parallel suite. */
export const CLI_TIMEOUT = 60_000;

const NETWORK_GUARD =
  "data:text/javascript," +
  encodeURIComponent("globalThis.fetch = () => { process.stdout.write('NETWORK_REACHED\\n'); process.stderr.write('NETWORK_REACHED\\n'); process.exit(86); };");

export type CliResult = { status: number | null; stdout: string; stderr: string };

export function runWriterCli(script: string, args: readonly string[], environment: Record<string, string>): CliResult {
  const result = spawnSync(process.execPath, ["--import", NETWORK_GUARD, path.join(import.meta.dirname, script), ...args], {
    encoding: "utf8",
    timeout: CLI_TIMEOUT - 5_000,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      NODE_NO_WARNINGS: "1",
      SANITY_PROJECT_ID: SYNTHETIC_TARGET.projectId,
      SANITY_DATASET: SYNTHETIC_TARGET.dataset,
      SANITY_API_VERSION: SYNTHETIC_TARGET.apiVersion,
      ...environment,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The target line is on `stream` before the first request, and no token appears anywhere. */
export function expectTargetBeforeNetwork(result: CliResult, stream: "stdout" | "stderr"): void {
  const output = result[stream];
  expect(result.status).toBe(86);
  expect(output).toContain(SYNTHETIC_TARGET_LINE);
  expect(output).toContain("NETWORK_REACHED");
  expect(output.indexOf(SYNTHETIC_TARGET_LINE)).toBeLessThan(output.indexOf("NETWORK_REACHED"));
  expect(result.stdout + result.stderr).not.toContain(SYNTHETIC_TOKEN);
}

/** Refused before any request or target line, naming the public copy or its fixed code, never the token. */
export function expectRefusedBeforeNetwork(result: CliResult, variable: string): void {
  const output = result.stdout + result.stderr;
  expect(result.status).not.toBe(86);
  expect(result.status).not.toBe(0);
  expect(output).not.toContain("NETWORK_REACHED");
  expect(output).not.toContain(SYNTHETIC_TARGET_LINE);
  expect(output).toMatch(new RegExp(`NEXT_PUBLIC_${variable} is set|PUBLIC_TOKEN_REFUSED`));
  expect(output).not.toContain(SYNTHETIC_TOKEN);
}

/**
 * Runs a writer against an in-process fake Content Lake: queries answer `queryResults` in order,
 * then an empty list,
 * every image upload is accepted as a small WebP, and the `failAt`-th mutation request whose body
 * contains `failWhenBodyContains` answers HTTP 500. Nothing leaves the process.
 */
export function runWriterCliWithFakeSanity(
  script: string,
  args: readonly string[],
  environment: Record<string, string>,
  failure: {
    readonly failWhenBodyContains: string;
    readonly failAt: number;
    readonly queryResults?: readonly unknown[];
    /** Answers this upload (1-based, in request order) with HTTP 500 at once, and delays every accepted one. */
    readonly failUploadAt?: number;
    readonly acceptedUploadDelayMs?: number;
  },
): CliResult {
  const shim = `let uploads = 0, matching = 0;
const queryResults = ${JSON.stringify(failure.queryResults ?? [])};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const text = String(url);
  if (!text.startsWith("https://${SYNTHETIC_TARGET.projectId}.api.sanity.io/")) throw new Error("OFFLINE_ORIGIN_FORBIDDEN");
  if (text.includes("/data/query/")) return json({ result: queryResults.length > 0 ? queryResults.shift() : [] });
  if (text.includes("/assets/images/")) {
    uploads += 1;
    if (uploads === ${failure.failUploadAt ?? 0}) return json({ error: "synthetic" }, 500);
    const id = uploads;
    await new Promise((resolve) => setTimeout(resolve, ${failure.acceptedUploadDelayMs ?? 0}));
    return json({ document: { _id: "image-fixture" + id + "-10x10-webp", extension: "webp", mimeType: "image/webp", metadata: { dimensions: { width: 10, height: 10 } } } });
  }
  if (text.includes("/data/mutate/")) {
    if (String(init?.body ?? "").includes(${JSON.stringify(failure.failWhenBodyContains)})) {
      matching += 1;
      if (matching === ${failure.failAt}) return json({ error: "synthetic" }, 500);
    }
    return json({ transactionId: "synthetic", results: [] });
  }
  throw new Error("OFFLINE_PATH_FORBIDDEN");
};`;
  const loader = "data:text/javascript," + encodeURIComponent(shim);
  const result = spawnSync(process.execPath, ["--import", loader, path.join(import.meta.dirname, script), ...args], {
    encoding: "utf8",
    timeout: CLI_TIMEOUT - 5_000,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      NODE_NO_WARNINGS: "1",
      SANITY_PROJECT_ID: SYNTHETIC_TARGET.projectId,
      SANITY_DATASET: SYNTHETIC_TARGET.dataset,
      SANITY_API_VERSION: SYNTHETIC_TARGET.apiVersion,
      ...environment,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

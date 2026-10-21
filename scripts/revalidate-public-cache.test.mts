import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The CLI's refusals happen before any network request, so they are tested by
// running the real script with a controlled environment: no endpoint is ever
// contacted (every host here is under the reserved .invalid TLD).
const script = fileURLToPath(new URL("./revalidate-public-cache.mts", import.meta.url));
const SECRET = "webhook-secret-canary-0123456789abcdef";
const BYPASS = "bypass-secret-canary-0123456789";
const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SANITY_PROJECT_ID: "project1", SANITY_DATASET: "production" };

function run(args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 20_000 });
  const output = `${result.stdout}${result.stderr}`;
  // Neither secret may appear in any output, whatever the outcome.
  expect(output).not.toContain(SECRET);
  expect(output).not.toContain(BYPASS);
  return { status: result.status, output };
}

describe("revalidate-public-cache CLI refusals", () => {
  it("accepts only exactly https://<host>/api/revalidate", () => {
    for (const url of [
      "http://example.invalid/api/revalidate",
      "https://user:pass@example.invalid/api/revalidate",
      "https://example.invalid/api/revalidate?x=1",
      "https://example.invalid/api/revalidate#x",
      "https://example.invalid/api/other",
      "not a url",
    ]) {
      const { status, output } = run([url], { ...base, SANITY_WEBHOOK_SECRET: SECRET });
      expect(status, url).toBe(1);
      expect(output).toMatch(/endpoint must be/);
    }
    expect(run([], { ...base, SANITY_WEBHOOK_SECRET: SECRET }).output).toMatch(/endpoint URL is required/);
  });

  it("refuses a missing, placeholder or short signing secret", () => {
    const url = "https://example.invalid/api/revalidate";
    expect(run([url], base).output).toMatch(/SANITY_WEBHOOK_SECRET is not set/);
    expect(run([url], { ...base, SANITY_WEBHOOK_SECRET: "[SENSITIVE]" }).output).toMatch(/SANITY_WEBHOOK_SECRET is not set/);
    expect(run([url], { ...base, SANITY_WEBHOOK_SECRET: "short" }).output).toMatch(/at least 32 bytes/);
  });

  it("never sends the bypass secret to a host it could not bind to the project", () => {
    const { status, output } = run(["https://example.invalid/api/revalidate"], {
      ...base, SANITY_WEBHOOK_SECRET: SECRET, VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS,
    });
    expect(status).toBe(1);
    expect(output).toMatch(/refusing to send VERCEL_AUTOMATION_BYPASS_SECRET to an unverified host/);
  });
});

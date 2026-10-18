import { execFileSync, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, open, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAILURE_INPUT_LIMITS } from "./contact-failure-summary.mts";

const cli = fileURLToPath(new URL("./summarize-contact-failures.mts", import.meta.url));
const correlation = "CORRELATION_CANARY";
const genericError = "Invalid failure input. Usage: summarize:contact-failures -- <emitter.ndjson>\n";
const event = (state: string, errorClass?: string) => JSON.stringify({
  event: "contact.submission", correlationId: correlation, state,
  ...(errorClass ? { errorClass } : {}),
}) + "\n";
const complete = event("accepted") + event("delivered");

function run(input: string) {
  const result = spawnSync(process.execPath, [cli, input], {
    encoding: "utf8", timeout: 5000, maxBuffer: 65_536,
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  // A killed or timed-out child must never count as a successful refusal.
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stdout + result.stderr).not.toContain(correlation);
  expect(result.stdout + result.stderr).not.toContain("PATH_CANARY");
  expect(result.stdout + result.stderr).not.toContain("CONTENT_CANARY");
  return result;
}

function expectRefusal(input: string) {
  const result = run(input);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(genericError);
}

describe("actual offline failure-summary file inputs", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "failure-PATH_CANARY-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it.each([
    { input: complete, code: 0, status: "complete", delivered: 1, failures: 0 },
    { input: event("accepted") + event("delivery-failed", "timeout"), code: 1, status: "failures", delivered: 0, failures: 1 },
    { input: event("accepted"), code: 2, status: "incomplete", delivered: 0, failures: 0 },
  ])("preserves regular snapshot $status output and exit $code", async ({ input, code, status, delivered, failures }) => {
    const file = join(directory, "snapshot.ndjson");
    await writeFile(file, input);
    const result = run(file);
    expect(result.status).toBe(code);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1, status, invalidRecords: 0, correlations: 1,
      counts: { contact: { states: { accepted: 1, delivered }, failures } },
    });
  });

  it("refuses directories, absent files, oversized snapshots and malformed UTF-8 without exposing them", async () => {
    expectRefusal(directory);
    expectRefusal(join(directory, "missing.ndjson"));
    const file = join(directory, "snapshot.ndjson");
    await writeFile(file, "");
    await truncate(file, FAILURE_INPUT_LIMITS.bytes + 1);
    expectRefusal(file);
    await writeFile(file, Buffer.concat([Buffer.from(complete), Buffer.from([0xff])]));
    expectRefusal(file);
    // Schema-invalid regular text still uses the original redacted summary path.
    await writeFile(file, '{"event":"contact.submission","message":"CONTENT_CANARY"}\n');
    const invalid = run(file);
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toBe("");
    expect(JSON.parse(invalid.stdout).status).toBe("invalid");
  });

  it.skipIf(process.platform === "win32")("accepts a regular symlink target and refuses a symlink to a writerless FIFO", async () => {
    const file = join(directory, "snapshot.ndjson"), link = join(directory, "snapshot-link");
    await writeFile(file, complete);
    await symlink(file, link);
    expect(run(link).status).toBe(0);
    const fifo = join(directory, "fifo"), fifoLink = join(directory, "fifo-link");
    execFileSync("mkfifo", [fifo]);
    await symlink(fifo, fifoLink);
    expectRefusal(fifo);
    expectRefusal(fifoLink);
  }, 15_000);

  it.skipIf(process.platform === "win32")("refuses a FIFO even when a writer has supplied a valid complete snapshot", async () => {
    const fifo = join(directory, "fifo");
    execFileSync("mkfifo", [fifo]);
    const writer = await open(fifo, constants.O_RDWR | (constants.O_NONBLOCK ?? 0));
    try {
      await writer.writeFile(complete);
      expectRefusal(fifo);
    } finally { await writer.close(); }
  }, 10_000);

  it.skipIf(process.platform !== "linux")("refuses a character-device witness through the same generic path", () => {
    expectRefusal("/dev/zero");
  });
});

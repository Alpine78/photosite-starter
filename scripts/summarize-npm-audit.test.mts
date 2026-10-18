import { execFileSync, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { mkdtemp, open, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("./summarize-npm-audit.mts", import.meta.url));
const genericError = "Invalid audit report. Usage: summarize:audit -- <saved-audit.json>\n";
const report = (findings: boolean) => JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: findings ? {
    dep: { name: "dep", isDirect: true, severity: "high", via: [{
      source: 100, name: "dep", dependency: "dep", title: "CONTENT_CANARY", range: "<2",
      url: "https://github.com/advisories/GHSA-2345-6789-cfgh", severity: "high",
    }] },
  } : {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: findings ? 1 : 0, critical: 0, total: findings ? 1 : 0 } },
});

function run(input: string) {
  const result = spawnSync(process.execPath, [cli, input], {
    encoding: "utf8", timeout: 5000, maxBuffer: 65_536,
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
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

describe("actual saved-audit summary file inputs", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "audit-PATH_CANARY-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it.each([false, true])("preserves ordinary audit output and exit status, findings=%s", async findings => {
    const file = join(directory, "audit.json");
    await writeFile(file, report(findings));
    const result = run(file);
    expect(result.status).toBe(findings ? 1 : 0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1, status: findings ? "findings" : "clean", affectedEntries: findings ? 1 : 0,
      numericAdvisoryIds: findings ? [100] : [],
      githubAdvisoryIds: findings ? ["GHSA-2345-6789-cfgh"] : [],
    });
  });

  it("refuses invalid file, size, JSON, UTF-8 and schema inputs with a fixed error", async () => {
    expectRefusal(directory);
    expectRefusal(join(directory, "missing.json"));
    const file = join(directory, "audit.json");
    await writeFile(file, "");
    await truncate(file, 4 * 1024 * 1024 + 1);
    expectRefusal(file);
    await writeFile(file, '{"secret":"CONTENT_CANARY"');
    expectRefusal(file);
    const valid = report(true), offset = valid.indexOf("CONTENT_CANARY");
    // A nonfatal decoder would leave valid JSON and a valid advisory title.
    await writeFile(file, Buffer.concat([Buffer.from(valid.slice(0, offset)), Buffer.from([0xff]), Buffer.from(valid.slice(offset + "CONTENT_CANARY".length))]));
    expectRefusal(file);
    await writeFile(file, JSON.stringify({ auditReportVersion: 2, error: { message: "CONTENT_CANARY" } }));
    expectRefusal(file);
  });

  it.skipIf(process.platform === "win32")("keeps ordinary symlinks working and refuses writerless FIFO paths and symlinks", async () => {
    const file = join(directory, "audit.json"), link = join(directory, "audit-link");
    await writeFile(file, report(false));
    await symlink(file, link);
    expect(run(link).status).toBe(0);
    const fifo = join(directory, "fifo"), fifoLink = join(directory, "fifo-link");
    execFileSync("mkfifo", [fifo]);
    await symlink(fifo, fifoLink);
    expectRefusal(fifo);
    expectRefusal(fifoLink);
  }, 15_000);

  it.skipIf(process.platform === "win32")("refuses a FIFO containing a valid audit without consuming its input", async () => {
    const fifo = join(directory, "fifo");
    execFileSync("mkfifo", [fifo]);
    const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      try {
        const content = report(false);
        await writer.writeFile(content);
        expectRefusal(fifo);
        const remaining = Buffer.alloc(Buffer.byteLength(content));
        const read = await reader.read(remaining, 0, remaining.length, null);
        expect(remaining.subarray(0, read.bytesRead).toString("utf8")).toBe(content);
      } finally { await writer.close(); }
    } finally { await reader.close(); }
  }, 10_000);

  it.skipIf(process.platform !== "linux" || !existsSync("/dev/zero"))("refuses a character-device witness", () => {
    expectRefusal("/dev/zero");
  });
});

import { execFile, execFileSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { mkdtemp, open, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("./check-availability.mts", import.meta.url));
const genericError = "Invalid availability configuration. Usage: check:availability -- <config.json>\n";
const heading = "Harness availability";
async function run(input: string) {
  const result = await new Promise<{ status: number | null; signal: string | null; killed: boolean; systemError?: string; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, [cli, input], {
      encoding: "utf8", timeout: 5000, maxBuffer: 65_536,
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
    }, (error, stdout, stderr) => resolve({
      status: error === null ? 0 : typeof error.code === "number" ? error.code : null,
      signal: error?.signal ?? null, killed: error?.killed ?? false,
      systemError: typeof error?.code === "string" ? error.code : undefined,
      stdout, stderr,
    }));
  });
  expect(result.systemError).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.killed).toBe(false);
  expect(result.stdout + result.stderr).not.toContain("PATH_CANARY");
  expect(result.stdout + result.stderr).not.toContain("CONTENT_CANARY");
  return result;
}
async function expectRefusal(input: string) {
  const result = await run(input);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(genericError);
}

describe("actual availability configuration file inputs", () => {
  let directory: string, url: string, requests: number, responseStatus: number;
  let server: ReturnType<typeof createServer>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "availability-PATH_CANARY-"));
    requests = 0; responseStatus = 200;
    server = createServer((_request, response) => {
      requests++;
      response.writeHead(responseStatus, { "content-type": "text/html" });
      response.end(`<h1>${heading}</h1>`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing harness listener");
    url = `http://127.0.0.1:${address.port}/`;
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const config = () => JSON.stringify({ checks: [{ url, heading }], timeoutMs: 1000, maxBytes: 4096 });

  it.each([200, 503])("preserves ordinary configuration probes for HTTP %s", async status => {
    responseStatus = status;
    const file = join(directory, "config.json");
    await writeFile(file, config());
    const result = await run(file);
    expect(result.status).toBe(status === 200 ? 0 : 1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ schemaVersion: 1, results: [{
      index: 0, status: status === 200 ? "healthy" : "unhealthy", code: status === 200 ? "markers-present" : "not-200",
    }] });
    expect(requests).toBe(1);
  });

  it("refuses invalid file, size, UTF-8 and schema inputs before any probe", async () => {
    await expectRefusal(directory);
    await expectRefusal(join(directory, "missing.json"));
    const file = join(directory, "config.json");
    await writeFile(file, ""); await truncate(file, 65_537);
    await expectRefusal(file);
    const valid = config(), offset = valid.indexOf(heading);
    // Nonfatal decoding would still yield valid config and start a real probe.
    await writeFile(file, Buffer.concat([Buffer.from(valid.slice(0, offset)), Buffer.from([0xff]), Buffer.from(valid.slice(offset + heading.length))]));
    await expectRefusal(file);
    await writeFile(file, '{"secret":"CONTENT_CANARY"');
    await expectRefusal(file);
    await writeFile(file, JSON.stringify({ checks: [], private: "CONTENT_CANARY" }));
    await expectRefusal(file);
    expect(requests).toBe(0);
  });

  it.skipIf(process.platform === "win32")("accepts a regular symlink target but rejects writerless FIFO targets", async () => {
    const file = join(directory, "config.json"), link = join(directory, "config-link");
    await writeFile(file, config()); await symlink(file, link);
    expect((await run(link)).status).toBe(0);
    expect(requests).toBe(1); requests = 0;
    const fifo = join(directory, "fifo"), fifoLink = join(directory, "fifo-link");
    execFileSync("mkfifo", [fifo]); await symlink(fifo, fifoLink);
    await expectRefusal(fifo); await expectRefusal(fifoLink);
    expect(requests).toBe(0);
  }, 15_000);

  it.skipIf(process.platform === "win32")("rejects a FIFO containing a valid configuration without issuing a GET", async () => {
    const fifo = join(directory, "fifo"); execFileSync("mkfifo", [fifo]);
    const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      try {
        const content = config();
        await writer.writeFile(content);
        await expectRefusal(fifo);
        expect(requests).toBe(0);
        const remaining = Buffer.alloc(Buffer.byteLength(content));
        const read = await reader.read(remaining, 0, remaining.length, null);
        expect(remaining.subarray(0, read.bytesRead).toString("utf8")).toBe(content);
      } finally { await writer.close(); }
    } finally { await reader.close(); }
  }, 10_000);

  it.skipIf(process.platform !== "linux" || !existsSync("/dev/zero"))("refuses a character-device witness before probing", async () => {
    await expectRefusal("/dev/zero");
    expect(requests).toBe(0);
  });
});

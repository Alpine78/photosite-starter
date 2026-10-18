import { execFileSync, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { mkdtemp, open, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareDnsCutover } from "./dns-cutover-plan.mts";

const cli = fileURLToPath(new URL("./check-dns-cutover.mts", import.meta.url));
const genericError = "Invalid DNS input. Usage: check:dns-cutover -- <before.json> <after.json> <web-hosts.json>\n";
const web = { name: "@", type: "A", value: "192.0.2.1", ttl: 300 };
const mail = { name: "@", type: "MX", value: "DNS_CONTENT_CANARY.example.test.", ttl: 3600, priority: 10 };
const txt = { name: "selector._domainkey", type: "TXT", value: "DNS_TXT_CANARY", ttl: 3600 };
const before = { zone: "example.test", records: [web, mail, txt] };
const after = { zone: "example.test", records: [{ ...web, value: "192.0.2.2" }, mail, txt] };
const values = [before, after, ["@"]];
const contents = values.map(value => JSON.stringify(value));

function run(inputs: readonly string[]) {
  const result = spawnSync(process.execPath, [cli, ...inputs], {
    encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65_536,
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  for (const canary of ["PATH_CANARY", "DNS_CONTENT_CANARY", "DNS_TXT_CANARY", "192.0.2.1", "192.0.2.2"])
    expect(result.stdout + result.stderr).not.toContain(canary);
  return result;
}

function expectRefusal(inputs: readonly string[]) {
  const result = run(inputs);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(genericError);
}

const positions = [0, 1, 2];
describe("actual offline DNS comparison file inputs", () => {
  let directory: string;
  let files: string[];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "dns-PATH_CANARY-"));
    files = contents.map((_, index) => join(directory, `input-${index}.json`));
    await Promise.all(files.map((file, index) => writeFile(file, contents[index])));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it.each([false, true])("preserves redacted summary and exit codes, protected change=%s", async changed => {
    const candidate = changed ? { ...after, records: [after.records[0], { ...mail, priority: 20 }, txt] } : after;
    await writeFile(files[1], JSON.stringify(candidate));
    const result = run(files);
    expect(result.status).toBe(changed ? 1 : 0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(compareDnsCutover(before, candidate, ["@"]));
  });

  it("accepts exactly the byte cap, including trailing JSON whitespace", async () => {
    for (const [index, file] of files.entries())
      await writeFile(file, contents[index] + " ".repeat(4 * 1024 * 1024 - Buffer.byteLength(contents[index])));
    expect(run(files).status).toBe(0);
  });

  it.each(positions)("refuses invalid files/size/JSON/UTF8/schema at argument %s", async position => {
    const args = [...files];
    for (const invalid of [directory, join(directory, "missing.json")]) {
      args[position] = invalid;
      expectRefusal(args);
    }
    args[position] = files[position];
    await writeFile(files[position], "");
    await truncate(files[position], 4 * 1024 * 1024 + 1);
    expectRefusal(args);
    await writeFile(files[position], '{"secret":"DNS_CONTENT_CANARY"');
    expectRefusal(args);
    // Invalid byte inside an otherwise valid string, including the hosts array.
    const original = contents[position];
    const offset = position === 2 ? original.indexOf("@") : original.indexOf("DNS_TXT_CANARY");
    await writeFile(files[position], Buffer.concat([Buffer.from(original.slice(0, offset)), Buffer.from([0xff]), Buffer.from(original.slice(offset + 1))]));
    expectRefusal(args);
    await writeFile(files[position], JSON.stringify({ secret: "DNS_CONTENT_CANARY" }));
    expectRefusal(args);
  }, 15_000);

  it.skipIf(process.platform === "win32")("accepts regular symlink targets and rejects dangling/directory symlinks", async () => {
    const links = files.map((_, i) => join(directory, `link-${i}`));
    await Promise.all(links.map((link, i) => symlink(files[i], link)));
    expect(run(links).status).toBe(0);
    for (const target of [directory, join(directory, "missing")]) {
      const link = join(directory, `invalid-link-${target === directory ? "dir" : "missing"}`);
      await symlink(target, link);
      expectRefusal([files[0], files[1], link]);
    }
  });

  it.skipIf(process.platform === "win32").each(positions)("refuses writerless and linked FIFOs at argument %s", async position => {
    expect(run(files).status).toBe(0);
    const fifo = join(directory, "fifo"), link = join(directory, "fifo-link");
    execFileSync("mkfifo", [fifo], { timeout: 5000 });
    await symlink(fifo, link);
    for (const target of [fifo, link]) {
      const args = [...files]; args[position] = target;
      expectRefusal(args);
    }
  }, 20_000);

  it.skipIf(process.platform === "win32").each(positions)("refuses populated FIFO at argument %s without consuming input", async position => {
    expect(run(files).status).toBe(0);
    const fifo = join(directory, "fifo");
    execFileSync("mkfifo", [fifo], { timeout: 5000 });
    const reader = await open(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      try {
        await writer.writeFile(contents[position]);
        const args = [...files]; args[position] = fifo;
        expectRefusal(args);
        const remaining = Buffer.alloc(Buffer.byteLength(contents[position]));
        const read = await reader.read(remaining, 0, remaining.length, null);
        expect(remaining.subarray(0, read.bytesRead).toString("utf8")).toBe(contents[position]);
      } finally { await writer.close(); }
    } finally { await reader.close(); }
  }, 15_000);

  it.skipIf(process.platform !== "linux" || !existsSync("/dev/zero"))("refuses a device witness", () => {
    expectRefusal([files[0], files[1], "/dev/zero"]);
  });
});

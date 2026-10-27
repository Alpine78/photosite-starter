import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { parseRemoteZipArguments, remoteZipMain } from "./verify-delivery-zip-remote.mts";

const data = Buffer.from("synthetic complete object bytes");
const sha1 = createHash("sha1").update(data).digest("hex"), sha256 = createHash("sha256").update(data).digest("hex");
const args = ["--project-id", "synthetic-project", "--dataset", "production", "--asset-id", `file-${sha1}-zip`, "--bytes", String(data.length), "--sha256", sha256];
const cli = fileURLToPath(new URL("./verify-delivery-zip-remote.mts", import.meta.url));

describe("remote ZIP CLI", () => {
  it.each([
    [], args.slice(0, -1), args.slice(0, -2), [...args, "--bytes", "1"], [...args, "--url", "https://other.test/PRIVATE"],
    [...args, "--token", "PRIVATE"], [...args, "--out", "/PRIVATE/customer"], [...args, "--live"],
    ...["0", "01", "+1", "1e3", "0x10", "1_000", "1.5", "1000000001", "9".repeat(129)].map((bytes) => args.map((x, i) => i === 7 ? bytes : x)),
  ].map((argv) => ({ argv })))("refuses invalid arguments without any fetch or input reflection: $argv", async ({ argv }) => {
    const fetcher = vi.fn<typeof fetch>(), stdout = vi.fn(), stderr = vi.fn();
    expect(await remoteZipMain(argv, { fetchImplementation: fetcher, stdout, stderr })).toBe(2);
    expect(fetcher).not.toHaveBeenCalled(); expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls).toEqual([["[remote-zip] INVALID_INPUT"]]);
  });
  it("parses independent flag order and normalizes PowerShell hash casing", () => {
    const reversed: string[] = [];
    for (let i = args.length - 2; i >= 0; i -= 2) reversed.push(args[i], i === 8 ? args[i + 1].toUpperCase() : args[i + 1]);
    expect(parseRemoteZipArguments(reversed)).toEqual({ projectId: "synthetic-project", dataset: "production", assetId: `file-${sha1}-zip`, bytes: data.length, sha256 });
  });
  it("returns failure rather than a successful process code when no remote agreement exists", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_TOKEN")), stdout = vi.fn(), stderr = vi.fn();
    expect(await remoteZipMain(args, { fetchImplementation: fetcher, stdout, stderr })).toBe(1);
    expect(JSON.parse(stdout.mock.calls[0][0])).toMatchObject({ status: "unverified", readyToPublish: false, result: { status: "failed", code: "request" } });
    expect(JSON.stringify(stdout.mock.calls)).not.toContain("PRIVATE"); expect(stderr).not.toHaveBeenCalled();
  });
  it("runs the actual Node24 CLI against a test-only preloaded fetch, without file output", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "remote-zip-cli-"));
    try {
      const loader = path.join(temp, "synthetic-fetch.mjs");
      writeFileSync(loader, `globalThis.fetch = async (url, options) => {
        if (url !== ${JSON.stringify(`https://cdn.sanity.io/files/synthetic-project/production/${sha1}.zip?dl=photographs.zip`)} || options.method !== 'GET' || options.redirect !== 'manual' || options.credentials !== 'omit' || Object.keys(options.headers).join() !== 'accept-encoding') throw new Error('PRIVATE_FETCH');
        return new Response(Buffer.from(${JSON.stringify(data.toString("base64"))}, 'base64'), {headers:{'content-type':'application/zip','content-disposition':'attachment; filename="photographs.zip"','content-length':${JSON.stringify(String(data.length))}}});
      };`, { mode: 0o600 });
      const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", loader, cli, ...args], {
        cwd: temp, encoding: "utf8", timeout: 10_000, maxBuffer: 4096,
        env: { ...process.env, NODE_OPTIONS: "", PRIVATE_GALLERY_ADAPTER: "enabled", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "private" },
      });
      expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({ version: 1, status: "matched", result: { status: "matched" }, readyToPublish: false });
      expect(result.stdout).not.toMatch(/PRIVATE|synthetic-project|https:\/\//u);
      // Nothing beside the test preload is created by the real CLI.
      expect(readdirSync(temp)).toEqual(["synthetic-fetch.mjs"]);
      const refusal = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", loader, cli, "--url", "/PRIVATE/customer"], { cwd: temp, encoding: "utf8", timeout: 10_000, maxBuffer: 4096 });
      expect(refusal.status).toBe(2); expect(refusal.stdout).toBe(""); expect(refusal.stderr).toBe("[remote-zip] INVALID_INPUT\n");
      expect(readdirSync(temp)).toEqual(["synthetic-fetch.mjs"]);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("keeps the complete new CLI import closure outside filesystem, app and private-service modules", () => {
    const pending = [cli], visited = new Set<string>(), allowedBuiltins = new Set(["node:crypto", "node:path", "node:url"]);
    while (pending.length) {
      const file = pending.pop()!; if (visited.has(file)) continue; visited.add(file);
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function walk(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) {
            expect(ts.isStringLiteral(node.moduleSpecifier)).toBe(true);
            const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
            if (specifier.startsWith(".")) pending.push(path.resolve(path.dirname(file), specifier));
            else expect(allowedBuiltins.has(specifier), specifier).toBe(true);
          }
        }
        if (ts.isCallExpression(node)) expect(node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")).toBe(false);
        ts.forEachChild(node, walk);
      }
      walk(source);
    }
    expect(visited.has(path.resolve(path.dirname(cli), "sanity-asset-byte-verification.mts"))).toBe(true);
  });
});

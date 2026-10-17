import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const pipeline = readFileSync(new URL("../azure-pipelines.yml", import.meta.url), "utf8");
// Read the actual Azure literal Bash block: the integration cases execute its
// bytes rather than a parallel TypeScript implementation of the decision.
const discovery = pipeline.match(/          - bash: \|\n((?:              [^\n]*\n)+)((?:            [^\n]*\n)+)/);
if (!discovery) throw new Error("Browser diagnostics discovery step missing");
const script = discovery[1].replace(/^              /gm, "");
const settings = discovery[2];
const prefix = "##vso[task.setvariable variable=browserDiagnosticsAvailable]";
const absent = `${prefix}false\nNo browser report directory was produced; diagnostic publication is skipped.\n`;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function workingDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), "browser diagnostics "));
  roots.push(root); return root;
}
function discover(root: string) {
  const result = spawnSync("bash", ["-c", script], { cwd: root, encoding: "utf8", timeout: 5000 });
  expect(result.status).toBe(0); expect(result.stderr).toBe("");
  return result.stdout;
}

describe("actual browser diagnostic artifact discovery", () => {
  it("skips a report absent after an earlier gate failed, without creating files", async () => {
    const root = await workingDirectory();
    expect(discover(root)).toBe(absent); expect(await readdir(root)).toEqual([]);
  });
  it("skips a file-shaped report without modifying its bytes", async () => {
    const root = await workingDirectory(), file = path.join(root, "playwright-report");
    await writeFile(file, "existing non-report bytes");
    expect(discover(root)).toBe(absent); expect(await readFile(file, "utf8")).toBe("existing non-report bytes");
  });
  it("admits the existing report with attachments without changing them", async () => {
    const root = await workingDirectory(), report = path.join(root, "playwright-report");
    await mkdir(path.join(report, "data"), { recursive: true });
    await writeFile(path.join(report, "index.html"), "synthetic report");
    await writeFile(path.join(report, "data", "trace.zip"), "synthetic attachment");
    expect(discover(root)).toBe(`${prefix}true\n`);
    expect(await readdir(report)).toEqual(["data", "index.html"]);
    expect(await readFile(path.join(report, "data", "trace.zip"), "utf8")).toBe("synthetic attachment");
  });
  it("leaves empty-directory publication to the existing artifact task", async () => {
    const root = await workingDirectory(); await mkdir(path.join(root, "playwright-report"));
    expect(discover(root)).toBe(`${prefix}true\n`);
  });
  it("uses directory existence for a linked report too", async () => {
    const root = await workingDirectory(); await mkdir(path.join(root, "existing-report"));
    await symlink("existing-report", path.join(root, "playwright-report"));
    expect(discover(root)).toBe(`${prefix}true\n`);
  });
  it("keeps discovery and publication bound to failure and the same directory", () => {
    expect(settings).toContain("condition: failed()");
    expect(settings).toContain('workingDirectory: "$(System.DefaultWorkingDirectory)"');
    expect(settings).toContain('displayName: "Discover end-to-end failure diagnostics"');
    expect(script).not.toContain("$(");
    expect(settings).not.toMatch(/continueOnError|always\(|succeededOrFailed\(/);
    const artifact = pipeline.match(/- task: PublishPipelineArtifact@1\n([\s\S]*?)artifact: "playwright-report"/);
    expect(artifact?.[1]).toContain("condition: and(failed(), eq(variables['browserDiagnosticsAvailable'], 'true'))");
    expect(artifact?.[1]).toContain('targetPath: "playwright-report"');
    expect(artifact?.[1]).not.toMatch(/continueOnError|always\(/);
    expect(pipeline.indexOf('displayName: "End-to-end smoke tests"')).toBeLessThan(pipeline.indexOf(discovery[0]));
    expect(pipeline.indexOf(discovery[0])).toBeLessThan(pipeline.indexOf(artifact![0]));
  });
});

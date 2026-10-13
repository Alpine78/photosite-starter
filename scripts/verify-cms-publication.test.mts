import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "./joomla-intro-summary.mts";
import { sha256 } from "./publication-smoke-plan.mts";
const exec = promisify(execFile), folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "publication-smoke-")); folders.push(dir);
  const source = { _id: "synthetic-home", _rev: "source-revision", _type: "homePage", _createdAt: "2026-01-01T00:00:00Z", _updatedAt: "2026-01-01T00:00:00Z",
    intro: [{ _key: "fi", _type: "localizedText", language: "fi", value: "Synthetic intro" }] };
  const input = path.join(dir, "source.json"), baseline = path.join(dir, "baseline.json"), out = path.join(dir, "plan.json");
  await writeFile(input, JSON.stringify(source), { mode: 0o600 });
  await writeFile(baseline, JSON.stringify({ documentsComplete: false, assetsComplete: false, restoreReady: false }), { mode: 0o600 });
  const args = ["plan", "--source", input, "--baseline", baseline, "--project", "synthetic-project", "--dataset", "production", "--api-version", "v2026-03-01", "--language", "fi", "--out", out];
  return { dir, input, baseline, out, args };
}
function run(args: string[]) {
  const guard = "data:text/javascript," + encodeURIComponent("globalThis.fetch=()=>{throw new Error('UNEXPECTED_NETWORK_SYNTHETIC');};");
  return exec(process.execPath, ["--import", guard, path.resolve("scripts/verify-cms-publication.mts"), ...args], {
    timeout: 15_000, env: { ...process.env, NODE_NO_WARNINGS: "1", SANITY_PUBLICATION_TOKEN: "SYNTHETIC_TOKEN_MUST_NOT_BE_READ", NEXT_PUBLIC_SANITY_PUBLICATION_TOKEN: "SYNTHETIC_PUBLIC_TOKEN" },
  });
}
describe("publication CLI offline/private boundaries", () => {
  it("creates an offline private plan and never overwrites it", async () => {
    const f = await fixture(), result = await run(f.args);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "plan-only", documents: 1 });
    const original = await readFile(f.out); await expect(run(f.args)).rejects.toThrow(); expect(await readFile(f.out)).toEqual(original);
  });
  it("apply defaults to plan-only without resolving credentials or requiring ready recovery", async () => {
    const f = await fixture(); await run(f.args);
    const out = path.join(f.dir, "dry-apply.json");
    const result = await run(["apply", "--plan", f.out, "--baseline", f.baseline, "--out", out]);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "plan-only", phase: "apply" });
  });
  it("rejects --yes with missing approval and incomplete recovery before credentials/network", async () => {
    const f = await fixture(); await run(f.args); const plan = JSON.parse(await readFile(f.out, "utf8"));
    for (const approval of [[], ["--approved-digest", plan.digest]]) {
      const args = ["apply", "--plan", f.out, "--baseline", f.baseline, "--out", path.join(f.dir, "receipt.json"), ...approval, "--yes"];
      const result = await run(args).then(() => undefined, (e: { stderr: string; stdout: string }) => e);
      expect(result?.stderr).toContain("details withheld"); expect(result?.stderr).not.toContain("SYNTHETIC_TOKEN"); expect(result?.stderr).not.toContain("UNEXPECTED_NETWORK");
      await expect(readFile(path.join(f.dir, "receipt.json"))).rejects.toThrow();
    }
  });
  it("refuses unsafe input permissions, symlinks, malformed UTF-8 and output aliases", async () => {
    const f = await fixture(); await chmod(f.input, 0o644); await expect(run(f.args)).rejects.toThrow(); await chmod(f.input, 0o600);
    const link = path.join(f.dir, "link.json"); await symlink(f.input, link);
    await expect(run(f.args.map((v) => v === f.input ? link : v))).rejects.toThrow();
    await symlink(f.input, f.out); await expect(run(f.args)).rejects.toThrow(); await rm(f.out);
    await writeFile(f.input, Buffer.from([0xff])); await expect(run(f.args)).rejects.toThrow();
    await expect(readFile(f.out)).rejects.toThrow();
  });
  it("rejects nonignored repository output and changed baseline bytes", async () => {
    const f = await fixture(); await exec("git", ["init", f.dir]); await expect(run(f.args)).rejects.toThrow();
    await writeFile(path.join(f.dir, ".gitignore"), "plan.json\nreceipt.json\n"); await run(f.args);
    await writeFile(f.baseline, '{"changed":true}');
    await expect(run(["apply", "--plan", f.out, "--baseline", f.baseline, "--out", path.join(f.dir, "receipt.json")])).rejects.toThrow();
    await expect(readFile(path.join(f.dir, "receipt.json"))).rejects.toThrow();
  });
  it("executes exactly one approved mocked CAS and restores against its observed revision", async () => {
    const f = await fixture(), source = JSON.parse(await readFile(f.input, "utf8"));
    const target = { projectId: "synthetic-project", dataset: "production", apiVersion: "v2026-03-01" };
    await writeFile(f.baseline, JSON.stringify({ version: 1, target, documentsComplete: true, assetsComplete: true, restoreReady: true,
      sourceDocumentSha256: sha256(canonicalJson(source)), documentSnapshotSha256: "a".repeat(64), assetManifestSha256: "b".repeat(64) }));
    await run(f.args); const p = JSON.parse(await readFile(f.out, "utf8"));
    const applyOut = path.join(f.dir, "applied.json"), restoreOut = path.join(f.dir, "restored.json");
    for (const phase of ["apply", "restore"]) {
      const out = phase === "apply" ? applyOut : restoreOut;
      const initial = phase === "apply" ? p.source : { ...p.proposed, _rev: "source-post" };
      const script = `import {readFile} from 'node:fs/promises'; let doc=${JSON.stringify(initial)}; let writes=0;
        globalThis.fetch=async(url,init)=>{if(!String(url).startsWith('https://synthetic-project.api.sanity.io/v2026-03-01/'))throw Error('BAD_HOST');
          if(init.method==='GET')return new Response(JSON.stringify({result:[doc]}));
          if(++writes!==1)throw Error('RETRY'); const receipt=JSON.parse(await readFile(${JSON.stringify(out + ".prepared.json")},'utf8'));
          if(receipt.status!=='prepared')throw Error('NO_DURABLE_PREPARE');
          const mutation=JSON.parse(init.body).mutations; if(mutation.length!==1||mutation[0].patch.ifRevisionID!==doc._rev)throw Error('BAD_CAS');
          doc={...doc,intro:mutation[0].patch.set.intro,_rev:${JSON.stringify(phase === "apply" ? "source-post" : "source-restored")}};
          return new Response(JSON.stringify({transactionId:'synthetic-transaction'}));};`;
      const args = [phase, "--plan", f.out, "--baseline", f.baseline, "--out", out, ...(phase === "restore" ? ["--receipt", applyOut] : []), "--approved-digest", p.digest, "--yes"];
      const result = await exec(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(script), path.resolve("scripts/verify-cms-publication.mts"), ...args], {
        env: { ...process.env, NODE_NO_WARNINGS: "1", SANITY_PROJECT_ID: target.projectId, SANITY_DATASET: target.dataset, SANITY_API_VERSION: target.apiVersion,
          SANITY_PUBLICATION_TOKEN: "synthetic-operator-token", NEXT_PUBLIC_SANITY_PUBLICATION_TOKEN: "" }, timeout: 15_000 });
      expect(JSON.parse(result.stdout).status).toBe(phase === "apply" ? "applied" : "restored");
      expect(JSON.parse(await readFile(out, "utf8"))).toMatchObject({ visibleUpdateVerified: false, genuineWebhookVerified: false, canonicalLaunchVerified: false, automaticRetry: false });
      expect(JSON.parse(await readFile(out + ".prepared.json", "utf8"))).toMatchObject({ status: "prepared", expectedRevision: initial._rev });
    }
    expect(JSON.parse(await readFile(restoreOut, "utf8")).expectedRevision).toBe("source-post");
  });
  it("preserves the prepared record when final receipt storage fails after the write", async () => {
    const f = await fixture(), source = JSON.parse(await readFile(f.input, "utf8"));
    const target = { projectId: "synthetic-project", dataset: "production", apiVersion: "v2026-03-01" };
    await writeFile(f.baseline, JSON.stringify({ version: 1, target, documentsComplete: true, assetsComplete: true, restoreReady: true,
      sourceDocumentSha256: sha256(canonicalJson(source)), documentSnapshotSha256: "a".repeat(64), assetManifestSha256: "b".repeat(64) }));
    await run(f.args); const p = JSON.parse(await readFile(f.out, "utf8")), out = path.join(f.dir, "failed-final.json");
    const script = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const originalOpen=fs.open; fs.open=async(file,...args)=>{const handle=await originalOpen(file,...args);
        if(file===${JSON.stringify(out)})handle.write=async()=>{throw Error('SYNTHETIC_DISK_FAILURE');};return handle;}; syncBuiltinESMExports();
      let doc=${JSON.stringify(p.source)};let writes=0;globalThis.fetch=async(url,init)=>{
        if(init.method==='GET')return new Response(JSON.stringify({result:[doc]}));
        if(++writes!==1)throw Error('RETRY');doc={...doc,intro:${JSON.stringify(p.proposed.intro)},_rev:'observed-post'};
        return new Response('{}');};`;
    const result = await exec(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(script), path.resolve("scripts/verify-cms-publication.mts"), "apply",
      "--plan", f.out, "--baseline", f.baseline, "--out", out, "--approved-digest", p.digest, "--yes"], {
      env: { ...process.env, NODE_NO_WARNINGS: "1", SANITY_PROJECT_ID: target.projectId, SANITY_DATASET: target.dataset, SANITY_API_VERSION: target.apiVersion,
        SANITY_PUBLICATION_TOKEN: "synthetic-operator-token", NEXT_PUBLIC_SANITY_PUBLICATION_TOKEN: "" }, timeout: 15_000,
    }).then(() => undefined, (error: { stderr: string }) => error);
    expect(result?.stderr).toContain("details withheld"); expect(result?.stderr).not.toContain("SYNTHETIC_DISK_FAILURE");
    expect(JSON.parse(await readFile(out + ".prepared.json", "utf8"))).toMatchObject({ status: "prepared", phase: "apply", planDigest: p.digest, expectedRevision: p.source._rev });
    expect((await readFile(out)).length).toBe(0);
  });
  it("reconciles an uncertain apply receipt read-only and never sends a patch", async () => {
    const f = await fixture(); await run(f.args); const p = JSON.parse(await readFile(f.out, "utf8"));
    const prior = path.join(f.dir, "uncertain.json"), out = path.join(f.dir, "observed.json");
    await writeFile(prior, JSON.stringify({ version: 1, phase: "apply", planDigest: p.digest, expectedRevision: p.source._rev, status: "prepared" }), { mode: 0o600 });
    const script = `globalThis.fetch=async(url,init)=>{if(init.method!=='GET')throw Error('UNEXPECTED_WRITE');return new Response(JSON.stringify({result:[${JSON.stringify({ ...p.proposed, _rev: "observed-post" })}]}));};`;
    const result = await exec(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(script), path.resolve("scripts/verify-cms-publication.mts"), "reconcile", "--plan", f.out, "--baseline", f.baseline, "--receipt", prior, "--out", out], {
      env: { ...process.env, NODE_NO_WARNINGS: "1", SANITY_PROJECT_ID: "synthetic-project", SANITY_DATASET: "production", SANITY_API_VERSION: "v2026-03-01", SANITY_AUDIT_TOKEN: "synthetic-read-token", NEXT_PUBLIC_SANITY_AUDIT_TOKEN: "" }, timeout: 15_000 });
    expect(JSON.parse(result.stdout).status).toBe("applied");
    expect(JSON.parse(await readFile(out, "utf8"))).toMatchObject({ readOnlyReconciliation: true, observedRevision: "observed-post" });
  });
});

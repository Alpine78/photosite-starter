import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attestDeploymentSource } from "./deployment-source-attestation.mts";
const sha = "a".repeat(40), tree = "b".repeat(40);
const clean = { head: sha, expectedTree: tree, headTree: tree, status: "" };
describe("clean release source attestation", () => {
  it("binds a clean exact checkout without claiming artifact provenance", () => expect(attestDeploymentSource(sha, clean)).toMatchObject({ sourceSha: sha, treeSha: tree, gitDirty: "0", artifactContentsVerified: false }));
  it.each(["head", "headTree", "expectedTree"] as const)("refuses wrong %s", key => expect(() => attestDeploymentSource(sha, { ...clean, [key]: "c".repeat(40) })).toThrow("SOURCE_IDENTITY_MISMATCH"));
  it.each([" M src/fixture.ts\0", "?? unexpected-file\0", "M  staged-file\0", "\n", "secret-value"])("refuses nonempty status without echoing filenames", status => {
    expect(() => attestDeploymentSource(sha, { ...clean, status })).toThrow("SOURCE_CHECKOUT_DIRTY");
  });
  it.each(["", "main", "--flag", "secret-value", "a".repeat(39)])("refuses invalid expected SHA %s", expected => expect(() => attestDeploymentSource(expected, clean)).toThrow("INVALID_SOURCE_IDENTITY"));
  it("detects a source switch between clean before/after build checks", () => {
    expect(attestDeploymentSource(sha, clean).gitDirty).toBe("0");
    expect(() => attestDeploymentSource(sha, { ...clean, head: "c".repeat(40) })).toThrow();
  });
  it("keeps mandatory CI guards and checks source around building before metadata upload", () => {
    const pipeline = readFileSync(new URL("../azure-pipelines.yml", import.meta.url), "utf8");
    const build = pipeline.indexOf('./node_modules/.bin/vercel build --target=preview');
    const checks = [...pipeline.matchAll(/node scripts\/assert-deployment-source\.mts "\$EXPECTED_SOURCE_SHA"/g)].map(m => m.index!);
    expect(checks).toHaveLength(2); expect(checks[0]).toBeLessThan(build); expect(checks[1]).toBeGreaterThan(build);
    const deploy = pipeline.indexOf('url="$(./node_modules/.bin/vercel deploy'); expect(checks[1]).toBeLessThan(deploy);
    expect(pipeline).toContain('--meta gitCommitSha="$EXPECTED_SOURCE_SHA" --meta gitDirty=0');
    expect(pipeline).toContain('npm run verify:preview'); expect(pipeline).toContain('npm run repoint:preview');
    expect(pipeline).toContain('npm run remove:preview'); expect(pipeline).toContain('$(Build.SourceVersion)');
  });
});

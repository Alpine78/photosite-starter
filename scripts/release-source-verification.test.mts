import { describe, expect, it } from "vitest";
import { verifyReleaseSource } from "./release-source-verification.mts";
const expected = { sourceSha: "a".repeat(40), deploymentId: "dpl_fixture", projectId: "prj_fixture", teamId: "team_fixture" };
const valid = () => ({ id: expected.deploymentId, projectId: expected.projectId, team: { id: expected.teamId }, readyState: "READY", target: null, meta: { gitCommitSha: expected.sourceSha, gitDirty: "0" } });
describe("frozen release source", () => {
  it("binds ownership and source while reserving artifact and launch gates", () => {
    expect(verifyReleaseSource(valid(), expected)).toMatchObject({ providerSourceIdentityVerified: true, artifactContentsVerified: false, canonicalLaunchVerified: false, protectionVerified: false });
  });
  it.each(["id", "projectId", "readyState", "target"])("refuses wrong %s", key => {
    expect(verifyReleaseSource({ ...valid(), [key]: "wrong" }, expected).providerSourceIdentityVerified).toBe(false);
  });
  it("refuses conflicting owner identities", () => expect(verifyReleaseSource({ ...valid(), ownerId: "team_wrong" }, expected).reasons).toContain("TEAM_MISMATCH"));
  it.each([undefined, null, "", "false", 0, 2, {}, "1", true])("refuses unknown/dirty cleanliness %j", gitDirty => {
    expect(verifyReleaseSource({ ...valid(), meta: { gitCommitSha: expected.sourceSha, gitDirty } }, expected).providerSourceIdentityVerified).toBe(false);
  });
  it("refuses ambiguity even when one source SHA matches", () => expect(verifyReleaseSource({ ...valid(), gitSource: { sha: "b".repeat(40) } }, expected).reasons).toContain("SOURCE_AMBIGUOUS"));
  it.each([undefined, "b".repeat(40), "secret-value", 1])("refuses unknown/mismatched source without echoing it", gitCommitSha => {
    const result = verifyReleaseSource({ ...valid(), meta: { gitCommitSha, gitDirty: "0", secret: "private-value" } }, expected);
    expect(result.providerSourceIdentityVerified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
  it.each([null, [], {}, "private-value"])("fails closed on malformed provider shape %j", value => expect(verifyReleaseSource(value, expected).providerSourceIdentityVerified).toBe(false));
  it("validates caller-owned expectations before reporting", () => expect(() => verifyReleaseSource(valid(), { ...expected, sourceSha: "private-value" })).toThrow("INVALID_EXPECTED_IDENTITY"));
});

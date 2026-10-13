/** Provider metadata identity, deliberately not artifact byte provenance. */
export type ExpectedRelease = { sourceSha: string; deploymentId: string; projectId: string; teamId: string };
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export function verifyReleaseSource(value: unknown, expected: ExpectedRelease) {
  if (!/^[a-f0-9]{40}$/.test(expected.sourceSha) || !/^dpl_[a-zA-Z0-9]{1,80}$/.test(expected.deploymentId) || !/^prj_[a-zA-Z0-9]{1,80}$/.test(expected.projectId) || !/^team_[a-zA-Z0-9]{1,80}$/.test(expected.teamId)) throw new Error("INVALID_EXPECTED_IDENTITY");
  const record = object(value), meta = object(record?.meta), team = object(record?.team);
  const reasons: string[] = [];
  if (record?.id !== expected.deploymentId) reasons.push("DEPLOYMENT_MISMATCH");
  if (record?.projectId !== expected.projectId) reasons.push("PROJECT_MISMATCH");
  if (team?.id !== expected.teamId || (record?.ownerId !== undefined && record.ownerId !== expected.teamId)) reasons.push("TEAM_MISMATCH");
  if (record?.readyState !== "READY") reasons.push("DEPLOYMENT_NOT_READY");
  if (record?.target !== "production" && record?.target !== null) reasons.push("UNKNOWN_DEPLOYMENT_TARGET");
  const sourceValues = [meta?.gitCommitSha, meta?.githubCommitSha, object(record?.gitSource)?.sha].filter(v => v !== undefined);
  if (!sourceValues.length || sourceValues.some(v => typeof v !== "string" || !/^[a-f0-9]{40}$/.test(v))) reasons.push("SOURCE_UNKNOWN_OR_MALFORMED");
  else if (new Set(sourceValues).size !== 1) reasons.push("SOURCE_AMBIGUOUS");
  else if (sourceValues[0] !== expected.sourceSha) reasons.push("SOURCE_MISMATCH");
  // A provider response without affirmative cleanliness evidence cannot pass.
  if (meta?.gitDirty === "1" || meta?.gitDirty === true) reasons.push("SOURCE_DIRTY");
  else if (meta?.gitDirty !== "0" && meta?.gitDirty !== false) reasons.push("SOURCE_CLEANLINESS_UNKNOWN");
  return { version: 1, expected, providerSourceIdentityVerified: reasons.length === 0, reasons,
    artifactContentsVerified: false, protectionVerified: false, canonicalLaunchVerified: false,
    deploymentMutated: false };
}

/** AB#283: owned-origin, source-bound protected candidate checks; no writes. */
import { parseDeploymentUrl, validateDeploymentIdentity, verifyPreviewDeployment } from "./preview-verification.mts";
import { verifyReleaseSource, type ExpectedRelease } from "./release-source-verification.mts";
import { probePreviewDeployment } from "./preview-probe.mts";
import { probeLegacyRedirect } from "./legacy-redirect-probe.mts";
import { parseVerificationOrigin, verificationStatus, type MappingRow } from "./legacy-redirect-verification.mts";
import { verifyLegacyMappingRows } from "./legacy-target-probe.mts";

/** No credential forwarding to another origin, an HTTP downgrade or a redirect. */
export function candidateFetch(origin: string, bypass: string, send: typeof fetch = fetch): typeof fetch {
  const allowed = parseDeploymentUrl(origin).origin;
  if (!bypass.trim() || /[\r\n]/.test(bypass)) throw new Error("INVALID_CANDIDATE_BYPASS");
  return async (input, init) => {
    if (typeof input !== "string" && !(input instanceof URL)) throw new Error("INVALID_CANDIDATE_REQUEST");
    const url = new URL(input);
    if (url.origin !== allowed || url.username || url.password || url.hash || init?.redirect !== "manual" || (init?.method !== undefined && init.method !== "GET") || init?.body !== undefined) throw new Error("INVALID_CANDIDATE_REQUEST");
    const headers = new Headers(init?.headers);
    // Caller-supplied auth is never forwarded; the one validated bypass is owned here.
    headers.delete("authorization"); headers.delete("cookie"); headers.set("x-vercel-protection-bypass", bypass);
    return send(url, { ...init, headers, redirect: "manual", cache: "no-store" });
  };
}

export async function verifyLegacyCandidate(input: {
  url: string; canonicalOrigin: string; expected: ExpectedRelease; metadata: unknown;
  rows: readonly MappingRow[]; pendingCount: number;
}, dependencies: { readBypass: () => string; send?: typeof fetch }) {
  const url = parseDeploymentUrl(input.url), canonicalOrigin = parseVerificationOrigin(input.canonicalOrigin);
  validateDeploymentIdentity(input.metadata, { url, deploymentId: input.expected.deploymentId, projectId: input.expected.projectId, ownerId: input.expected.teamId });
  const source = verifyReleaseSource(input.metadata, input.expected);
  if (!source.providerSourceIdentityVerified) throw new Error("CANDIDATE_SOURCE_REFUSED");
  // Resolve no bypass until both identity and clean frozen source have passed.
  const send = dependencies.send ?? fetch;
  const protection = await probePreviewDeployment(url, {}, send);
  const bypassedFetch = candidateFetch(url.origin, dependencies.readBypass(), send);
  const bypassed = await probePreviewDeployment(url, {}, bypassedFetch);
  const safety = verifyPreviewDeployment({ protectionStatus: protection.status, protectionLocation: protection.location, bypassStatus: bypassed.status, robotsTag: bypassed.robotsTag });
  if (!safety.ok) throw new Error("CANDIDATE_PROTECTION_REFUSED");
  const probe: typeof probeLegacyRedirect = (target, readHtml = false) => probeLegacyRedirect(target, readHtml, { fetchImplementation: bypassedFetch });
  const results = await verifyLegacyMappingRows(input.rows, url.origin, canonicalOrigin, probe);
  return { schemaVersion: 1, expected: input.expected, checkedAt: new Date().toISOString(), origin: url.origin, canonicalOrigin,
    providerSourceIdentityVerified: true, protectionAndNoindexVerified: true,
    status: verificationStatus(input.pendingCount, results), results,
    artifactContentsVerified: false, deploymentMutated: false, finalProductionVerified: false, launchApproved: false };
}

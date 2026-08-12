/**
 * What makes a Preview deployment safe to hand to a reviewer.
 *
 * Two independent properties, checked separately because neither implies the
 * other (ADR-0004 §3):
 *
 * - **Access protection.** An unauthenticated request must be answered by the
 *   provider's protection layer, not by the application. A release candidate
 *   carries unreleased work and a live contact endpoint.
 * - **Non-indexability.** The response a reviewer actually sees must carry
 *   `X-Robots-Tag: noindex`. Protection keeps crawlers out today; the header is
 *   what keeps the URL out of an index if protection is ever relaxed, and it is
 *   the reason a Preview deployment may use a generated URL at all.
 *
 * Both are asserted before the URL is published, so a misconfigured deployment
 * is never announced as reviewable.
 *
 * This module performs no IO. The decisions live apart from the requests that
 * feed them so they can be tested without a network, which is what the
 * project's test rules require; `verify-preview-deployment.mts` is the only
 * caller that opens a socket.
 */

export type ProbeOutcome = {
  readonly ok: boolean;
  /**
   * One line, written to be safe in a pipeline log that is retained and
   * published: status codes and robots directives only, never a response body,
   * a credential, or a header the caller sent.
   */
  readonly detail: string;
};

/**
 * The one status that proves Vercel Authentication answered: 401.
 *
 * 403 is deliberately **not** accepted, though a protection layer may return
 * it. The platform's firewall and bot protection also deny with 403, and the
 * automation bypass secret used by the second probe lifts those as well as
 * deployment protection. A 403/200 pair is therefore consistent with a
 * deployment that has no Vercel Authentication at all and was merely refusing
 * the agent's address — which would report "protected" for a deployment any
 * ordinary visitor could open.
 *
 * Failing on 403 costs an operator one investigation. Accepting it costs an
 * unprotected release candidate that the pipeline called verified, so the
 * ambiguous case fails.
 */
const PROTECTION_CHALLENGE_STATUS = 401;

export function classifyProtection(status: number): ProbeOutcome {
  if (status === PROTECTION_CHALLENGE_STATUS) {
    return {
      ok: true,
      detail: `unauthenticated request challenged with ${status}`,
    };
  }

  if (status === 403) {
    return {
      ok: false,
      detail:
        "unauthenticated request was denied with 403, which does not prove " +
        "Vercel Authentication is enabled: the platform firewall and bot " +
        "protection deny with 403 too, and the automation bypass lifts those " +
        "as well. Check Standard Protection on the project itself; a " +
        "protected deployment challenges with 401.",
    };
  }

  if (status >= 200 && status <= 299) {
    return {
      ok: false,
      detail:
        `unauthenticated request was served the application (${status}). ` +
        "The deployment is readable by anyone who learns its URL; enable " +
        "Standard Protection with Vercel Authentication on the project.",
    };
  }

  return {
    ok: false,
    detail:
      `unauthenticated request answered with ${status}, which neither proves ` +
      "nor disproves access protection. Treated as a failure: an unverified " +
      "deployment is not a protected one.",
  };
}

/**
 * Asserts the provider contract rather than attempting a general robots parser.
 *
 * Vercel documents a plain `X-Robots-Tag: noindex` on Preview deployments. A
 * user-agent scope applies to every rule in its comma-separated list, but the
 * Fetch API may also join repeated response headers with commas. Those two wire
 * shapes cannot be distinguished after joining. Accepting a token merely
 * because it appears somewhere in the resulting string can therefore turn a
 * crawler-specific rule into a false global pass. The exact, unscoped provider
 * value is unambiguous and is the only value accepted here.
 */
export function hasNoindexDirective(headerValue: string | null): boolean {
  return headerValue?.trim().toLowerCase() === "noindex";
}

export function classifyIndexing(
  status: number,
  robotsTag: string | null,
): ProbeOutcome {
  // The bypass request has to reach the application for its answer to say
  // anything about what a reviewer will see. A refusal here means the bypass
  // secret is missing, wrong, or not enabled on the project — not that the
  // deployment is indexable.
  if (status !== 200) {
    return {
      ok: false,
      detail:
        `bypassed request answered with ${status}, expected 200. The ` +
        "automation bypass secret does not match the project, so the " +
        "indexing header could not be read.",
    };
  }

  if (!hasNoindexDirective(robotsTag)) {
    return {
      ok: false,
      detail:
        robotsTag === null
          ? "response carries no X-Robots-Tag header, so nothing keeps this URL out of a search index."
          : `response carries X-Robots-Tag: ${robotsTag}, expected the provider's exact unscoped value "noindex".`,
    };
  }

  return { ok: true, detail: `X-Robots-Tag: ${robotsTag}` };
}

export type PreviewProbes = {
  /** Status of a request that carried no bypass header. */
  readonly protectionStatus: number;
  /** Status of the request that carried the bypass header. */
  readonly bypassStatus: number;
  /** `X-Robots-Tag` from the bypassed response, or null when absent. */
  readonly robotsTag: string | null;
};

export type PreviewCheck = ProbeOutcome & { readonly name: string };

export type PreviewVerification = {
  readonly ok: boolean;
  readonly checks: readonly PreviewCheck[];
};

/**
 * Both checks always run, even when the first fails: an operator fixing a
 * half-provisioned project should see everything that is wrong in one pipeline
 * run rather than one problem per run.
 */
export function verifyPreviewDeployment(
  probes: PreviewProbes,
): PreviewVerification {
  const checks: readonly PreviewCheck[] = [
    { name: "access protection", ...classifyProtection(probes.protectionStatus) },
    {
      name: "noindex",
      ...classifyIndexing(probes.bypassStatus, probes.robotsTag),
    },
  ];

  return { ok: checks.every((check) => check.ok), checks };
}

/**
 * Host every generated Vercel deployment URL ends with. A deployment reached
 * through anything else is not the provider's generated URL.
 */
const DEPLOYMENT_HOST_SUFFIX = ".vercel.app";

/**
 * Performs only the URL-shape check that can be proven locally.
 *
 * A Vercel hostname does not prove who owns it: project names repeat between
 * teams, and generated hostnames may be transformed or truncated. The caller
 * must authenticate to the Vercel API and pass the response to
 * `validateDeploymentIdentity` before it sends any project secret to this URL.
 */
export function parseDeploymentUrl(value: string): URL {
  const trimmed = value.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid deployment URL: expected an absolute HTTPS URL, received "${trimmed}"`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `Invalid deployment URL: expected HTTPS, received "${trimmed}"`,
    );
  }

  if (url.username || url.password) {
    throw new Error(
      "Invalid deployment URL: credentials must not appear in a deployment URL",
    );
  }

  if (url.search || url.hash) {
    throw new Error(
      "Invalid deployment URL: expected no query or fragment. The automation bypass secret travels in a request header, never in the URL.",
    );
  }

  if (url.port) {
    throw new Error(
      `Invalid deployment URL: expected the default HTTPS port, received port ${url.port}`,
    );
  }

  if (url.pathname !== "/") {
    throw new Error(
      `Invalid deployment URL: expected the deployment root, received path "${url.pathname}"`,
    );
  }

  if (!url.hostname.endsWith(DEPLOYMENT_HOST_SUFFIX)) {
    throw new Error(
      `Invalid deployment URL: expected a generated ${DEPLOYMENT_HOST_SUFFIX} deployment URL, received host "${url.hostname}".`,
    );
  }

  return url;
}

const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

export type ExpectedDeploymentIdentity = {
  readonly projectId: string;
  readonly ownerId: string;
  readonly url?: URL;
  readonly deploymentId?: string;
};

export type VerifiedDeploymentIdentity = {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly hostname: string;
};

/** A field read out of Vercel's response. A failure here is the provider's. */
function requiredString(
  value: unknown,
  field: string,
  pattern?: RegExp,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Vercel deployment response has no valid ${field}`);
  }

  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    throw new Error(`Vercel deployment response has an invalid ${field}`);
  }

  return normalized;
}

/**
 * A value this pipeline was configured with. A failure here is the operator's,
 * so it names the setting rather than blaming the provider's response — an
 * empty `VERCEL_PROJECT_ID` sent an operator reading Vercel's payload once
 * already.
 *
 * Deliberately no shape rule beyond "present". The identifiers are opaque
 * provider strings, and the binding that matters is the comparison against the
 * authenticated response below, not their spelling. A rule such as
 * `^team_` would also reject a legitimate clone whose scope is a personal
 * account rather than a team, and this repository has to stay deployable by
 * someone else.
 */
function requiredSetting(value: string, setting: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error(`${setting} is not set, so the deployment cannot be bound to a project`);
  }
  return normalized;
}

/**
 * Validates the private identity fields returned by Vercel's authenticated
 * deployment endpoint. Only this comparison binds a captured URL to the
 * customer-owned project and team.
 */
export function validateDeploymentIdentity(
  value: unknown,
  expected: ExpectedDeploymentIdentity,
): VerifiedDeploymentIdentity {
  const expectedProjectId = requiredSetting(
    expected.projectId,
    "VERCEL_PROJECT_ID",
  );
  const expectedOwnerId = requiredSetting(expected.ownerId, "VERCEL_ORG_ID");

  if (typeof value !== "object" || value === null) {
    throw new Error("Vercel deployment response is not an object");
  }

  const record = value as Record<string, unknown>;
  const id = requiredString(record.id, "deployment ID", DEPLOYMENT_ID_PATTERN);
  const projectId = requiredString(record.projectId, "project ID");
  const ownerId = requiredString(record.ownerId, "owner ID");
  const hostname = requiredString(record.url, "deployment hostname").toLowerCase();

  if (projectId !== expectedProjectId) {
    throw new Error(
      `Vercel deployment belongs to project ${projectId}, expected ${expectedProjectId}`,
    );
  }

  if (ownerId !== expectedOwnerId) {
    throw new Error(
      `Vercel deployment belongs to owner ${ownerId}, expected ${expectedOwnerId}`,
    );
  }

  if (expected.url && hostname !== expected.url.hostname.toLowerCase()) {
    throw new Error(
      `Vercel returned deployment host ${hostname}, expected ${expected.url.hostname}`,
    );
  }

  if (expected.deploymentId) {
    // This one keeps its shape rule: it is not configuration but the immutable
    // ID this pipeline captured from Vercel a moment ago, and the destructive
    // path downstream accepts nothing else.
    const expectedId = parseDeploymentId(expected.deploymentId);
    if (id !== expectedId) {
      throw new Error(`Vercel returned deployment ${id}, expected ${expectedId}`);
    }
  }

  return { id, projectId, ownerId, hostname };
}

export function parseDeploymentId(value: string): string {
  const normalized = value.trim();
  if (!DEPLOYMENT_ID_PATTERN.test(normalized)) {
    throw new Error(
      "Invalid deployment ID: expected the immutable dpl_ identifier returned by Vercel",
    );
  }

  return normalized;
}

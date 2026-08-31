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
 * The provider's own login-challenge redirect, which is what proves Vercel
 * Authentication answered — verified against a real deployment (AB#116,
 * 2026-08-24): an unauthenticated request receives a 3xx redirect whose
 * `Location` names this exact host and path
 * (`https://vercel.com/sso-api?url=...&nonce=...`), not the bare `401` this
 * check originally assumed. Vercel's own documentation confirms the shape:
 * "Users attempting to access the deployment will encounter a Vercel login
 * redirect."
 *
 * A bare redirect status is deliberately **not** sufficient on its own — this
 * application has its own legitimate redirect logic (locale routing, content
 * moves, trailing-slash normalization), so an app-issued redirect must not
 * read as "protection answered." Requiring the redirect target to be this
 * specific provider host and path keeps the same rigor the 403 rejection
 * below already applies: a status code alone is never proof by itself.
 */
const SSO_CHALLENGE_HOST = "vercel.com";
const SSO_CHALLENGE_PATH = "/sso-api";

/**
 * Fetch's own redirect statuses — not the whole 3xx range. 304 (Not
 * Modified) and 306 (unused) are 3xx but carry no redirect semantics; a
 * `Location` header on one of those would not be a genuine provider
 * challenge, and this check must not accept it as one.
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isSsoChallengeRedirect(status: number, location: string | null): boolean {
  if (!REDIRECT_STATUSES.has(status) || location === null) return false;

  let target: URL;
  try {
    target = new URL(location);
  } catch {
    return false;
  }

  return (
    target.hostname === SSO_CHALLENGE_HOST &&
    target.pathname === SSO_CHALLENGE_PATH
  );
}

export function classifyProtection(
  status: number,
  location: string | null = null,
): ProbeOutcome {
  if (isSsoChallengeRedirect(status, location)) {
    return {
      ok: true,
      detail: `unauthenticated request challenged with a ${status} redirect to ${SSO_CHALLENGE_HOST}${SSO_CHALLENGE_PATH}`,
    };
  }

  if (status === 403) {
    return {
      ok: false,
      detail:
        "unauthenticated request was denied with 403, which does not prove " +
        "Vercel Authentication is enabled: the platform firewall and bot " +
        "protection deny with 403 too, and the automation bypass lifts those " +
        `as well. Check Standard Protection on the project itself; a ` +
        `protected deployment challenges with a redirect to ` +
        `${SSO_CHALLENGE_HOST}${SSO_CHALLENGE_PATH}.`,
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
  /** `Location` from that same unauthenticated response, or null when absent. */
  readonly protectionLocation: string | null;
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
    {
      name: "access protection",
      ...classifyProtection(probes.protectionStatus, probes.protectionLocation),
    },
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

/** DNS limits: a label is at most 63 octets, a hostname at most 253. */
const MAX_DNS_LABEL_LENGTH = 63;
const MAX_DNS_HOSTNAME_LENGTH = 253;
const DNS_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Validates the stable Preview integration alias (`PREVIEW_STABLE_ALIAS`, AB#136).
 *
 * The alias is deliberately constrained to a bare `*.vercel.app` host and
 * nothing else. Only a non-production `*.vercel.app` host is *guaranteed* to
 * inherit the project's Standard Protection and Vercel's `X-Robots-Tag:
 * noindex` (Vercel Standard Protection "protects all domains except production
 * domains", on every plan). A custom apex or registered domain carries no such
 * guarantee, and a fixed, unprotected copy of the site at a stable address is
 * exactly what `docs/deployment.md` warns against — so this refuses one rather
 * than assign it.
 *
 * Returns the normalized (trimmed, lowercased) host. Errors name the setting
 * and never echo a secret. The Vercel `alias set` contract also requires a
 * bare host with no scheme, which this enforces.
 */
export function parsePreviewAliasHost(value: string): string {
  const setting = "PREVIEW_STABLE_ALIAS";
  if (typeof value !== "string") {
    throw new Error(`${setting} is not set`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${setting} is not set`);
  }
  if (trimmed !== value) {
    throw new Error(`${setting} must not have leading or trailing whitespace`);
  }
  if (trimmed.startsWith("$(")) {
    // An Azure Pipelines variable that was never defined arrives as the literal
    // macro text; the "Check deployment configuration" step treats that shape
    // as missing too.
    throw new Error(`${setting} is not set`);
  }
  if (/\s/.test(trimmed)) {
    throw new Error(`${setting} must be a bare hostname with no whitespace`);
  }
  if (/[:/@?#]/.test(trimmed)) {
    // A scheme, port, path, credentials, query, or fragment — the Vercel
    // `alias set` contract wants a bare host, and every one of these characters
    // is a sign the value is a URL instead.
    throw new Error(
      `${setting} must be a bare hostname — no scheme, port, path, credentials, query, or fragment (received "${trimmed}")`,
    );
  }

  const host = trimmed.toLowerCase();
  if (!host.endsWith(DEPLOYMENT_HOST_SUFFIX)) {
    throw new Error(
      `${setting} must be a "${DEPLOYMENT_HOST_SUFFIX}" host so it inherits Standard Protection and noindex; a custom domain is refused (received "${trimmed}")`,
    );
  }
  if (host.length > MAX_DNS_HOSTNAME_LENGTH) {
    throw new Error(
      `${setting} is longer than the ${MAX_DNS_HOSTNAME_LENGTH}-character DNS hostname limit`,
    );
  }

  const subdomain = host.slice(0, -DEPLOYMENT_HOST_SUFFIX.length);
  if (!subdomain) {
    throw new Error(
      `${setting} must name a subdomain of "${DEPLOYMENT_HOST_SUFFIX}", not the bare apex`,
    );
  }
  for (const label of subdomain.split(".")) {
    if (!DNS_LABEL_PATTERN.test(label)) {
      throw new Error(
        `${setting} has an invalid DNS label "${label}" (received "${trimmed}")`,
      );
    }
    if (label.length > MAX_DNS_LABEL_LENGTH) {
      throw new Error(
        `${setting} has a DNS label longer than ${MAX_DNS_LABEL_LENGTH} characters`,
      );
    }
  }

  return host;
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

const GIT_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Validates a full Git commit SHA (AB#144). The stable Preview alias repoint
 * compares the deployed revision against the current `main` tip, and both must
 * be an unambiguous 40-hex object name — a short SHA, a ref name, or an
 * unresolved Azure macro is refused so the comparison fails closed rather than
 * silently permitting a superseded revision. Returns the lowercased SHA.
 */
export function parseGitCommitSha(value: string): string {
  const setting = "a Git commit SHA";
  if (typeof value !== "string") {
    throw new Error(`Invalid ${setting}: expected a 40-character hex string`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("$(")) {
    throw new Error(
      `Invalid ${setting}: received an unresolved pipeline variable ("${value.trim()}")`,
    );
  }
  if (!GIT_COMMIT_SHA_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid ${setting}: expected a full 40-character hex object name, received "${value.trim()}"`,
    );
  }
  return normalized;
}

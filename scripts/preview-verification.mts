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
 * Statuses that prove the protection layer answered instead of the
 * application. Vercel Authentication challenges an unauthenticated request with
 * 401; 403 is accepted as the other refusal a protection layer may return.
 *
 * Nothing else passes. A 2xx means the deployment is open to anyone holding the
 * URL, and any other status — a redirect, a 404, a platform error — leaves the
 * question unanswered, which is not the same as an answer of "protected".
 */
const PROTECTION_REFUSAL_STATUSES: readonly number[] = [401, 403];

/**
 * Directives that keep a page out of an index. `noindex` is what the provider
 * documents sending; `none` is its defined equivalent (`noindex, nofollow`),
 * accepted so a change of wording reads as a pass rather than a false alarm.
 */
const NOINDEX_DIRECTIVES: ReadonlySet<string> = new Set(["noindex", "none"]);

export function classifyProtection(status: number): ProbeOutcome {
  if (PROTECTION_REFUSAL_STATUSES.includes(status)) {
    return {
      ok: true,
      detail: `unauthenticated request refused with ${status}`,
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
 * Reads an `X-Robots-Tag` value the way a crawler would: a comma-separated
 * list whose entries may be bare directives (`noindex, nofollow`) or scoped to
 * one crawler (`googlebot: noindex`). Repeated headers arrive already joined
 * with commas by the Fetch API, so one string covers both shapes.
 */
export function hasNoindexDirective(headerValue: string | null): boolean {
  if (headerValue === null) return false;

  return headerValue
    .split(",")
    .map((entry) => {
      const separator = entry.indexOf(":");
      // A scoped entry names the crawler before the colon. Anything after the
      // first colon is the directive itself.
      const directive =
        separator === -1 ? entry : entry.slice(separator + 1);
      return directive.trim().toLowerCase();
    })
    .some((directive) => NOINDEX_DIRECTIVES.has(directive));
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
          : `response carries X-Robots-Tag: ${robotsTag}, which contains no noindex directive.`,
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
 * Parses the deployment URL the pipeline captured.
 *
 * The query and credential rules are not politeness: a bypass secret belongs in
 * a request header, never in a URL that lands in a build log, a referrer, or a
 * provider's request telemetry (ADR-0004 §3). A URL arriving here with a query
 * string is what that mistake looks like, so it fails instead of being fetched.
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

  return url;
}

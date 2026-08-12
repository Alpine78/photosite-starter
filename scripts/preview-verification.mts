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

/**
 * Directives that keep a page out of an index. `noindex` is what the provider
 * documents sending; `none` is its defined equivalent (`noindex, nofollow`),
 * accepted so a change of wording reads as a pass rather than a false alarm.
 */
const NOINDEX_DIRECTIVES: ReadonlySet<string> = new Set(["noindex", "none"]);

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
 * Reads an `X-Robots-Tag` value the way a crawler would: a comma-separated
 * list of directives. Repeated headers arrive already joined with commas by the
 * Fetch API, so one string covers both shapes.
 *
 * Only **unscoped** directives count. An entry may name one crawler before a
 * colon (`googlebot: noindex`), and such a rule binds that crawler alone —
 * every other crawler is free to index the URL, so it does not make a
 * deployment non-indexable. The provider's documented contract here is a plain
 * `X-Robots-Tag: noindex`; a scoped value in its place is a misconfiguration
 * worth failing on, not a pass in different wording.
 */
export function hasNoindexDirective(headerValue: string | null): boolean {
  if (headerValue === null) return false;

  return headerValue
    .split(",")
    .some((entry) => {
      // A colon means the entry is addressed to a named crawler, so whatever
      // follows it governs that crawler only. Ignored rather than unwrapped.
      if (entry.includes(":")) return false;
      return NOINDEX_DIRECTIVES.has(entry.trim().toLowerCase());
    });
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
 * Host every generated Vercel deployment URL ends with. A deployment reached
 * through anything else is not the provider's generated URL.
 */
const DEPLOYMENT_HOST_SUFFIX = ".vercel.app";

/**
 * Parses the deployment URL the pipeline captured, and refuses anything that
 * is not *this project's* generated deployment URL.
 *
 * The strictness is about one thing: the next thing that happens to this URL is
 * that a bypass secret is sent to it in a request header. That secret opens
 * every deployment of the project, so the address it travels to cannot be
 * whatever a command substitution happened to capture. A mistyped argument or a
 * mangled CLI capture would otherwise hand the secret to a stranger's server,
 * and the request would look entirely ordinary from here.
 *
 * `.vercel.app` alone is not enough — every other customer's project answers on
 * that domain too — so the host must also begin with this project's own name,
 * which is the shape the provider generates: `<project>-<hash>-<scope>`.
 * Anything with a port, a path, a query, a fragment, or credentials is refused
 * as well: the bypass belongs in a header, never in a URL that survives in a
 * build log, a referrer, or request telemetry (ADR-0004 §3).
 */
export function parseDeploymentUrl(value: string, expectedProject: string): URL {
  const trimmed = value.trim();
  const project = expectedProject.trim();

  if (!project) {
    throw new Error(
      "Invalid deployment URL: no expected project name was given, so the URL could not be bound to this project. Refusing to send the bypass secret to an unverified host.",
    );
  }

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
      `Invalid deployment URL: expected a generated ${DEPLOYMENT_HOST_SUFFIX} deployment URL, received host "${url.hostname}". The automation bypass secret is only ever sent to this project's own deployment.`,
    );
  }

  if (!url.hostname.startsWith(`${project}-`)) {
    throw new Error(
      `Invalid deployment URL: host "${url.hostname}" does not belong to project "${project}". Another project on ${DEPLOYMENT_HOST_SUFFIX} would answer this request, and the bypass secret must not reach it.`,
    );
  }

  return url;
}

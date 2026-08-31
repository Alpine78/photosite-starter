/**
 * Repointing the stable Preview integration alias, as a transaction (AB#136).
 *
 * The pipeline gives one webhook-facing address — `PREVIEW_STABLE_ALIAS`, a
 * `*.vercel.app` host — that the `DeployPreview` stage repoints at a *verified*
 * Preview deployment after each successful `main` run, so a Sanity webhook (or
 * any other durable integration) configured once keeps working across ordinary
 * redeploys.
 *
 * `repointAndVerifyPreviewAlias` is the decision logic and performs no IO of
 * its own: the Vercel calls go through the injected `fetcher` (handed straight
 * to `vercel-preview-api.mts`), and the alias's own access-protection / noindex
 * probe is the injected `probe`. That keeps every branch — the monotonic
 * backward-move guard, the bounded propagation retry, and the ownership-aware
 * restore — deterministically testable with fakes.
 *
 * Three safeguards, because a stale or unprotected durable address is worse
 * than none:
 *
 *  - **Monotonic guard.** The alias is never moved to a deployment created
 *    before (or at the same time as) the one it already points at — ordering is
 *    by Vercel `createdAt`, *not* by commit ancestry. This stops a run whose
 *    deployment predates the current target from dragging the alias backward.
 *    It does *not* guarantee the alias tracks the newest `main` commit: two
 *    overlapping runs where an older commit's deployment is created later than a
 *    newer commit's can still let the older commit win, and that stale state is
 *    not self-healing (AB#144).
 *  - **Post-repoint verification.** After assignment the alias host itself is
 *    checked for the same SSO challenge and exact `X-Robots-Tag: noindex` a
 *    generated Preview URL must carry (`verify-preview-deployment.mts`).
 *  - **Ownership-aware restore.** If that verification fails, the alias is put
 *    back to its previous target (or removed if it had none) — but only while
 *    it still points at the deployment this run assigned. If a newer run has
 *    since published to it, this run leaves it alone.
 *
 * The Azure Pipelines stage that calls this also holds an exclusive lock on the
 * `photosite-starter-vercel-preview` variable group (`lockBehavior: sequential`),
 * so concurrent `DeployPreview` runs serialize their execution (not their
 * commit order); the guard and ownership check are defence in depth for a
 * manual `vercel alias` run outside CI.
 */
import {
  assignPreviewAlias,
  deleteAlias,
  inspectPreviewDeployment,
  readAliasCurrentTarget,
  resolveDeploymentIfLive,
  type VercelPreviewApiSettings,
} from "./vercel-preview-api.mts";
import {
  parsePreviewAliasHost,
  verifyPreviewDeployment,
  type PreviewCheck,
  type PreviewProbes,
} from "./preview-verification.mts";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 3_000;

/**
 * Probes the alias host once and returns the two response shapes
 * `verifyPreviewDeployment` needs: an unauthenticated request (must be the
 * provider's SSO challenge) and one carrying the automation bypass (must be
 * 200 with `X-Robots-Tag: noindex`).
 */
export type AliasProbe = (aliasUrl: URL) => Promise<PreviewProbes>;

export type RepointDeps = {
  readonly fetcher: typeof fetch;
  readonly probe: AliasProbe;
  readonly sleep: (ms: number) => Promise<void>;
};

export type RepointInput = {
  readonly deploymentUrl: string;
  readonly deploymentId: string;
  readonly aliasHost: string;
  readonly settings: VercelPreviewApiSettings;
  readonly deps: RepointDeps;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
};

export type RepointOutcome =
  | {
      readonly kind: "already-current";
      readonly currentTarget: string;
      readonly detail: string;
    }
  | {
      // The configured alias is a production domain — refused before any
      // mutation, so it is never atomically pulled onto a Preview deployment.
      readonly kind: "refused";
      readonly detail: string;
    }
  | {
      readonly kind: "assigned";
      readonly previousTarget: string | null;
      readonly checks: readonly PreviewCheck[];
      readonly attempts: number;
    }
  | {
      readonly kind: "restored";
      readonly restoredTo: string | null;
      readonly checks: readonly PreviewCheck[];
      readonly attempts: number;
    }
  | {
      readonly kind: "abandoned";
      readonly movedOnTo: string;
      readonly checks: readonly PreviewCheck[];
      readonly attempts: number;
    }
  | {
      // The assignment was attempted, verification did not pass, and the
      // orchestrator could not read or fix the alias afterwards. Its target is
      // unknown; a human must run `npm run verify:preview-alias` and repoint.
      readonly kind: "unreconciled";
      readonly detail: string;
      readonly checks: readonly PreviewCheck[];
      readonly attempts: number;
    };

/**
 * A 404 or 503 on either probe is treated as alias-propagation lag and retried;
 * any other definitive answer (a clean pass, or a real failure such as the app
 * being served to an unauthenticated request) is not.
 */
export function isTransientProbe(probes: PreviewProbes): boolean {
  const transient = (status: number): boolean => status === 404 || status === 503;
  return transient(probes.protectionStatus) || transient(probes.bypassStatus);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function repointAndVerifyPreviewAlias(
  input: RepointInput,
): Promise<RepointOutcome> {
  const aliasHost = parsePreviewAliasHost(input.aliasHost);
  const { fetcher, probe, sleep } = input.deps;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const aliasUrl = new URL(`https://${aliasHost}/`);

  // Bind the freshly-deployed generated URL to the expected project and team,
  // and read its creation time and project name.
  const ours = await inspectPreviewDeployment(
    input.deploymentUrl,
    input.settings,
    input.deploymentId,
    fetcher,
  );
  const ourId = ours.deployment.id;

  // Never repoint the project's own default production domain
  // (`<project>.vercel.app`). `parsePreviewAliasHost` only checks syntax; it
  // cannot know the project name.
  if (ours.projectName && aliasHost === `${ours.projectName}.vercel.app`) {
    return {
      kind: "refused",
      detail: `PREVIEW_STABLE_ALIAS is the project's default production domain (${aliasHost}); it must be a dedicated non-production *.vercel.app host`,
    };
  }

  const prior = await readAliasCurrentTarget(aliasHost, input.settings, fetcher);

  if (prior) {
    // A `*.vercel.app` alias that currently resolves to a production deployment
    // is a production domain in all but name. Refuse before mutating it.
    if (prior.isProductionTarget) {
      return {
        kind: "refused",
        detail: `PREVIEW_STABLE_ALIAS currently resolves to a production deployment (${prior.deploymentId}); refusing to repoint a production domain onto Preview`,
      };
    }
    if (prior.deploymentId === ourId) {
      return {
        kind: "already-current",
        currentTarget: ourId,
        detail: "the alias already points at this deployment",
      };
    }
    // Monotonic guard on Vercel `createdAt` — deployment creation time, not
    // commit ancestry. It only refuses a deployment created before the current
    // target; an older `main` commit whose deployment is created *later* than a
    // newer commit's is not caught here (AB#144).
    if (
      prior.createdAt !== null &&
      ours.createdAt !== null &&
      prior.createdAt >= ours.createdAt
    ) {
      return {
        kind: "already-current",
        currentTarget: prior.deploymentId,
        detail: `the alias already points at a deployment created at or after this one (${prior.deploymentId}); not moving it backward`,
      };
    }
  }

  // The rollback target: what the alias should be put back to if verification
  // fails. The authoritative source is `assignPreviewAlias`'s atomic
  // `oldDeploymentId` (what the alias pointed at *at the moment of the POST*),
  // captured and liveness-checked below. Until then, the pre-assignment read is
  // the only fallback — used when the POST throws without a body.
  let restoreTarget: string | null = prior?.deploymentId ?? null;

  // Probe the alias host up to the attempt budget, retrying only a transient
  // (404/503) answer or a thrown request. Returns the last verification result.
  const verifyAlias = async (): Promise<{
    readonly ok: boolean;
    readonly checks: readonly PreviewCheck[];
    readonly attempts: number;
  }> => {
    let checks: readonly PreviewCheck[] = [];
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts += 1;

      let probes: PreviewProbes | null = null;
      try {
        probes = await probe(aliasUrl);
      } catch {
        probes = null; // reaching a just-assigned alias can lag
      }

      if (probes) {
        const verification = verifyPreviewDeployment(probes);
        checks = verification.checks;
        if (verification.ok) return { ok: true, checks, attempts };
        if (!isTransientProbe(probes)) return { ok: false, checks, attempts };
      } else if (attempts >= maxAttempts) {
        checks = [
          {
            name: "access protection",
            ok: false,
            detail: `the alias host could not be reached after ${maxAttempts} attempts`,
          },
        ];
      }

      if (attempts < maxAttempts) await sleep(retryDelayMs);
    }
    return { ok: false, checks, attempts };
  };

  // From here the alias may have been mutated. Any failure — a lost response to
  // the assignment POST, a failed verification, or a thrown probe budget —
  // funnels into the same reconciliation.
  let checks: readonly PreviewCheck[] = [];
  let attempts = 0;
  try {
    const assignment = await assignPreviewAlias(
      ourId,
      aliasHost,
      input.settings,
      fetcher,
    );
    // `oldDeploymentId` is authoritative for what the alias atomically pointed
    // at — including a target an operator set between the read above and this
    // POST. Use it only if it still resolves to a live deployment in this
    // project; a stale or deleted id means rollback = remove the alias. If the
    // liveness check itself cannot complete, fall back to the pre-assignment
    // read.
    if (assignment.oldDeploymentId) {
      try {
        const live = await resolveDeploymentIfLive(
          assignment.oldDeploymentId,
          input.settings,
          fetcher,
        );
        restoreTarget = live?.id ?? null;
      } catch {
        restoreTarget = prior?.deploymentId ?? null;
      }
    } else {
      restoreTarget = null;
    }
    const verification = await verifyAlias();
    checks = verification.checks;
    attempts = verification.attempts;
    if (verification.ok) {
      return { kind: "assigned", previousTarget: restoreTarget, checks, attempts };
    }
  } catch (cause) {
    // The POST may still have been applied remotely before the response was
    // lost. Reconcile rather than exit with the alias in an unknown state.
    checks = [
      { name: "alias assignment", ok: false, detail: describeCause(cause) },
    ];
  }

  // Restore the prior target — but only while a fresh read positively confirms
  // the alias still points at what this run assigned. If a newer run has
  // published to it, leave it alone rather than undo that. If the read or the
  // restore itself throws, the alias state is unknown: report it loudly.
  let current: Awaited<ReturnType<typeof readAliasCurrentTarget>>;
  try {
    current = await readAliasCurrentTarget(aliasHost, input.settings, fetcher);
  } catch (cause) {
    return {
      kind: "unreconciled",
      detail: `could not read the alias after the assignment attempt: ${describeCause(cause)}`,
      checks,
      attempts,
    };
  }

  if (current === null) {
    return { kind: "restored", restoredTo: null, checks, attempts };
  }

  if (current.deploymentId !== ourId) {
    return {
      kind: "abandoned",
      movedOnTo: current.deploymentId,
      checks,
      attempts,
    };
  }

  try {
    if (restoreTarget) {
      await assignPreviewAlias(restoreTarget, aliasHost, input.settings, fetcher);
    } else {
      await deleteAlias(current.aliasUid, input.settings, fetcher);
    }
  } catch (cause) {
    return {
      kind: "unreconciled",
      detail: `the alias still points at the unverified deployment and the restore failed: ${describeCause(cause)}`,
      checks,
      attempts,
    };
  }
  return { kind: "restored", restoredTo: restoreTarget, checks, attempts };
}

/** The provider's documented header for Protection Bypass for Automation. */
const BYPASS_HEADER = "x-vercel-protection-bypass";
const PROBE_TIMEOUT_MS = 20_000;

/**
 * The one IO helper in this module. The orchestrator above is pure and takes a
 * probe injected; this builds the real one for the entry scripts, the same two
 * requests `verify-preview-deployment.mts` makes: one with no bypass header
 * (must be the SSO challenge) and one with it (must be 200 + `noindex`). The
 * body is never read; only status, `Location`, and `X-Robots-Tag` are.
 */
export function createAliasProbe(
  bypassSecret: string,
  fetcher: typeof fetch = fetch,
): AliasProbe {
  const request = async (
    aliasUrl: URL,
    headers: Record<string, string>,
  ): Promise<Response> =>
    fetcher(aliasUrl, {
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

  return async (aliasUrl: URL): Promise<PreviewProbes> => {
    const unauthenticated = await request(aliasUrl, {});
    const bypassed = await request(aliasUrl, { [BYPASS_HEADER]: bypassSecret });
    return {
      protectionStatus: unauthenticated.status,
      protectionLocation: unauthenticated.headers.get("location"),
      bypassStatus: bypassed.status,
      robotsTag: bypassed.headers.get("x-robots-tag"),
    };
  };
}

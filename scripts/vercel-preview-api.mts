/**
 * Minimal Vercel deployment API client for the Preview release-candidate gate.
 *
 * It deliberately exposes only deployment inspection and single-deployment
 * cleanup operations. The access token stays in the Authorization header,
 * response bodies are never logged, and every successful lookup is bound to
 * the expected customer-owned project and team by the pure validation
 * functions in `preview-verification.mts`.
 */
import {
  parseDeploymentId,
  parseDeploymentUrl,
  parsePreviewAliasHost,
  validateDeploymentIdentity,
  type VerifiedDeploymentIdentity,
} from "./preview-verification.mts";

const VERCEL_API_ORIGIN = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 20_000;

export type VercelPreviewApiSettings = {
  readonly token: string;
  readonly orgId: string;
  readonly projectId: string;
};

export class VercelApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "VercelApiError";
    this.status = status;
  }
}

function requiredSetting(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function readVercelPreviewApiSettings(
  environment: NodeJS.ProcessEnv = process.env,
): VercelPreviewApiSettings {
  return {
    token: requiredSetting(environment, "VERCEL_TOKEN"),
    orgId: requiredSetting(environment, "VERCEL_ORG_ID"),
    projectId: requiredSetting(environment, "VERCEL_PROJECT_ID"),
  };
}

function deploymentEndpoint(reference: string, orgId: string): URL {
  const endpoint = new URL(
    `/v13/deployments/${encodeURIComponent(reference)}`,
    VERCEL_API_ORIGIN,
  );
  endpoint.searchParams.set("teamId", orgId);
  return endpoint;
}

function apiEndpoint(pathname: string, orgId: string): URL {
  const endpoint = new URL(pathname, VERCEL_API_ORIGIN);
  endpoint.searchParams.set("teamId", orgId);
  return endpoint;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new VercelApiError(`Vercel ${context} response is not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Creation time in epoch milliseconds, or null when the provider's payload does
 * not carry a usable value. The monotonic guard treats an unknown time as "not
 * comparable" and falls back to the pipeline's exclusive lock rather than
 * refusing to run.
 */
function readCreatedAt(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = (payload as Record<string, unknown>).createdAt;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/** The project's own name, used to recognise its default production domain. */
function readProjectName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = (payload as Record<string, unknown>).name;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

/**
 * True only when Vercel explicitly labels the deployment `target: "production"`.
 * A preview deployment reports `null` (or `"preview"`), so an unknown value is
 * treated as *not* production — this refuses to repoint over a domain that is
 * demonstrably production, without false-positive-blocking a legitimate preview
 * alias.
 */
function readIsProductionTarget(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as Record<string, unknown>).target === "production";
}

async function requestDeployment(
  reference: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch,
): Promise<{ readonly response: Response; readonly payload?: unknown }> {
  const response = await fetcher(deploymentEndpoint(reference, settings.orgId), {
    headers: { Authorization: `Bearer ${settings.token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) return { response };

  if (!response.ok) {
    throw new VercelApiError(
      `Vercel deployment lookup failed with status ${response.status}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VercelApiError("Vercel deployment lookup returned invalid JSON");
  }

  return { response, payload };
}

/**
 * Resolves the captured generated URL through Vercel before any project secret
 * is sent to the deployment itself.
 */
export async function inspectPreviewDeployment(
  urlValue: string,
  settings: VercelPreviewApiSettings,
  expectedDeploymentId?: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  readonly url: URL;
  readonly deployment: VerifiedDeploymentIdentity;
  readonly createdAt: number | null;
  readonly projectName: string | null;
}> {
  const url = parseDeploymentUrl(urlValue);
  const result = await requestDeployment(url.hostname, settings, fetcher);

  if (result.response.status === 404) {
    throw new VercelApiError(
      "Vercel could not find that deployment in the expected team",
      404,
    );
  }

  const deployment = validateDeploymentIdentity(result.payload, {
    projectId: settings.projectId,
    ownerId: settings.orgId,
    url,
    deploymentId: expectedDeploymentId,
  });

  return {
    url,
    deployment,
    createdAt: readCreatedAt(result.payload),
    projectName: readProjectName(result.payload),
  };
}

/**
 * Points the stable Preview alias (AB#136) at exactly one immutable deployment
 * ID through Vercel's atomic alias-assignment endpoint: "If the desired alias
 * is already assigned to another deployment, then it will be removed from the
 * old deployment and assigned to the new one."
 *
 * The alias host is re-validated here, not only in the entry script — a direct
 * caller must not be able to point a custom domain at the deployment. The
 * caller passes a `dpl_` ID it has already bound to the project and team via
 * `inspectPreviewDeployment`. `oldDeploymentId` is validated as an immutable ID
 * before it is returned, because a later restore step consumes it.
 */
export async function assignPreviewAlias(
  deploymentIdValue: string,
  aliasHostValue: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch = fetch,
): Promise<{
  readonly uid: string;
  readonly alias: string;
  readonly oldDeploymentId: string | null;
}> {
  const id = parseDeploymentId(deploymentIdValue);
  const aliasHost = parsePreviewAliasHost(aliasHostValue);

  const response = await fetcher(
    apiEndpoint(`/v2/deployments/${encodeURIComponent(id)}/aliases`, settings.orgId),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ alias: aliasHost }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new VercelApiError(
      `Vercel alias assignment failed with status ${response.status}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VercelApiError("Vercel alias assignment returned invalid JSON");
  }

  const record = asRecord(payload, "alias assignment");
  const uid = typeof record.uid === "string" ? record.uid.trim() : "";
  if (!uid) {
    throw new VercelApiError("Vercel alias assignment response has no uid");
  }
  const assignedAlias =
    typeof record.alias === "string" ? record.alias.trim().toLowerCase() : "";
  if (assignedAlias !== aliasHost) {
    throw new VercelApiError(
      `Vercel assigned alias "${assignedAlias || "(none)"}", expected "${aliasHost}"`,
    );
  }

  const oldReference = record.oldDeploymentId;
  const oldDeploymentId =
    oldReference === undefined || oldReference === null
      ? null
      : parseDeploymentId(String(oldReference));

  return { uid, alias: aliasHost, oldDeploymentId };
}

/**
 * Reads which deployment the stable alias currently points at, and when that
 * deployment was created (for the monotonic backward-move guard). Returns null
 * when the alias is unassigned or points at a deployment Vercel no longer
 * knows — either way there is no healthy prior target to preserve.
 */
export async function readAliasCurrentTarget(
  aliasHostValue: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch = fetch,
): Promise<
  | {
      readonly aliasUid: string;
      readonly deploymentId: string;
      readonly createdAt: number | null;
      readonly isProductionTarget: boolean;
    }
  | null
> {
  const aliasHost = parsePreviewAliasHost(aliasHostValue);

  const aliasResponse = await fetcher(
    apiEndpoint(`/v4/aliases/${encodeURIComponent(aliasHost)}`, settings.orgId),
    {
      headers: { Authorization: `Bearer ${settings.token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (aliasResponse.status === 404) return null;

  if (!aliasResponse.ok) {
    throw new VercelApiError(
      `Vercel alias lookup failed with status ${aliasResponse.status}`,
      aliasResponse.status,
    );
  }

  let aliasPayload: unknown;
  try {
    aliasPayload = await aliasResponse.json();
  } catch {
    throw new VercelApiError("Vercel alias lookup returned invalid JSON");
  }

  const aliasRecord = asRecord(aliasPayload, "alias lookup");
  const aliasUid =
    typeof aliasRecord.uid === "string" ? aliasRecord.uid.trim() : "";
  if (!aliasUid) {
    throw new VercelApiError("Vercel alias lookup response has no uid");
  }
  const nested =
    typeof aliasRecord.deployment === "object" && aliasRecord.deployment !== null
      ? (aliasRecord.deployment as Record<string, unknown>).id
      : undefined;
  const deploymentReference =
    typeof aliasRecord.deploymentId === "string" && aliasRecord.deploymentId.trim()
      ? aliasRecord.deploymentId.trim()
      : typeof nested === "string" && nested.trim()
        ? nested.trim()
        : null;
  if (!deploymentReference) {
    throw new VercelApiError("Vercel alias is not assigned to a deployment");
  }
  const deploymentId = parseDeploymentId(deploymentReference);

  const inspected = await requestDeployment(deploymentId, settings, fetcher);
  if (inspected.response.status === 404) return null;

  validateDeploymentIdentity(inspected.payload, {
    projectId: settings.projectId,
    ownerId: settings.orgId,
    deploymentId,
  });

  return {
    aliasUid,
    deploymentId,
    createdAt: readCreatedAt(inspected.payload),
    isProductionTarget: readIsProductionTarget(inspected.payload),
  };
}

/**
 * Resolves an immutable deployment ID, returning `null` when Vercel no longer
 * knows it (a deleted deployment) and throwing when it belongs to another
 * project or team. Used to decide whether a reported previous alias target is a
 * deployment a rollback could actually reassign.
 */
export async function resolveDeploymentIfLive(
  deploymentIdValue: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly id: string; readonly createdAt: number | null } | null> {
  const id = parseDeploymentId(deploymentIdValue);
  const result = await requestDeployment(id, settings, fetcher);
  if (result.response.status === 404) return null;

  validateDeploymentIdentity(result.payload, {
    projectId: settings.projectId,
    ownerId: settings.orgId,
    deploymentId: id,
  });

  return { id, createdAt: readCreatedAt(result.payload) };
}

/**
 * Removes the stable alias entirely. Used only to undo a first assignment whose
 * post-assignment verification then failed, leaving no prior target to restore.
 * A missing alias is treated as already removed so the operation is idempotent.
 */
export async function deleteAlias(
  aliasUidValue: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly removed: boolean }> {
  const aliasUid = aliasUidValue.trim();
  if (!aliasUid || aliasUid.includes(".")) {
    throw new Error("Vercel alias uid must be a non-empty id, not a hostname");
  }

  const response = await fetcher(
    apiEndpoint(`/v2/aliases/${encodeURIComponent(aliasUid)}`, settings.orgId),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${settings.token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (response.status === 404) return { removed: false };
  if (!response.ok) {
    throw new VercelApiError(
      `Vercel alias deletion failed with status ${response.status}`,
      response.status,
    );
  }
  return { removed: true };
}

/**
 * Deletes exactly one immutable deployment ID. The ID is looked up and rebound
 * to the expected project and team immediately before deletion. A missing
 * deployment is treated as already clean so the operation is idempotent.
 */
export async function deletePreviewDeployment(
  deploymentIdValue: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly deleted: boolean; readonly id: string }> {
  const id = parseDeploymentId(deploymentIdValue);
  const inspected = await requestDeployment(id, settings, fetcher);

  if (inspected.response.status === 404) {
    return { deleted: false, id };
  }

  validateDeploymentIdentity(inspected.payload, {
    projectId: settings.projectId,
    ownerId: settings.orgId,
    deploymentId: id,
  });

  return deleteExactDeploymentId(id, settings, fetcher);
}

async function deleteExactDeploymentId(
  deploymentId: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch,
): Promise<{ readonly deleted: boolean; readonly id: string }> {
  const id = parseDeploymentId(deploymentId);
  const response = await fetcher(deploymentEndpoint(id, settings.orgId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${settings.token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) return { deleted: false, id };
  if (!response.ok) {
    throw new VercelApiError(
      `Vercel deployment deletion failed with status ${response.status}`,
      response.status,
    );
  }

  return { deleted: true, id };
}

/**
 * Recovery path for a deployment whose URL was captured but whose first
 * URL-to-ID lookup failed. The authenticated lookup still binds the URL to the
 * expected project and team, and the destructive request still receives only
 * the immutable ID returned by Vercel.
 */
export async function deletePreviewDeploymentFromUrl(
  urlValue: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch = fetch,
): Promise<
  | { readonly deleted: boolean; readonly id: string }
  | { readonly deleted: false; readonly id: null }
> {
  let identified: Awaited<ReturnType<typeof inspectPreviewDeployment>>;
  try {
    identified = await inspectPreviewDeployment(
      urlValue,
      settings,
      undefined,
      fetcher,
    );
  } catch (cause) {
    if (cause instanceof VercelApiError && cause.status === 404) {
      return { deleted: false, id: null };
    }
    throw cause;
  }

  return deleteExactDeploymentId(identified.deployment.id, settings, fetcher);
}

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
/** Local metadata budget, not a Vercel limit or universal capacity guarantee. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

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

type RequestPhase = "deployment lookup" | "alias lookup" | "alias assignment" | "alias deletion" | "deployment deletion";
type RequestAttempt = { readonly signal: AbortSignal; readonly expiresAt: number; readonly phase: RequestPhase };

function phaseMessage(phase: RequestPhase, detail: string): string {
  const mutation = phase === "alias assignment" || phase === "alias deletion" || phase === "deployment deletion";
  return `Vercel ${phase} ${detail}${mutation ? "; outcome unverified" : ""}`;
}

/** Only locally generated budget failures may bypass the fixed JSON error. */
class ResponseFailure extends VercelApiError {}

function observeCleanup(cleanup: () => unknown): void {
  try { void Promise.resolve(cleanup()).catch(() => {}); }
  catch { /* Cleanup never replaces or delays a classified result. */ }
}

function cancelResponse(response: Response): void {
  observeCleanup(() => response.body?.cancel());
}

/** One removable listener per wait; the monotonic clock also bounds timer starvation. */
function waitForOperation<T>(operation: () => Promise<T>, attempt: RequestAttempt, onLateValue?: (value: T) => void): Promise<T> {
  const { signal, expiresAt, phase } = attempt;
  const expired = () => signal.aborted || performance.now() >= expiresAt;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => { settled = true; signal.removeEventListener("abort", abort); };
    const abort = () => {
      if (settled) return;
      finish(); reject(new ResponseFailure(phaseMessage(phase, "request timed out")));
    };
    if (expired()) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    try {
      // Both handlers remain attached after timeout, observing late rejection
      // (including releaseLock rejecting a still-pending stream read).
      void operation().then(value => {
        if (settled) { observeCleanup(() => onLateValue?.(value)); return; }
        if (expired()) { abort(); observeCleanup(() => onLateValue?.(value)); return; }
        finish(); resolve(value);
      }, cause => {
        if (settled) return;
        if (expired()) { abort(); return; }
        finish(); reject(cause);
      });
    } catch (cause) {
      if (settled) return;
      if (expired()) { abort(); return; }
      finish(); reject(cause);
    }
  });
}

async function readStrictJsonResponse(response: Response, attempt: RequestAttempt): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    cancelResponse(response);
    throw new ResponseFailure(phaseMessage(attempt.phase, "response exceeds the local byte limit"));
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    reader = response.body?.getReader();
    const activeReader = reader;
    let bytes = new Uint8Array(0), length = 0;
    if (activeReader) for (;;) {
      const chunk = await waitForOperation(() => activeReader.read(), attempt);
      if (chunk.done) { complete = true; break; }
      if (chunk.value.byteLength > MAX_RESPONSE_BYTES - length) {
        throw new ResponseFailure(phaseMessage(attempt.phase, "response exceeds the local byte limit"));
      }
      const nextLength = length + chunk.value.byteLength;
      if (nextLength > bytes.byteLength) {
        const next = new Uint8Array(Math.min(MAX_RESPONSE_BYTES, Math.max(64 * 1024, bytes.byteLength * 2, nextLength)));
        next.set(bytes.subarray(0, length)); bytes = next;
      }
      bytes.set(chunk.value, length); length = nextLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } catch (cause) {
    // Unknown reader failures can be arbitrary objects, including hostile proxies.
    let owned = false;
    try { owned = cause instanceof ResponseFailure; } catch { /* untrusted cause */ }
    if (owned) throw cause;
    throw new VercelApiError(phaseMessage(attempt.phase, "returned invalid JSON"));
  } finally {
    const activeReader = reader;
    if (activeReader) {
      if (!complete) observeCleanup(() => activeReader.cancel());
      observeCleanup(() => activeReader.releaseLock());
    } else if (!complete) cancelResponse(response);
  }
}

/** Own the entire attempt so no caller can accidentally restart its body deadline. */
async function requestVercel(
  endpoint: URL,
  init: RequestInit,
  fetcher: typeof fetch,
  phase: RequestPhase,
  body: "json" | "discard",
): Promise<{ readonly status: number; readonly ok: boolean; readonly payload?: unknown }> {
  const attempt: RequestAttempt = {
    expiresAt: performance.now() + REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), phase,
  };
  // Preserve ordinary transport errors: the existing operator formatters already
  // withhold unknown causes, while retaining project-owned VercelApiError details.
  const response = await waitForOperation(() => fetcher(endpoint, { ...init, signal: attempt.signal }), attempt, cancelResponse);
  const { status, ok } = response;
  if (!ok || body === "discard") {
    cancelResponse(response);
    return { status, ok };
  }
  return { status, ok, payload: await readStrictJsonResponse(response, attempt) };
}

async function requestDeployment(
  reference: string,
  settings: VercelPreviewApiSettings,
  fetcher: typeof fetch,
): Promise<{ readonly status: number; readonly payload?: unknown }> {
  const response = await requestVercel(deploymentEndpoint(reference, settings.orgId), {
    headers: { Authorization: `Bearer ${settings.token}` },
    cache: "no-store",
    redirect: "error",
  }, fetcher, "deployment lookup", "json");

  if (response.status === 404) return { status: response.status };

  if (!response.ok) {
    throw new VercelApiError(
      `Vercel deployment lookup failed with status ${response.status}`,
      response.status,
    );
  }

  return { status: response.status, payload: response.payload };
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

  if (result.status === 404) {
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

  const response = await requestVercel(
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
    },
    fetcher, "alias assignment", "json",
  );

  if (!response.ok) {
    throw new VercelApiError(
      `Vercel alias assignment failed with status ${response.status}`,
      response.status,
    );
  }

  const record = asRecord(response.payload, "alias assignment");
  const uid = typeof record.uid === "string" ? record.uid.trim() : "";
  if (!uid) {
    throw new VercelApiError("Vercel alias assignment response has no uid");
  }
  const assignedAlias =
    typeof record.alias === "string" ? record.alias.trim().toLowerCase() : "";
  if (assignedAlias !== aliasHost) {
    throw new VercelApiError(
      "Vercel alias assignment returned a different alias; outcome unverified",
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

  const aliasResponse = await requestVercel(
    apiEndpoint(`/v4/aliases/${encodeURIComponent(aliasHost)}`, settings.orgId),
    {
      headers: { Authorization: `Bearer ${settings.token}` },
      cache: "no-store",
      redirect: "error",
    },
    fetcher, "alias lookup", "json",
  );

  if (aliasResponse.status === 404) return null;

  if (!aliasResponse.ok) {
    throw new VercelApiError(
      `Vercel alias lookup failed with status ${aliasResponse.status}`,
      aliasResponse.status,
    );
  }

  const aliasRecord = asRecord(aliasResponse.payload, "alias lookup");
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
  if (inspected.status === 404) return null;

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
  if (result.status === 404) return null;

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

  const response = await requestVercel(
    apiEndpoint(`/v2/aliases/${encodeURIComponent(aliasUid)}`, settings.orgId),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${settings.token}` },
      cache: "no-store",
      redirect: "error",
    },
    fetcher, "alias deletion", "discard",
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

  if (inspected.status === 404) {
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
  const response = await requestVercel(deploymentEndpoint(id, settings.orgId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${settings.token}` },
    cache: "no-store",
    redirect: "error",
  }, fetcher, "deployment deletion", "json");

  if (response.status === 404) return { deleted: false, id };
  if (!response.ok) {
    throw new VercelApiError(
      `Vercel deployment deletion failed with status ${response.status}`,
      response.status,
    );
  }

  const payload = response.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) ||
      (payload as Record<string, unknown>).uid !== id || (payload as Record<string, unknown>).state !== "DELETED") {
    throw new VercelApiError("Vercel deployment deletion returned an unverified acknowledgement");
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

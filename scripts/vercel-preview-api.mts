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
): Promise<{ readonly url: URL; readonly deployment: VerifiedDeploymentIdentity }> {
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

  return { url, deployment };
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

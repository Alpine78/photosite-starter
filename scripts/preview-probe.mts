/** Header-only Preview probe. Its caller must verify ownership before supplying a bypass. */
import { VercelApiError } from "./vercel-preview-api.mts";

export function describePreviewFailure(cause: unknown): string {
  try {
    if (cause instanceof VercelApiError) return cause.message;
  } catch { /* unknown thrown objects need not support inspection */ }
  return "request failed; details withheld";
}

export async function probePreviewDeployment(
  url: URL,
  headers: Record<string, string>,
  send: typeof fetch = fetch,
): Promise<{ readonly status: number; readonly location: string | null; readonly robotsTag: string | null }> {
  const response = await send(url, {
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  // Bodies are deliberately excluded from retained verification evidence.
  return { status: response.status, location: response.headers.get("location"), robotsTag: response.headers.get("x-robots-tag") };
}

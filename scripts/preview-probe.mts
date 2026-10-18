/** Header-only Preview probe. Its caller must verify ownership before supplying a bypass. */
import { VercelApiError } from "./vercel-preview-api.mts";

const PROBE_TIMEOUT_MS = 20_000;

/** No reader is owned here: locked/absent bodies are best-effort cleanup only. */
function discardBody(response: Response | undefined): void {
  try {
    void Promise.resolve(response?.body?.cancel()).catch(() => {});
  } catch { /* cleanup cannot replace the header result or original failure */ }
}

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
  const expiresAt = performance.now() + PROBE_TIMEOUT_MS;
  const expired = () => performance.now() >= expiresAt;
  const timeout = () => new VercelApiError("Preview probe timed out");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined;
  try {
    response = await new Promise<Response>((resolve, reject) => {
      let finished = false;
      // Keep this timer referenced: even an injected fetch with no active IO
      // must settle. Clear it on every exit rather than leaving a native signal timer.
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(timeout());
        controller.abort();
      }, Math.max(0, expiresAt - performance.now()));
      if (expired()) { finished = true; reject(timeout()); return; }
      let pending: Promise<Response>;
      try {
        pending = send(url, { headers, redirect: "manual", cache: "no-store", signal: controller.signal });
      } catch (cause) {
        finished = true;
        reject(expired() ? timeout() : cause);
        return;
      }
      void Promise.resolve(pending).then(value => {
        if (finished) { discardBody(value); return; }
        finished = true;
        if (expired()) { discardBody(value); reject(timeout()); }
        else resolve(value);
      }, cause => {
        if (!finished) { finished = true; reject(expired() ? timeout() : cause); }
      });
    });
    if (expired()) throw timeout();
    // Bodies are deliberately excluded from retained verification evidence.
    const result = { status: response.status, location: response.headers.get("location"), robotsTag: response.headers.get("x-robots-tag") };
    if (expired()) throw timeout();
    return result;
  } finally {
    clearTimeout(timer);
    discardBody(response);
  }
}

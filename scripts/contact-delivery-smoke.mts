/** AB#117: one synthetic application request; mailbox arrival is separate evidence. */
import { parseVerificationOrigin } from "./legacy-redirect-verification.mts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function contactSmokePlan(originInput: string, submissionId: string) {
  const origin = parseVerificationOrigin(originInput);
  if (!UUID.test(submissionId)) throw new Error("CONTACT_SMOKE_ID");
  return { origin, submissionId, endpoint: `${origin}/api/contact`,
    body: { submissionId, name: "Release verification", email: "release-verification@example.com", company: "", subject: "__other__",
      message: `Julkaisun toimitustesti / Release delivery verification: ${submissionId}. Synthetic test message, no customer enquiry. Please confirm arrival and Reply-To.` } } as const;
}

function cleanup(cancel: () => Promise<unknown> | undefined) {
  try { void cancel()?.catch(() => {}); } catch { /* Cleanup must stay bounded. */ }
}

/** Never retries. Network/acknowledgement failure may still have delivered a message. */
export async function sendContactSmoke(originInput: string, submissionId: string,
  options: { fetchImplementation?: typeof fetch; timeoutMs?: number } = {}) {
  const plan = contactSmokePlan(originInput, submissionId);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("CONTACT_SMOKE_TIMEOUT");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>, finished = false;
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, timeoutMs);
  });
  void deadline.catch(() => {});
  const base = { version: 1, origin: plan.origin, submissionId, observedAt: new Date().toISOString(),
    mailboxArrivalVerified: false, replyToVerified: false, canonicalLaunchVerified: false, automaticRetry: false } as const;
  try {
    const pending = Promise.resolve().then(() => (options.fetchImplementation ?? fetch)(plan.endpoint, {
      method: "POST", redirect: "manual", credentials: "omit", signal: controller.signal,
      headers: { origin: plan.origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify(plan.body),
    })).then((saved) => { if (finished) cleanup(() => saved.body?.cancel()); return saved; });
    response = await Promise.race([pending, deadline]);
    const status = response.status;
    if (status !== 200) return { ...base, status: "unverified" as const, httpStatus: status, reason: "http" as const };
    if (response.headers.get("cache-control") !== "no-store" ||
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" ||
      response.headers.has("access-control-allow-origin") || !response.body) {
      return { ...base, status: "ambiguous" as const, httpStatus: status, reason: "headers" as const };
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) return { ...base, status: "ambiguous" as const, httpStatus: status, reason: "response" as const };
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !("status" in value) || value.status !== "delivered" ||
      !("correlationId" in value) || typeof value.correlationId !== "string" || !UUID.test(value.correlationId)) {
      return { ...base, status: "ambiguous" as const, httpStatus: status, reason: "response" as const };
    }
    return { ...base, status: "provider-accepted" as const, httpStatus: status, correlationId: value.correlationId };
  } catch {
    return { ...base, status: "ambiguous" as const, reason: "request-or-response" as const };
  } finally {
    finished = true; clearTimeout(timer!); controller.abort();
    if (reader) {
      const saved = reader; cleanup(() => saved.cancel());
      try { saved.releaseLock(); } catch { /* In-flight read already observed. */ }
    } else if (response) { const saved = response; cleanup(() => saved.body?.cancel()); }
  }
}

#!/usr/bin/env node
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { htmlHasMarkers, parseAvailabilityConfig, type AvailabilityCheck } from "./availability-probe.mts";
type Failure = "timeout" | "request-failed" | "unexpected-redirect" | "not-200" | "not-html" | "body-too-large" | "body-invalid" | "body-failed" | "missing-marker";
class ProbeFailure extends Error {
  readonly code: Failure;
  constructor(code: Failure) { super(code); this.code = code; }
}
export async function probeAvailability(check: AvailabilityCheck, options: { fetch: typeof fetch; timeoutMs: number; maxBytes: number }) {
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined;
  let stage: Failure = "request-failed";
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new ProbeFailure("timeout")); controller.abort(); }, options.timeoutMs); });
  const bounded = <T,>(promise: Promise<T>) => Promise.race([promise, deadline]);
  try {
    response = await bounded(options.fetch(check.url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { accept: "text/html" } }));
    if ([301, 308].includes(response.status)) {
      let target: string | undefined;
      try { const location = response.headers.get("location"); if (location) target = new URL(location, check.url).href; } catch { /* fixed refusal below */ }
      if (!check.canonicalUrl || target !== check.canonicalUrl) throw new ProbeFailure("unexpected-redirect");
      void response.body?.cancel().catch(() => {});
      response = await bounded(options.fetch(check.canonicalUrl, { method: "GET", redirect: "manual", signal: controller.signal, headers: { accept: "text/html" } }));
    }
    if (response.status >= 300 && response.status < 400) throw new ProbeFailure("unexpected-redirect");
    if (response.status !== 200) throw new ProbeFailure("not-200");
    if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new ProbeFailure("not-html");
    stage = "body-failed"; let bytes = 0, html = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    reader = response.body?.getReader();
    if (reader) while (true) {
      const { done, value } = await bounded(reader.read()); if (done) break;
      bytes += value.byteLength; if (bytes > options.maxBytes) throw new ProbeFailure("body-too-large");
      try { html += decoder.decode(value, { stream: true }); } catch { throw new ProbeFailure("body-invalid"); }
    }
    try { html += decoder.decode(); } catch { throw new ProbeFailure("body-invalid"); }
    if (!htmlHasMarkers(html, check)) throw new ProbeFailure("missing-marker");
    return { status: "healthy", code: "markers-present" } as const;
  } catch (error) { return { status: "unhealthy", code: error instanceof ProbeFailure ? error.code : stage } as const; }
  finally {
    clearTimeout(timer); controller.abort();
    // Cancellation may itself stall; do not let cleanup defeat the total deadline.
    if (reader) void reader.cancel().catch(() => {}); else void response?.body?.cancel().catch(() => {});
  }
}
async function main() {
  const args = process.argv.slice(2); if (args.length !== 1) throw new Error();
  const file = await open(args[0], "r"); let raw: string;
  try {
    const bytes = Buffer.alloc(65_537); let length = 0;
    while (length < bytes.length) { const part = await file.read(bytes, length, bytes.length - length); if (!part.bytesRead) break; length += part.bytesRead; }
    if (length > 65_536) throw new Error(); raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await file.close(); }
  const config = parseAvailabilityConfig(JSON.parse(raw));
  const results = [];
  for (const [index, check] of config.checks.entries()) results.push({ index, ...await probeAvailability(check, { ...config, fetch }) });
  console.log(JSON.stringify({ schemaVersion: 1, results }, null, 2)); if (results.some((result) => result.status !== "healthy")) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("Invalid availability configuration. Usage: check:availability -- <config.json>"); process.exitCode = 2; });

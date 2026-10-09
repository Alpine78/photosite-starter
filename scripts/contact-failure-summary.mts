/** AB#205: bare application emitter NDJSON only. Never project input strings. */
import type { ContactErrorClass, EnquiryErrorClass, ContactEvent, EnquiryEvent } from "../src/lib/contact-log.ts";
const contactClasses = {
  "unsupported-media-type": false, "payload-too-large": false, "cross-origin": false,
  "malformed-body": false, "invalid-fields": false, "rate-limited": false, honeypot: false,
  configuration: true, "provider-rejected": true, "provider-quota-exceeded": true,
  "provider-unavailable": true, timeout: true,
} satisfies Record<ContactErrorClass, boolean>;
const enquiryClasses = {
  ...contactClasses, "malformed-request": false, "unknown-item": false,
  "container-unavailable": false, "not-public": false, "not-enquirable": false,
  "dynamic-unsupported": false, "source-unavailable": true, "source-error": true,
  "malformed-source": true, internal: true,
} satisfies Record<EnquiryErrorClass, boolean>;
const states = { accepted: 0, delivered: 0, rejected: 0, "delivery-failed": 0 } satisfies Record<ContactEvent["state"] | EnquiryEvent["state"], number>;
export const FAILURE_INPUT_LIMITS = { bytes: 4 * 1024 * 1024, recordBytes: 65_536, correlations: 10_000, records: 40_000 } as const;
export function summarizeContactFailures(input: string) {
  const family = (classes: Record<string, boolean>) => ({ states: { ...states }, errorClasses: Object.fromEntries(Object.keys(classes).map((key) => [key, 0])), failures: 0, expectedRefusals: 0 });
  const counts = { contact: family(contactClasses), enquiry: family(enquiryClasses) };
  let invalidRecords = 0, duplicateEvents = 0, incompleteCorrelations = 0;
  const correlations = new Map<string, { accepted: boolean; terminal?: string; delivery?: boolean }>();
  const result = () => ({ schemaVersion: 1, status: invalidRecords ? "invalid" : incompleteCorrelations ? "incomplete" : counts.contact.failures + counts.enquiry.failures ? "failures" : "complete", counts, invalidRecords, duplicateEvents, incompleteCorrelations, correlations: correlations.size });
  if (!input || Buffer.byteLength(input, "utf8") > FAILURE_INPUT_LIMITS.bytes) { invalidRecords++; return result(); }
  if (!input.endsWith("\n")) invalidRecords++;
  const lines = input.split("\n"); if (input.endsWith("\n")) lines.pop();
  if (lines.length > FAILURE_INPUT_LIMITS.records) { invalidRecords++; return result(); }
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > FAILURE_INPUT_LIMITS.recordBytes) { invalidRecords++; continue; }
    let event: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      event = value as Record<string, unknown>;
    } catch { invalidRecords++; continue; }
    const selected = event.event === "contact.submission" ? "contact" : event.event === "enquiry.submission" ? "enquiry" : undefined;
    const classes: Record<string, boolean> = selected === "contact" ? contactClasses : enquiryClasses;
    const state = event.state;
    const terminal = state === "delivered" || state === "rejected" || state === "delivery-failed";
    const failureState = state === "rejected" || state === "delivery-failed";
    if (!selected || typeof state !== "string" || !Object.hasOwn(states, state) || typeof event.correlationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(event.correlationId) || Object.keys(event).some((key) => !["event", "correlationId", "state", "errorClass"].includes(key)) ||
        (failureState ? typeof event.errorClass !== "string" || !Object.hasOwn(classes, event.errorClass) : Object.hasOwn(event, "errorClass"))) { invalidRecords++; continue; }
    const key = `${selected}:${event.correlationId}`;
    const current = correlations.get(key) ?? { accepted: false };
    if (!correlations.has(key) && correlations.size >= FAILURE_INPUT_LIMITS.correlations) { invalidRecords++; continue; }
    const signature = JSON.stringify([state, event.errorClass]);
    if (terminal && current.terminal !== undefined) {
      if (current.terminal === signature) duplicateEvents++; else invalidRecords++;
      continue;
    }
    if (state === "accepted" && current.accepted) { duplicateEvents++; continue; }
    if (terminal) { current.terminal = signature; current.delivery = state === "delivered" || state === "delivery-failed"; } else current.accepted = true;
    correlations.set(key, current);
    counts[selected].states[state as keyof typeof states]++;
    if (failureState) {
      const errorClass = event.errorClass as string;
      counts[selected].errorClasses[errorClass]++;
      if (state === "delivery-failed" || classes[errorClass]) counts[selected].failures++;
      else counts[selected].expectedRefusals++;
    }
  }
  incompleteCorrelations = [...correlations.values()].filter((value) => (value.accepted && value.terminal === undefined) || (!value.accepted && value.delivery)).length;
  return result();
}

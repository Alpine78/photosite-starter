import { describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { createClientGalleryCleanupTransport } from "../src/lib/client-gallery-cleanup-transport";

const instant = "2026-10-24T10:00:00.000Z";
const config = { projectId: "synthetic", dataset: "production", apiVersion: "v2026-10-20", token: "synthetic-cleanup-token" };
const base = { _id: "clientGalleryCleanup.synthetic", _type: "clientGalleryCleanup", state: "enrolled", policy: { expiryInstant: instant } };
async function advisory(dataset: Record<string, unknown>[]): Promise<boolean> {
  const send = vi.fn().mockImplementation(async (input: string) => {
    const url = new URL(input);
    const query = url.searchParams.get("query")!;
    const result = await (await evaluate(parse(query), { dataset, params: { now: JSON.parse(url.searchParams.get("$now")!) } })).get();
    return new Response(JSON.stringify({ result }), { headers: { date: new Date(instant).toUTCString() } });
  });
  return createClientGalleryCleanupTransport(config, { fetch: send, now: () => Date.parse(instant) }).due(instant);
}

describe("cleanup advisory discovery uses the real GROQ query", () => {
  it.each([
    base,
    { ...base, state: "pending", policy: { expiryInstant: "2099-01-01T00:00:00.000Z" } },
    { ...base, state: "unexpected" },
    { ...base, state: undefined },
    { ...base, policy: undefined },
    { ...base, policy: { expiryInstant: undefined } },
    { ...base, policy: { expiryInstant: "invalid" } },
    { ...base, policy: { expiryInstant: 123 } },
    { ...base, _type: "incorrectControlType" },
    { ...base, _id: "unrecognized-control-id" },
  ])("discovers due, pending and malformed active controls (%j)", async (control) => {
    expect(await advisory([control])).toBe(true);
  });
  it.each([
    { ...base, state: "complete" },
    { ...base, state: "disabled" },
    { ...base, policy: { expiryInstant: "2026-10-24T10:00:01.000Z" } },
    { ...base, _id: "ordinary", _type: "gallery" },
    { _id: "clientGalleryCleanupCursor.daily", _type: "clientGalleryCleanupCursor", after: "" },
    { _id: "clientGalleryCleanupCursor.daily", _type: "incorrectCursorType" },
    { _id: "clientGalleryCleanupOther.example", _type: "unrelatedOperationalRecord" },
  ])("avoids exports for inactive, future and unrelated documents (%j)", async (control) => {
    expect(await advisory([control])).toBe(false);
  });
  it("does not scan an empty dataset as due work", async () => {
    expect(await advisory([])).toBe(false);
  });
  it("an existing cursor cannot turn an otherwise idle dataset into due work", async () => {
    const cursor = { _id: "clientGalleryCleanupCursor.daily", _type: "clientGalleryCleanupCursor", after: "" };
    expect(await advisory([cursor, { ...base, policy: { expiryInstant: "2027-01-01T00:00:00.000Z" } }])).toBe(false);
    expect(await advisory([cursor, base])).toBe(true);
  });
});

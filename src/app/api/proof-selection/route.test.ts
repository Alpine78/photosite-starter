import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const facade = vi.hoisted(() => ({ runProofSelection: vi.fn() }));
vi.mock("@/lib/proof-selection-access", () => facade);
import { POST } from "./route";

const handle = "c".repeat(32), key = "K".repeat(43);
const enabled = { PROOF_SELECTION: "enabled", PROOF_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "public",
  SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production", SANITY_PROOF_SELECTION_TOKEN: "t".repeat(40) };
let address = 0;
function request({ body = { operation: "read", handle, key } as unknown, origin = "https://site.example", type = "application/json", raw }: { body?: unknown; origin?: string; type?: string; raw?: string } = {}) {
  return new Request("https://site.example/api/proof-selection", {
    method: "POST", headers: { host: "site.example", origin, "Content-Type": type, "x-forwarded-for": `203.0.113.${++address % 250}` },
    body: raw ?? JSON.stringify(body),
  });
}
const selection = { state: "open", revision: null, references: [], stale: false, includedCount: 1, extraUnitPriceMinor: 0, currency: "EUR", selectedCount: 0, extraCount: 0, extraTotalMinor: 0 };
beforeEach(() => {
  for (const [name, value] of Object.entries(enabled)) vi.stubEnv(name, value);
  facade.runProofSelection.mockReset().mockResolvedValue({ outcome: "ok", selection });
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("proof selection route boundaries", () => {
  it("does not exist while off and is unavailable while misconfigured, without touching the facade", async () => {
    vi.stubEnv("PROOF_SELECTION", "");
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("PROOF_SELECTION", "enabled"); vi.stubEnv("NEXT_PUBLIC_SANITY_PROOF_SELECTION_TOKEN", "leak");
    expect((await POST(request())).status).toBe(503);
    expect(facade.runProofSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["cross origin", { origin: "https://elsewhere.example" }, 403],
    ["wrong type", { type: "text/plain" }, 415],
    ["malformed JSON", { raw: "{" }, 400],
    ["an extra field", { body: { operation: "read", handle, key, galleryId: "g1" } }, 400],
    ["an oversized body", { raw: JSON.stringify({ operation: "read", handle, key, pad: "x".repeat(9000) }) }, 400],
  ])("refuses %s before the facade", async (_name, options, status) => {
    expect((await POST(request(options))).status).toBe(status);
    expect(facade.runProofSelection).not.toHaveBeenCalled();
  });

  it("answers no-store JSON and passes the parsed request with the server token", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toMatchObject({ status: "ok", selection });
    expect(facade.runProofSelection).toHaveBeenCalledWith({ operation: "read", handle, key }, "t".repeat(40), expect.objectContaining({ galleryAllowed: expect.any(Function) }));
  });

  it.each([
    [{ outcome: "unavailable" }, 404, { status: "unavailable" }],
    [{ outcome: "rejected", reason: "conflict", selection }, 409, { status: "rejected", reason: "conflict", selection }],
    [{ outcome: "rejected", reason: "empty", selection }, 422, { status: "rejected", reason: "empty" }],
    [{ outcome: "rate-limited" }, 429, { reason: "rate-limited", retryable: true }],
    [{ outcome: "unknown" }, 503, { status: "unknown" }],
    [{ outcome: "stopped" }, 200, { status: "stopped" }],
    [{ outcome: "committed", written: "confirmed" }, 202, { status: "committed", written: "confirmed" }],
    [{ outcome: "failed", reason: "malformed-record" }, 503, { status: "failed", retryable: false }],
  ])("maps %j", async (result, status, body) => {
    facade.runProofSelection.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject(body);
  });

  it("never echoes the key or the handle in an answer or a log line", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line) => { lines.push(String(line)); });
    vi.spyOn(console, "error").mockImplementation((line) => { lines.push(String(line)); });
    facade.runProofSelection.mockResolvedValue({ outcome: "unavailable" });
    const text = await (await POST(request())).text();
    for (const secret of [key, handle]) { expect(text).not.toContain(secret); expect(lines.join("\n")).not.toContain(secret); }
    expect(lines.join("\n")).toContain("proof.selection");
  });

  it("limits a client before reading the body", async () => {
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 125 && !limited; attempt++) {
      const response = await POST(new Request("https://site.example/api/proof-selection", {
        method: "POST", headers: { host: "site.example", origin: "https://site.example", "Content-Type": "application/json", "x-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({ operation: "read", handle, key }),
      }));
      if (response.status === 429) limited = response;
    }
    expect(limited?.status).toBe(429);
  });
});

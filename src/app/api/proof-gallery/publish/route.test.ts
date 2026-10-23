import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ runProofPublication: vi.fn() }));
vi.mock("@/lib/proof-publication-access", () => access);
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => ({ localeRoutes: { locales: [{ locale: "fi" }, { locale: "en-GB" }] } }) }));
import { OPTIONS, POST } from "./route";

const studio = "https://studio.example.com";
const token = "editor-session-token-0123456789";
const key = Buffer.alloc(32, 5).toString("base64url");
let address = 0;
function request(method: "POST" | "OPTIONS", options: { origin?: string | null; type?: string; auth?: string | null; body?: unknown; preflightMethod?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": `198.51.100.${++address}` };
  const origin = options.origin === undefined ? studio : options.origin;
  if (origin !== null) headers.origin = origin;
  if (method === "POST") {
    headers["content-type"] = options.type ?? "application/json";
    const auth = options.auth === undefined ? `Bearer ${token}` : options.auth;
    if (auth !== null) headers.authorization = auth;
  } else headers["access-control-request-method"] = options.preflightMethod ?? "POST";
  return new Request("https://site.example/api/proof-gallery/publish", {
    method, headers, ...(method === "POST" ? { body: JSON.stringify(options.body ?? { galleryId: "g1", operation: "publish", expectedDraftRevision: "rev1" }) } : {}),
  });
}
const logs: string[] = [];
beforeEach(() => {
  vi.clearAllMocks(); logs.length = 0;
  vi.stubEnv("PROOF_PUBLICATION", "enabled");
  vi.stubEnv("PROOF_PUBLICATION_STUDIO_ORIGINS", studio);
  vi.stubEnv("PROOF_SELECTION_KEY_SECRET", Buffer.alloc(32, 3).toString("base64url"));
  vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(line); });
  vi.spyOn(console, "error").mockImplementation((line: string) => { logs.push(line); });
  access.runProofPublication.mockResolvedValue({ outcome: "committed", firstPublication: true, selectionKey: key });
});
afterEach(() => vi.unstubAllEnvs());

describe("proof publication route (ADR-0038 amendment 2026-10-22)", () => {
  it("does not exist unless enabled and is unavailable when misconfigured", async () => {
    vi.stubEnv("PROOF_PUBLICATION", "");
    const off = await POST(request("POST"));
    expect(off.status).toBe(404);
    expect(off.headers.get("access-control-allow-origin")).toBeNull();
    expect((await OPTIONS(request("OPTIONS"))).status).toBe(404);
    vi.stubEnv("PROOF_PUBLICATION", "enabled");
    vi.stubEnv("PROOF_SELECTION_KEY_SECRET", "short");
    expect((await POST(request("POST"))).status).toBe(503);
    expect(access.runProofPublication).not.toHaveBeenCalled();
  });
  it("answers a preflight only for the Studio origin and POST", async () => {
    const allowed = await OPTIONS(request("OPTIONS"));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(studio);
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
    expect((await OPTIONS(request("OPTIONS", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await OPTIONS(request("OPTIONS", { preflightMethod: "DELETE" }))).status).toBe(403);
  });
  it.each([
    ["another origin", { origin: "https://evil.example" }, 403, false],
    ["no origin", { origin: null }, 403, false],
    ["a non-JSON body", { type: "text/plain" }, 415, true],
    ["no token", { auth: null }, 401, true],
    ["a malformed token", { auth: "Basic abc" }, 401, true],
    ["a malformed body", { body: { galleryId: "drafts.g1", operation: "publish" } }, 400, true],
  ])("refuses %s before any Sanity call", async (_name, options, status, cors) => {
    const response = await POST(request("POST", options as Parameters<typeof request>[1]));
    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBe(cors ? studio : null);
    expect(access.runProofPublication).not.toHaveBeenCalled();
  });
  it("returns the key once after a committed first publication, never logging token or key", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(studio);
    expect(await response.json()).toMatchObject({ status: "published", firstPublication: true, selectionKey: key });
    expect(access.runProofPublication).toHaveBeenCalledWith({ galleryId: "g1", operation: "publish", expectedDraftRevision: "rev1" }, token, expect.any(Buffer));
    expect(logs.join("\n")).not.toContain(token);
    expect(logs.join("\n")).not.toContain(key);
    expect(logs.join("\n")).not.toContain("g1");
  });
  it.each([
    [{ outcome: "rejected", reason: "not-found" }, 404],
    [{ outcome: "rejected", reason: "invalid-references" }, 422],
    [{ outcome: "rejected", reason: "inconsistent" }, 409],
    [{ outcome: "rejected", reason: "stale-draft" }, 409],
    [{ outcome: "rejected", reason: "terms-required" }, 422],
    [{ outcome: "rejected", reason: "rate-limited" }, 429],
    [{ outcome: "failed", reason: "unauthenticated" }, 401],
    [{ outcome: "failed", reason: "forbidden" }, 403],
    [{ outcome: "failed", reason: "conflict" }, 409],
    [{ outcome: "failed", reason: "store-unavailable" }, 503],
  ])("maps %o without a key", async (result, status) => {
    access.runProofPublication.mockResolvedValueOnce(result);
    const response = await POST(request("POST"));
    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty("selectionKey");
  });
  it("answers an unexpected failure as internal without details", async () => {
    access.runProofPublication.mockRejectedValueOnce(new Error(`boom ${token}`));
    const response = await POST(request("POST"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
  });

  it("refuses a reminder language this site does not offer, before the publication runs", async () => {
    const terms = { includedCount: 1, extraUnitPriceMinor: 0, currency: "EUR", jobReference: "j", reminder: { delayDays: 7, customerEmail: "a@example.fi", locale: "sv" } };
    const response = await POST(request("POST", { body: { galleryId: "g1", operation: "publish", expectedDraftRevision: "rev1", terms } }));
    expect(response.status).toBe(400);
    expect(access.runProofPublication).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/client-gallery-cleanup-config", () => ({ readClientGalleryCleanupConfig: mocks.config }));
vi.mock("@/lib/client-gallery-cleanup-access", () => ({ runConfiguredClientGalleryCleanup: mocks.run }));
import { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, maxDuration } from "./route";
const request = (authorization?: string) => new Request("https://example.invalid/api/client-gallery-cleanup", { headers: authorization ? { authorization } : {} });
afterEach(() => vi.resetAllMocks());
describe("cleanup cron boundary", () => {
  it("returns off/config failure before starting any provider work", async () => {
    for (const [state, status] of [["disabled", 404], ["misconfigured", 503]] as const) {
      mocks.config.mockReturnValue({ state });
      const response = await GET(request());
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("authenticates exact bearer before provider access", async () => {
    mocks.config.mockReturnValue({ state: "enabled", cronSecret: "synthetic-secret-123456" });
    for (const auth of [undefined, "synthetic-secret-123456", "Bearer wrong", "bearer synthetic-secret-123456", "Bearer synthetic-secret-123457"]) expect((await GET(request(auth))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
    mocks.run.mockResolvedValue({ examined: 1, completed: 1, blocked: 0, deletedZips: 1, sharedZips: 0 });
    const response = await GET(request("Bearer synthetic-secret-123456"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ok", examined: 1, completed: 1, blocked: 0, deletedZips: 1, sharedZips: 0 });
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it("returns failure without leaking provider exceptions", async () => {
    mocks.config.mockReturnValue({ state: "enabled", cronSecret: "synthetic-secret-123456" });
    mocks.run.mockRejectedValue(new Error("private-title-email-token-canary"));
    const response = await GET(request("Bearer synthetic-secret-123456"));
    expect(response.status).toBe(503); expect(await response.text()).toBe('{"status":"failed"}');
  });
  it("HEAD and other methods never delegate to mutating GET", () => {
    expect(maxDuration).toBe(200);
    for (const method of [HEAD, POST, PUT, PATCH, DELETE, OPTIONS]) {
      const response = method(); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
    }
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
});

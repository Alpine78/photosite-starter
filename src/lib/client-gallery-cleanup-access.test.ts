import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ due: vi.fn(), snapshot: vi.fn(), read: vi.fn(), mutate: vi.fn(), run: vi.fn(), create: vi.fn() }));
vi.mock("./client-gallery-cleanup-runner", () => ({ CLEANUP_HARD_DEADLINE_MS: 185_000, CleanupRunError: class extends Error {}, runClientGalleryCleanup: mocks.run }));
vi.mock("./client-gallery-cleanup-transport", () => ({ createClientGalleryCleanupTransport: mocks.create, CleanupTransportError: class extends Error {} }));
import { runConfiguredClientGalleryCleanup } from "./client-gallery-cleanup-access";
const config = { state: "enabled" as const, sanity: { projectId: "example123", dataset: "production", datasetVisibility: "public" as const, apiVersion: "v2026-06-24" },
  token: "synthetic-token-canary", cronSecret: "synthetic-secret-canary", limits: { maxExportBytes: 67108864, maxDocuments: 100000, exportTimeoutMs: 30000 } };
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
describe("configured cleanup orchestration", () => {
  function prepare() {
    mocks.create.mockReturnValue({ due: mocks.due, snapshot: mocks.snapshot, read: mocks.read, mutate: mocks.mutate });
    return vi.spyOn(console, "info").mockImplementation(() => {});
  }
  it("avoids a private dataset export when the advisory due query is false", async () => {
    const log = prepare(); mocks.due.mockResolvedValue(false);
    expect(await runConfiguredClientGalleryCleanup(config)).toMatchObject({ examined: 0, attempts: 0, deletedZips: 0, sharedZips: 0 });
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/synthetic-token|synthetic-secret|example123/u);
    expect((mocks.due.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  });
  it("bounds eligibility by provider time and passes the shared deadline through every IO", async () => {
    prepare(); mocks.due.mockResolvedValue(true);
    const providerTime = Date.now() - 20_000;
    mocks.snapshot.mockResolvedValue({ providerTime });
    mocks.run.mockImplementation(async (dependencies) => {
      expect(dependencies.expiryNow()).toBeLessThanOrEqual(providerTime);
      expect(dependencies.now()).toBeGreaterThan(providerTime);
      expect(dependencies.remainingMs()).toBeLessThanOrEqual(185_000);
      await dependencies.read(["synthetic-id"]); await dependencies.mutate([]);
      return { examined: 1, blocked: 1 };
    });
    await runConfiguredClientGalleryCleanup(config);
    const signal = mocks.snapshot.mock.calls[0][0];
    expect(mocks.read.mock.calls[0][1].signal).toBe(signal); expect(mocks.mutate.mock.calls[0][1]).toBe(signal);
    expect(signal.aborted).toBe(true);
  });
  it("logs and throws a closed failure without the provider's body", async () => {
    prepare(); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.due.mockRejectedValue(new Error("customer-email-title-token-provider-canary"));
    await expect(runConfiguredClientGalleryCleanup(config)).rejects.toThrow("Client gallery cleanup failed");
    expect(JSON.stringify(log.mock.calls)).toContain("internal_error");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/customer-email|provider-canary|synthetic-token/u);
  });
});

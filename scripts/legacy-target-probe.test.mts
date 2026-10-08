import { describe, expect, it, vi } from "vitest";
import { createLegacyTargetProbe } from "./legacy-target-probe.mts";

describe("per-run legacy target probe memo", () => {
  it("retains one failed attempt for every sequential source sharing the exact target", async () => {
    const probe = vi.fn(async () => { throw new Error("fixture transport failure"); }); const target = createLegacyTargetProbe(probe);
    const outcomes = [];
    for (let row = 0; row < 3; row++) {
      try { await target("https://fixture.example/target"); outcomes.push("available"); } catch { outcomes.push("probe-failed"); }
    }
    expect(outcomes).toEqual(["probe-failed", "probe-failed", "probe-failed"]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("https://fixture.example/target", true);
  });
  it("shares an in-flight successful response and keeps exact URL keys distinct", async () => {
    const response = { status: 200, html: "fixture" }; const probe = vi.fn(async () => response); const target = createLegacyTargetProbe(probe);
    const first = target("https://fixture.example/target?one=1");
    expect(target("https://fixture.example/target?one=1")).toBe(first);
    expect(await first).toBe(response);
    expect(await target("https://fixture.example/target?one=1")).toBe(response);
    await target("https://fixture.example/target?one=2");
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it("retries on a fresh invocation and memoizes synchronous failures without eager work", async () => {
    const probe = vi.fn((): Promise<never> => { throw new Error("fixture timeout"); }); const firstRun = createLegacyTargetProbe(probe);
    expect(probe).not.toHaveBeenCalled();
    await expect(firstRun("https://fixture.example/a")).rejects.toThrow("fixture timeout");
    await expect(firstRun("https://fixture.example/a")).rejects.toThrow("fixture timeout");
    await expect(createLegacyTargetProbe(probe)("https://fixture.example/a")).rejects.toThrow("fixture timeout");
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("mapping row evidence with an unavailable shared target", () => {
  it("keeps independent source statuses and each row failure, and skips pending rows", async () => {
    const { verifyLegacyMappingRows } = await import("./legacy-target-probe.mts");
    const origin = "https://fixture.example";
    const probe = vi.fn(async (url: string, readHtml = false) => {
      if (readHtml) throw new Error("fixture timeout");
      return { status: url.endsWith("/gone") ? 410 : 301, location: `${origin}/target`, contentType: null, html: "" };
    });
    const rows = [
      { source: "/first", crawlStatuses: [200], outcome: { kind: "redirect" as const, target: "/target", reservedQueryParams: "strip" as const } },
      { source: "/second", crawlStatuses: [200], outcome: { kind: "redirect" as const, target: "/target", reservedQueryParams: "strip" as const } },
      { source: "/gone", crawlStatuses: [200], outcome: { kind: "gone" as const, reason: "fixture retired system route" } },
      { source: "/pending", crawlStatuses: [200], outcome: { kind: "pending" as const } },
    ];
    const result = await verifyLegacyMappingRows(rows, origin, origin, probe);
    expect(result).toEqual([
      { source: "/first", sourceStatus: 301, issues: ["probe-failed"] },
      { source: "/second", sourceStatus: 301, issues: ["probe-failed"] },
      { source: "/gone", sourceStatus: 410, issues: [] },
    ]);
    expect(probe.mock.calls.filter(([, readHtml]) => readHtml)).toEqual([[`${origin}/target`, true]]);
    expect(probe.mock.calls.filter(([, readHtml]) => !readHtml).map(([url]) => url)).toEqual([`${origin}/first`, `${origin}/second`, `${origin}/gone`]);
  });
});

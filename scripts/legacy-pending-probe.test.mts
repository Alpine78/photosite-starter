import { describe, expect, it, vi } from "vitest";
import { observePendingLegacyPaths } from "./legacy-pending-probe.mts";
import type { MappingRow } from "./legacy-redirect-verification.mts";
import type { probeLegacyRedirect } from "./legacy-redirect-probe.mts";

const pending = (source: string): MappingRow => ({ source, crawlStatuses: [200], outcome: { kind: "pending" } });
const result = (status: number) => ({ status, location: "https://other.test/PRIVATE", contentType: "text/html", html: "PRIVATE" });
describe("pending legacy observations", () => {
  it("never turns a 404, 410 or redirect observation into a decision", async () => {
    const probe = vi.fn<typeof probeLegacyRedirect>().mockResolvedValueOnce(result(404)).mockResolvedValueOnce(result(410)).mockResolvedValueOnce(result(308));
    const report = await observePendingLegacyPaths([pending("/missing"), pending("/gone"), pending("/en/")], "https://site.test", probe);
    expect(report.status).toBe("incomplete"); expect(report.results.map((r) => r.decision)).toEqual(["pending", "pending", "pending"]);
    expect(report.results.map((r) => r.observedStatus)).toEqual([404, 410, 308]);
    expect(probe.mock.calls.map(([url]) => url)).toEqual(["https://site.test/missing", "https://site.test/gone", "https://site.test/en/"]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE"); expect(JSON.stringify(report)).not.toContain("other.test");
  });
  it("checks only pending rows, leaving published registry checks to the existing verifier", async () => {
    const probe = vi.fn<typeof probeLegacyRedirect>().mockResolvedValue(result(404));
    const rows: MappingRow[] = [pending("/one"), { source: "/decided", crawlStatuses: [200], outcome: { kind: "gone", reason: "same-intent replacement absent" } }];
    expect((await observePendingLegacyPaths(rows, "https://site.test", probe)).pendingCount).toBe(1); expect(probe).toHaveBeenCalledOnce();
  });
  it("records fixed network errors without stopping the independent following probe", async () => {
    const probe = vi.fn<typeof probeLegacyRedirect>().mockRejectedValueOnce(new Error("PRIVATE_TOKEN")).mockResolvedValueOnce(result(404));
    const report = await observePendingLegacyPaths([pending("/first"), pending("/second")], "https://site.test", probe);
    expect(report.results[0]).toEqual({ source: "/first", decision: "pending", issue: "probe-failed" }); expect(report.results[1].observedStatus).toBe(404);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_TOKEN");
  });
  it.each(["//other.test/x", "/../escape", "/%2e%2e/escape", "/x?secret=y", "/x#secret", "/x\\y", "/x\nprivate"])("rejects unsafe path %s before network", async (source) => {
    const probe = vi.fn<typeof probeLegacyRedirect>(); await expect(observePendingLegacyPaths([pending(source)], "https://site.test", probe)).rejects.toThrow("PENDING_INPUT"); expect(probe).not.toHaveBeenCalled();
  });
  it("refuses duplicate inputs and unsafe origins before the first request", async () => {
    const probe = vi.fn<typeof probeLegacyRedirect>();
    await expect(observePendingLegacyPaths([pending("/one"), pending("/one")], "https://site.test", probe)).rejects.toThrow();
    await expect(observePendingLegacyPaths([pending("/one")], "https://user:PRIVATE@site.test", probe)).rejects.toThrow(); expect(probe).not.toHaveBeenCalled();
  });
});

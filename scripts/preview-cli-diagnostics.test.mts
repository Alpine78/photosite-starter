import { afterEach, describe, expect, it, vi } from "vitest";
import { main as identify } from "./identify-preview-deployment.mts";
import { main as cleanup } from "./remove-preview-deployment.mts";
const settings = { token: "synthetic-token", projectId: "prj_synthetic", orgId: "team_synthetic" };
const settingsReader = () => settings;
afterEach(() => { vi.restoreAllMocks(); });
describe("Preview CLI diagnostic boundary (AB#249)", () => {
  const failures: unknown[] = [new Error("SYNTHETIC_PRIVATE"), "SYNTHETIC_PRIVATE", null, undefined, { message: "SYNTHETIC_PRIVATE" }, new TypeError("SYNTHETIC_PRIVATE", { cause: { url: "https://synthetic.test" } }), { get message() { throw new Error("SYNTHETIC_PRIVATE"); } }];
  it.each(failures.map((cause, index) => ({ cause, index })))("withholds failure $index in both CLIs", async ({ cause }) => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {}); const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fail = async () => { throw cause; };
    expect(await identify(["https://synthetic.vercel.app"], { readSettings: settingsReader, inspect: fail })).toBe(1);
    expect(await cleanup(["dpl_synthetic"], { readSettings: settingsReader, deleteById: fail })).toBe(1);
    expect(stdout).not.toHaveBeenCalled(); expect(stderr).toHaveBeenCalledTimes(2);
    for (const call of stderr.mock.calls) { expect(call).toHaveLength(1); expect(call[0]).toContain("details withheld"); expect(call[0]).not.toContain("SYNTHETIC_PRIVATE"); }
  });
  it("keeps identification stdout byte-exact and reports empty arguments without resolving settings", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true); const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const inspect = vi.fn(async () => ({ url: new URL("https://synthetic.vercel.app"), deployment: { id: "dpl_synthetic", projectId: settings.projectId, ownerId: settings.orgId, hostname: "synthetic.vercel.app" }, createdAt: null, projectName: null }));
    expect(await identify(["https://synthetic.vercel.app"], { readSettings: settingsReader, inspect })).toBe(0); expect(stdout.mock.calls).toEqual([["dpl_synthetic"]]);
    const reader = vi.fn(settingsReader); expect(await identify([], { readSettings: reader })).toBe(1); expect(reader).not.toHaveBeenCalled(); expect(stderr).toHaveBeenCalledTimes(1);
  });
  it("retains cleanup routing and all absent/removed messages", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const byId = vi.fn(async () => ({ deleted: true, id: "dpl_synthetic" })); const byUrl = vi.fn(async () => ({ deleted: false as const, id: null }));
    expect(await cleanup([" dpl_synthetic "], { readSettings: settingsReader, deleteById: byId, deleteByUrl: byUrl })).toBe(0); expect(byId).toHaveBeenCalledWith(" dpl_synthetic ", settings); expect(byUrl).not.toHaveBeenCalled();
    expect(await cleanup(["https://synthetic.vercel.app"], { readSettings: settingsReader, deleteByUrl: byUrl })).toBe(0);
    expect(await cleanup(["dpl_synthetic"], { readSettings: settingsReader, deleteById: async () => ({ deleted: false, id: "dpl_synthetic" }) })).toBe(0);
    expect(log.mock.calls).toEqual([["Removed unverified deployment dpl_synthetic."], ["The unverified deployment URL was already absent."], ["Deployment dpl_synthetic was already absent."]]);
  });
  it("withholds environment resolver failures and leaves missing cleanup arguments local", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {}); const reader = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE"); });
    expect(await identify(["https://synthetic.vercel.app"], { readSettings: reader })).toBe(1); expect(await cleanup(["dpl_synthetic"], { readSettings: reader })).toBe(1); expect(await cleanup([], { readSettings: reader })).toBe(1); expect(reader).toHaveBeenCalledTimes(2); expect(JSON.stringify(stderr.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
  });
});

import { describe, expect, it, vi } from "vitest";
import { describePreviewFailure, probePreviewDeployment } from "./preview-probe.mts";
import { VercelApiError } from "./vercel-preview-api.mts";

describe("Preview verification probe diagnostics", () => {
  it("imports the CLI without requests, exits, or changing the bypass setting", async () => {
    const send = vi.fn<typeof fetch>();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("unexpected CLI exit"); });
    const before = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    vi.stubGlobal("fetch", send);
    try {
      await import("./verify-preview-deployment.mts");
      expect(send).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.env.VERCEL_AUTOMATION_BYPASS_SECRET).toBe(before);
    } finally {
      vi.unstubAllGlobals();
      exit.mockRestore();
    }
  });
  it.each(["x-vercel-protection-bypass", "Authorization"])("withholds native %s validation diagnostics", async header => {
    const secret = "fixture-sentinel\ninvalid";
    const send = vi.fn<typeof fetch>(async (_url, init) => { new Headers(init?.headers); return new Response(null); });
    let error: unknown;
    try { await probePreviewDeployment(new URL("https://fixture.vercel.app/"), { [header]: secret }, send); } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(TypeError);
    expect(describePreviewFailure(error)).toBe("request failed; details withheld");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not inspect or serialize arbitrary thrown values", () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error("fixture-private"); } });
    for (const error of [new Error("fixture-private"), "fixture-private", null, undefined, Symbol("fixture-private"), hostile,
      { get message() { throw new Error("fixture-private"); }, toString() { throw new Error("fixture-private"); } }]) {
      expect(describePreviewFailure(error)).toBe("request failed; details withheld");
    }
    expect(describePreviewFailure(new VercelApiError("Vercel deployment lookup failed with HTTP 403"))).toContain("HTTP 403");
  });
  it("retains manual, bounded, no-store header-only verification", async () => {
    const response = new Response("fixture body", { status: 302, headers: { location: "https://vercel.com/sso-api", "x-robots-tag": "noindex" } });
    const read = vi.spyOn(response, "arrayBuffer"); const send = vi.fn<typeof fetch>(async () => response);
    expect(await probePreviewDeployment(new URL("https://fixture.vercel.app/"), {}, send)).toEqual({ status: 302, location: "https://vercel.com/sso-api", robotsTag: "noindex" });
    expect(send.mock.calls[0][1]).toMatchObject({ redirect: "manual", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(read).not.toHaveBeenCalled();
  });
});

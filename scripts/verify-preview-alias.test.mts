import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const cli = fileURLToPath(new URL("./verify-preview-alias.mts", import.meta.url));
const environment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PREVIEW_STABLE_ALIAS: "synthetic-preview.vercel.app",
  VERCEL_TOKEN: "synthetic-token",
  VERCEL_ORG_ID: "team_synthetic",
  VERCEL_PROJECT_ID: "prj_synthetic",
  VERCEL_AUTOMATION_BYPASS_SECRET: "synthetic-bypass",
};
// This preload replaces all transport before the actual CLI entry executes.
// Native Headers validates the supplied token/bypass, without dispatching IO.
const preload = `
globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const url = new URL(String(input));
  if (url.origin === "https://api.vercel.com" && url.pathname.startsWith("/v4/aliases/"))
    return Response.json({uid:"alias_synthetic",deploymentId:"dpl_synthetic"});
  if (url.origin === "https://api.vercel.com" && url.pathname.startsWith("/v13/deployments/"))
    return Response.json({id:"dpl_synthetic",projectId:process.env.SYNTHETIC_MODE === "provider" ? "SYNTHETIC_PROVIDER_HEAD\\nSYNTHETIC_PROVIDER_TAIL" : "prj_synthetic",ownerId:"team_synthetic",url:"synthetic-owned.vercel.app",target:null});
  if (url.origin === "https://synthetic-preview.vercel.app")
    return new Response(null,{status:headers.has("x-vercel-protection-bypass")?200:302,headers:{location:"https://vercel.com/sso-api","x-robots-tag":"noindex"}});
  throw new Error("Unexpected synthetic route");
};`;
function child(overrides: Partial<NodeJS.ProcessEnv> = {}, entry = cli) {
  return spawnSync(process.execPath, ["--import", `data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`, entry], {
    env: { ...environment, ...overrides }, encoding: "utf8", timeout: 4_000,
  });
}

describe("stable alias CLI diagnostic boundary (AB#351)", () => {
  it.each([
    { name: "token", env: { VERCEL_TOKEN: "SYNTHETIC_TOKEN_HEAD\nSYNTHETIC_TOKEN_TAIL" } },
    { name: "bypass", env: { VERCEL_AUTOMATION_BYPASS_SECRET: "SYNTHETIC_BYPASS_HEAD\nSYNTHETIC_BYPASS_TAIL" } },
    { name: "provider identity", env: { SYNTHETIC_MODE: "provider" } },
    { name: "alias configuration", env: { PREVIEW_STABLE_ALIAS: "https://SYNTHETIC_ALIAS_HEAD:SYNTHETIC_ALIAS_TAIL@example.test/" } },
  ])("withholds $name data in the real Node CLI", ({ env }) => {
    const result = child(env);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toMatch(/SYNTHETIC_(?:TOKEN|BYPASS|PROVIDER|ALIAS)_(?:HEAD|TAIL)/);
    const expected = env.PREVIEW_STABLE_ALIAS ? aliasDiagnostic : env.VERCEL_AUTOMATION_BYPASS_SECRET ? probeDiagnostic : identityDiagnostic;
    expect(result.stderr).toBe(`${expected}\n`);
  });
  it("runs the real CLI entry with healthy synthetic owned protection responses", () => {
    const result = child();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Stable Preview alias: synthetic-preview.vercel.app -> dpl_synthetic\n");
    expect(result.stdout).toContain("Access protection and noindex both verified on the alias host.\n");
  });
});


afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type FetchCall = { url: URL; init: RequestInit | undefined; headers: Headers };
function fixture(change?: (call: FetchCall) => Response | undefined) {
  const calls: FetchCall[] = [];
  const send: typeof fetch = async (input, init) => {
    const call = { url: new URL(String(input)), init, headers: new Headers(init?.headers) };
    calls.push(call);
    const replacement = change?.(call);
    if (replacement) return replacement;
    if (call.url.origin === "https://api.vercel.com" && call.url.pathname.startsWith("/v4/aliases/")) {
      return Response.json({ uid: "alias_synthetic", deploymentId: "dpl_synthetic" });
    }
    if (call.url.origin === "https://api.vercel.com" && call.url.pathname.startsWith("/v13/deployments/")) {
      return Response.json({ id: "dpl_synthetic", projectId: "prj_synthetic", ownerId: "team_synthetic", url: "synthetic-owned.vercel.app", target: null });
    }
    if (call.url.origin === "https://synthetic-preview.vercel.app") {
      return new Response(null, { status: call.headers.has("x-vercel-protection-bypass") ? 200 : 302, headers: { location: "https://vercel.com/sso-api", "x-robots-tag": "noindex" } });
    }
    throw new Error("Unexpected synthetic route");
  };
  return { send, calls };
}
function output() {
  return {
    stderr: vi.spyOn(console, "error").mockImplementation(() => {}),
    stdout: vi.spyOn(console, "log").mockImplementation(() => {}),
  };
}
const aliasDiagnostic = "Preview alias verification failed: PREVIEW_STABLE_ALIAS must be a dedicated bare non-production *.vercel.app host; request failed; details withheld. See docs/deployment.md.";
const identityDiagnostic = "Preview alias verification failed: the alias identity could not be verified (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID): request failed; details withheld";
const probeDiagnostic = "Preview alias verification failed: the alias host could not be reached: request failed; details withheld";

describe("import-safe read-only alias verification", () => {
  it("imports without IO, exit, output or changing even explicitly synthetic environment", async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    // Hash equality keeps unrelated ambient values out of failure artifacts.
    const environmentDigest = () => createHash("sha256").update(JSON.stringify(Object.entries(process.env).sort())).digest("hex");
    const before = environmentDigest();
    const send = vi.fn(async () => { throw new Error("Import must not fetch"); });
    vi.stubGlobal("fetch", send);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("Import must not exit"); });
    const { stderr, stdout } = output();
    const imported = await import("./verify-preview-alias.mts");
    expect(imported.main).toBeTypeOf("function");
    expect(send).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(environmentDigest()).toBe(before);
  });

  it.each([
    { name: "relative path", entry: () => relative(process.cwd(), cli) },
    { name: "symlink", entry: () => cli },
  ])("executes the actual $name entry", ({ name, entry }) => {
    const dir = mkdtempSync(join(tmpdir(), "synthetic-alias-cli-"));
    try {
      const link = join(dir, "verify.mts");
      if (name === "symlink") symlinkSync(cli, link);
      const result = child({}, name === "symlink" ? link : entry());
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Access protection and noindex both verified on the alias host.\n");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps owned identity before two ordered manual/no-store GET probes and exact success output", async () => {
    const { main } = await import("./verify-preview-alias.mts");
    const { send, calls } = fixture();
    const { stderr, stdout } = output();
    expect(await main(environment, send)).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(calls.map(({ url }) => url.href)).toEqual([
      "https://api.vercel.com/v4/aliases/synthetic-preview.vercel.app?teamId=team_synthetic",
      "https://api.vercel.com/v13/deployments/dpl_synthetic?teamId=team_synthetic",
      "https://synthetic-preview.vercel.app/", "https://synthetic-preview.vercel.app/",
    ]);
    for (const [index, call] of calls.entries()) {
      expect(call.init?.method ?? "GET").toBe("GET");
      expect(call.init?.cache).toBe("no-store");
      expect(call.init?.redirect).toBe(index < 2 ? "error" : "manual");
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      expect(call.headers.get("x-vercel-protection-bypass")).toBe(index === 3 ? "synthetic-bypass" : null);
      expect(call.headers.get("authorization")).toBe(index < 2 ? "Bearer synthetic-token" : null);
    }
    const actual = stdout.mock.calls.map(([line]) => `${line}\n`).join("");
    expect(actual).toBe(
      "Stable Preview alias: synthetic-preview.vercel.app -> dpl_synthetic\n" +
      "  ok  access protection: unauthenticated request challenged with a 302 redirect to vercel.com/sso-api\n" +
      "  ok  noindex: X-Robots-Tag: noindex\n" +
      "Access protection and noindex both verified on the alias host.\n",
    );
  });

  const hostile = [
    new Error("SYNTHETIC_PRIVATE"), "SYNTHETIC_PRIVATE", null, undefined,
    { message: "SYNTHETIC_PRIVATE", toString() { throw new Error("Must not stringify"); } },
    { get message() { throw new Error("Must not inspect message"); } },
    new Proxy({}, { getPrototypeOf() { throw new Error("Must not inspect prototype"); } }),
  ];
  it.each(hostile.map((cause, index) => ({ cause, index })))("withholds unknown thrown cause $index at both phases", async ({ cause }) => {
    const { main } = await import("./verify-preview-alias.mts");
    const { stderr, stdout } = output();
    const fail: typeof fetch = async () => { throw cause; };
    expect(await main(environment, fail)).toBe(1);
    const { send } = fixture(({ url }) => {
      if (url.origin !== "https://api.vercel.com") throw cause;
      return undefined;
    });
    expect(await main(environment, send)).toBe(1);
    expect(stderr.mock.calls).toEqual([[identityDiagnostic], [probeDiagnostic]]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("keeps trusted HTTP diagnostics while withholding provider mismatch and malformed settings", async () => {
    const { main } = await import("./verify-preview-alias.mts");
    const { stderr, stdout } = output();
    const forbidden = fixture(() => new Response(null, { status: 403 }));
    expect(await main(environment, forbidden.send)).toBe(1);
    expect(stderr.mock.calls[0]).toEqual(["Preview alias verification failed: the alias identity could not be verified (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID): Vercel alias lookup failed with status 403"]);
    expect(await main({ ...environment, PREVIEW_STABLE_ALIAS: "https://SYNTHETIC_PRIVATE:password@example.test/" }, forbidden.send)).toBe(1);
    expect(stderr.mock.calls[1]).toEqual([aliasDiagnostic]);
    expect(await main({ ...environment, VERCEL_TOKEN: "" }, forbidden.send)).toBe(1);
    expect(stderr.mock.calls[2]).toEqual([identityDiagnostic]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it.each([
    { name: "wrong project", identity: { projectId: "SYNTHETIC_PRIVATE" } },
    { name: "wrong owner", identity: { ownerId: "SYNTHETIC_PRIVATE" } },
    { name: "wrong deployment", identity: { id: "dpl_other" } },
  ])("refuses $name before sending any bypass", async ({ identity }) => {
    const { main } = await import("./verify-preview-alias.mts");
    const { send, calls } = fixture(({ url }) => url.pathname.startsWith("/v13/") ? Response.json({ id: "dpl_synthetic", projectId: "prj_synthetic", ownerId: "team_synthetic", url: "synthetic-owned.vercel.app", ...identity }) : undefined);
    const { stderr, stdout } = output();
    expect(await main(environment, send)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(stderr.mock.calls).toEqual([[identityDiagnostic]]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("preserves missing bypass, unassigned alias and production-target refusals", async () => {
    const { main } = await import("./verify-preview-alias.mts");
    const { stderr, stdout } = output();
    const missing = fixture();
    expect(await main({ ...environment, VERCEL_AUTOMATION_BYPASS_SECRET: "" }, missing.send)).toBe(1);
    expect(missing.calls).toHaveLength(0);
    const absent = fixture(() => new Response(null, { status: 404 }));
    expect(await main(environment, absent.send)).toBe(1);
    expect(absent.calls).toHaveLength(1);
    const production = fixture(({ url }) => url.pathname.startsWith("/v13/") ? Response.json({ id: "dpl_synthetic", projectId: "prj_synthetic", ownerId: "team_synthetic", url: "synthetic-owned.vercel.app", target: "production" }) : undefined);
    expect(await main(environment, production.send)).toBe(1);
    expect(production.calls).toHaveLength(2);
    expect(stderr.mock.calls).toEqual([
      ["Preview alias verification failed: VERCEL_AUTOMATION_BYPASS_SECRET is not set."],
      ["Preview alias verification failed: synthetic-preview.vercel.app is not assigned to a deployment in this project. Run the pipeline (or npm run repoint:preview) to assign it."],
      ["Preview alias verification failed: synthetic-preview.vercel.app resolves to a production deployment (dpl_synthetic). PREVIEW_STABLE_ALIAS must be a dedicated non-production *.vercel.app host — see docs/deployment.md."],
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it.each(["protection", "noindex"])("preserves nonzero %s verification failures", async (failure) => {
    const { main } = await import("./verify-preview-alias.mts");
    const { send, calls } = fixture(({ url, headers }) => {
      if (url.origin === "https://api.vercel.com") return undefined;
      return new Response(null, { status: failure === "protection" || headers.has("x-vercel-protection-bypass") ? 200 : 302, headers: { location: "https://vercel.com/sso-api", "x-robots-tag": failure === "noindex" ? "index" : "noindex" } });
    });
    const { stderr, stdout } = output();
    expect(await main(environment, send)).toBe(1);
    expect(calls).toHaveLength(4);
    expect(stderr.mock.calls).toEqual([["Preview alias verification failed: the alias is not access-protected and non-indexable. See the checks above."]]);
    expect(stdout.mock.calls.some(([line]) => String(line).includes("FAILED"))).toBe(true);
    expect(stdout.mock.calls.some(([line]) => String(line).includes("both verified"))).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { candidateFetch, verifyLegacyCandidate } from "./legacy-candidate-verification.mts";
const url = "https://fixture-owned.vercel.app/", canonicalOrigin = "https://example.test";
const expected = { sourceSha: "a".repeat(40), deploymentId: "dpl_fixture", projectId: "prj_fixture", teamId: "team_fixture" };
const metadata = () => ({ id: expected.deploymentId, projectId: expected.projectId, ownerId: expected.teamId, team: { id: expected.teamId }, url: new URL(url).hostname, readyState: "READY", target: null, meta: { gitCommitSha: expected.sourceSha, gitDirty: "0" } });
const fixture = () => ({ url, canonicalOrigin, expected, metadata: metadata(), rows: [{ source: "/old", crawlStatuses: [200], outcome: { kind: "redirect" as const, target: "/new", reservedQueryParams: "strip" as const } }, { source: "/gone", crawlStatuses: [200], outcome: { kind: "gone" as const, reason: "fixture-retired" } }], pendingCount: 0 });
const sender = () => vi.fn<typeof fetch>(async (input, init) => {
  const route = new URL(String(input)).pathname, bypassed = new Headers(init?.headers).has("x-vercel-protection-bypass");
  if (!bypassed) return new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api" } });
  if (route === "/old") return new Response(null, { status: 301, headers: { location: "/new" } });
  if (route === "/gone") return new Response(null, { status: 410 });
  if (route === "/new") return new Response('<html><head><link rel="canonical" href="https://example.test/new"></head></html>', { headers: { "content-type": "text/html" } });
  return new Response("fixture", { headers: { "x-robots-tag": "noindex" } });
});
describe("protected candidate origin boundary", () => {
  it.each(["https://unowned.vercel.app/a", "http://fixture-owned.vercel.app/a", "https://user:secret@fixture-owned.vercel.app/a", "https://fixture-owned.vercel.app/a#secret"])("rejects %s before fetch", async target => {
    const send = sender(); await expect(candidateFetch(url, "fixture-bypass", send)(target, { redirect: "manual" })).rejects.toThrow("INVALID_CANDIDATE_REQUEST"); expect(send).not.toHaveBeenCalled();
  });
  it("requires GET with manual redirects and no body", async () => {
    const send = sender(), bounded = candidateFetch(url, "fixture-bypass", send);
    await expect(bounded(url, { redirect: "follow" })).rejects.toThrow();
    await expect(bounded(url, { redirect: "manual", method: "POST" })).rejects.toThrow();
    await expect(bounded(url, { redirect: "manual", body: "body" })).rejects.toThrow();
    await expect(bounded(new Request(url), { redirect: "manual" })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("replaces bypass and drops other authentication", async () => {
    const send = sender(); await candidateFetch(url, "fixture-bypass", send)(url, { redirect: "manual", headers: { authorization: "secret", cookie: "session", "x-vercel-protection-bypass": "wrong" } });
    const options = send.mock.calls[0][1], headers = new Headers(options?.headers);
    expect(headers.get("x-vercel-protection-bypass")).toBe("fixture-bypass"); expect(headers.has("authorization")).toBe(false); expect(headers.has("cookie")).toBe(false); expect(options?.redirect).toBe("manual");
  });
  it("rejects missing or malformed bypass without echoing it", () => { expect(() => candidateFetch(url, "")).toThrow("INVALID_CANDIDATE_BYPASS"); expect(() => candidateFetch(url, "bad\r\nsecret")).toThrow("INVALID_CANDIDATE_BYPASS"); });
});
describe("protected candidate mapping verification", () => {
  it("checks ownership, source, protection and every approved source/target", async () => {
    const send = sender(), readBypass = vi.fn(() => "fixture-bypass"); const result = await verifyLegacyCandidate(fixture(), { send, readBypass });
    expect(result).toMatchObject({ status: "passed", protectionAndNoindexVerified: true, finalProductionVerified: false, launchApproved: false });
    expect(result.results).toEqual([{ source: "/old", sourceStatus: 301, targetStatus: 200, issues: [] }, { source: "/gone", sourceStatus: 410, issues: [] }]);
    expect(readBypass).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledTimes(5); expect(JSON.stringify(result)).not.toContain("fixture-bypass");
    expect(new Headers(send.mock.calls[0][1]?.headers).has("x-vercel-protection-bypass")).toBe(false);
  });
  it.each(["projectId", "ownerId", "url", "id"])("refuses wrong %s before bypass resolution or any request", async key => {
    const f = fixture(); f.metadata = { ...f.metadata, [key]: "wrong" }; const send = sender(), readBypass = vi.fn();
    await expect(verifyLegacyCandidate(f, { send, readBypass })).rejects.toThrow(); expect(send).not.toHaveBeenCalled(); expect(readBypass).not.toHaveBeenCalled();
  });
  it.each(["1", "unknown"])("refuses source cleanliness %s before bypass", async gitDirty => {
    const f = fixture(); f.metadata.meta.gitDirty = gitDirty; const send = sender(), readBypass = vi.fn();
    await expect(verifyLegacyCandidate(f, { send, readBypass })).rejects.toThrow("CANDIDATE_SOURCE_REFUSED"); expect(send).not.toHaveBeenCalled(); expect(readBypass).not.toHaveBeenCalled();
  });
  it("refuses mismatching frozen source before bypass", async () => { const f = fixture(); f.expected = { ...expected, sourceSha: "b".repeat(40) }; const send = sender(), readBypass = vi.fn(); await expect(verifyLegacyCandidate(f, { send, readBypass })).rejects.toThrow("CANDIDATE_SOURCE_REFUSED"); expect(send).not.toHaveBeenCalled(); expect(readBypass).not.toHaveBeenCalled(); });
  it("does not follow unexpected response Locations", async () => {
    const send = sender(); send.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api" } }));
    send.mockImplementationOnce(async () => new Response("fixture", { headers: { "x-robots-tag": "noindex" } }));
    send.mockImplementationOnce(async () => new Response(null, { status: 301, headers: { location: "https://unowned.vercel.app/secret" } }));
    const result = await verifyLegacyCandidate(fixture(), { send, readBypass: () => "fixture-bypass" });
    expect(result.status).toBe("failed"); expect(result.results[0].issues).toContain("unexpected-location"); expect(send.mock.calls.every(([input]) => new URL(String(input)).origin === new URL(url).origin)).toBe(true);
  });
  it("keeps missing decisions incomplete", async () => { const f = fixture(); f.pendingCount = 1; const result = await verifyLegacyCandidate(f, { send: sender(), readBypass: () => "fixture-bypass" }); expect(result.status).toBe("incomplete"); });
  it("refuses unprotected or indexable candidates before the mapping scan", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("fixture")); await expect(verifyLegacyCandidate(fixture(), { send, readBypass: () => "fixture-bypass" })).rejects.toThrow("CANDIDATE_PROTECTION_REFUSED"); expect(send).toHaveBeenCalledTimes(2);
  });
});

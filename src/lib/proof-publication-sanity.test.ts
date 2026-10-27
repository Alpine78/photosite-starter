import { describe, expect, it, vi } from "vitest";
import { commitPublication, ProofPublicationStoreError, readPublicationState, verifyEditorSession } from "@/lib/proof-publication-sanity";
import type { SanityConfig } from "@/lib/sanity-config";

const config: SanityConfig = { projectId: "abc123", dataset: "production", datasetVisibility: "public", apiVersion: "v2026-06-24" };
const token = "editor-session-token-0123456789";
function fetchReturning(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }));
}

describe("proof publication Sanity calls use only the editor's token and fixed URLs", () => {
  const member = { id: "person-1", isCurrentUser: true, isRobot: false, roles: [{ name: "editor" }] };
  const project = { id: config.projectId, members: [member] };
  it.each(["editor", "administrator", "viewer"])("accepts a documented current human %s without requiring an admin role", async (role) => {
    const send = fetchReturning(200, { ...project, members: [{ ...member, roles: [{ name: role }] }] });
    await verifyEditorSession({ config, token, fetchImplementation: send });
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://abc123.api.sanity.io/v2021-12-15/projects/abc123?includeMembers=true&includeFeatures=false&includeOrganization=false");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { Authorization: `Bearer ${token}` } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBeUndefined();
  });
  it("handles a realistic multi-member response without relying on unrelated robot flags", async () => {
    const others = Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, isCurrentUser: false, roles: [{ name: "editor" }], displayName: "Other member" }));
    await verifyEditorSession({ config, token, fetchImplementation: fetchReturning(200, { ...project, members: [...others, member] }) });
  });
  it.each([
    ["the old nonempty-ID inference", { id: "robot-1", name: "Editor robot" }],
    ["an Editor robot", { ...project, members: [{ ...member, isRobot: true }] }],
    ["a robot with no current membership", { ...project, members: [{ ...member, isCurrentUser: false, isRobot: true }] }],
    ["a missing project id", { members: [member] }],
    ["a foreign project", { ...project, id: "other-project" }],
    ["no member list", { id: config.projectId }],
    ["a malformed member list", { ...project, members: {} }],
    ["no current member", { ...project, members: [{ ...member, isCurrentUser: false }] }],
    ["multiple current members", { ...project, members: [member, { ...member, id: "person-2" }] }],
    ["duplicate principal identity", { ...project, members: [member, { ...member, isCurrentUser: false, isRobot: true }] }],
    ["an unmarked member", { ...project, members: [{ id: "person-1", isRobot: false }] }],
    ["an omitted robot marker", { ...project, members: [{ id: "person-1", isCurrentUser: true }] }],
    ["a string robot marker", { ...project, members: [{ ...member, isRobot: "false" }] }],
    ["a numeric robot marker", { ...project, members: [{ ...member, isRobot: 0 }] }],
    ["a malformed hidden current flag", { ...project, members: [member, { id: "other", isCurrentUser: "true" }] }],
    ["a null member row", { ...project, members: [member, null] }],
    ["an array member row", { ...project, members: [member, []] }],
    ["a null body", null],
    ["an array body", [project]],
    ["an empty member id", { ...project, members: [{ ...member, id: " " }] }],
    ["a numeric member id", { ...project, members: [{ ...member, id: 3 }] }],
  ])("refuses %s without exposing private project/member data", async (_label, body) => {
    const send = fetchReturning(200, body);
    const error = await verifyEditorSession({ config, token, fetchImplementation: send }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProofPublicationStoreError);
    expect((error as ProofPublicationStoreError).kind).toBe("unauthenticated");
    expect((error as Error).message).toBe("[proof-publication-sanity] unauthenticated");
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([
    [401, {}, "unauthenticated"],
    [403, {}, "forbidden"],
    [409, {}, "conflict"],
    [404, {}, "unavailable"],
    [429, {}, "unavailable"],
    [302, {}, "unavailable"],
    [500, {}, "unavailable"],
    [200, "<html>not json</html>", "unavailable"],
  ])("maps a %s identity answer without echoing the token", async (status, body, kind) => {
    const error = await verifyEditorSession({ config, token, fetchImplementation: fetchReturning(status, body) }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProofPublicationStoreError);
    expect((error as ProofPublicationStoreError).kind).toBe(kind);
    expect(String((error as Error).message)).not.toContain(token);
  });
  it("treats network, body-read and oversized-answer failures as closed unavailable errors", async () => {
    const failing = vi.fn(async () => { throw new Error(`boom ${token}`); });
    const error = await verifyEditorSession({ config, token, fetchImplementation: failing as unknown as typeof fetch }).catch((caught: unknown) => caught);
    expect((error as ProofPublicationStoreError).kind).toBe("unavailable");
    expect(String((error as Error).message)).not.toContain(token);
    const brokenBody = new Response();
    vi.spyOn(brokenBody, "text").mockRejectedValue(new Error(`body read: ${token}`));
    const bodyError = await verifyEditorSession({ config, token, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(brokenBody) }).catch((caught: unknown) => caught);
    expect((bodyError as Error).message).toBe("[proof-publication-sanity] unavailable");
    for (const [body, headers] of [[project, { "content-length": String(2 * 1024 * 1024) }], [{ ...project, padding: "x".repeat(1024 * 1024) }, {}]] as const) {
      const huge = fetchReturning(200, body, headers);
      expect(((await verifyEditorSession({ config, token, fetchImplementation: huge }).catch((caught: unknown) => caught)) as ProofPublicationStoreError).kind).toBe("unavailable");
    }
  });
  it("reads drafts and private records with the raw perspective", async () => {
    const send = fetchReturning(200, { result: { draft: { _id: "drafts.g1" }, published: null, terms: null, versions: 0 } });
    expect(await readPublicationState("g1", { config, token, fetchImplementation: send })).toEqual({ draft: { _id: "drafts.g1" }, published: null, terms: null, versions: 0 });
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://abc123.api.sanity.io/v2026-06-24/data/query/production?perspective=raw");
    expect(JSON.parse(String(init?.body)).params).toEqual({ id: "g1", draftId: "drafts.g1", termsId: "proofTerms.g1", versionsPath: "versions.*.g1" });
  });
  it("commits one transaction and reports a guard mismatch as a conflict", async () => {
    const send = fetchReturning(200, { transactionId: "t1" });
    await commitPublication([{ delete: { id: "drafts.g1" } }], { config, token, fetchImplementation: send });
    expect(send.mock.calls[0][0]).toBe("https://abc123.api.sanity.io/v2026-06-24/data/mutate/production");
    expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual({ mutations: [{ delete: { id: "drafts.g1" } }] });
    const conflict = await commitPublication([], { config, token, fetchImplementation: fetchReturning(409, {}) }).catch((caught: unknown) => caught);
    expect((conflict as ProofPublicationStoreError).kind).toBe("conflict");
  });
});

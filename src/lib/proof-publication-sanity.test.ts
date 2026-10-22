import { describe, expect, it, vi } from "vitest";
import { commitPublication, ProofPublicationStoreError, readPublicationState, verifyEditorSession } from "@/lib/proof-publication-sanity";
import type { SanityConfig } from "@/lib/sanity-config";

const config: SanityConfig = { projectId: "abc123", dataset: "production", datasetVisibility: "public", apiVersion: "v2026-06-24" };
const token = "editor-session-token-0123456789";
function fetchReturning(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }));
}

describe("proof publication Sanity calls use only the editor's token and fixed URLs", () => {
  it("proves a user session on the project host without following redirects", async () => {
    const send = fetchReturning(200, { id: "user-1", name: "Editor" });
    await verifyEditorSession({ config, token, fetchImplementation: send });
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://abc123.api.sanity.io/v2026-06-24/users/me");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { Authorization: `Bearer ${token}` } });
  });
  it.each([
    [401, {}, "unauthenticated"],
    [403, {}, "forbidden"],
    [200, { name: "no id" }, "unauthenticated"],
    [500, {}, "unavailable"],
    [200, "not json", "unavailable"],
  ])("maps a %s users/me answer without echoing the token", async (status, body, kind) => {
    const error = await verifyEditorSession({ config, token, fetchImplementation: fetchReturning(status, body) }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProofPublicationStoreError);
    expect((error as ProofPublicationStoreError).kind).toBe(kind);
    expect(String((error as Error).message)).not.toContain(token);
  });
  it("treats a network failure or an oversized answer as unavailable", async () => {
    const failing = vi.fn(async () => { throw new Error(`boom ${token}`); });
    const error = await verifyEditorSession({ config, token, fetchImplementation: failing as unknown as typeof fetch }).catch((caught: unknown) => caught);
    expect((error as ProofPublicationStoreError).kind).toBe("unavailable");
    expect(String((error as Error).message)).not.toContain(token);
    const huge = fetchReturning(200, { id: "x" }, { "content-length": String(2 * 1024 * 1024) });
    expect(((await verifyEditorSession({ config, token, fetchImplementation: huge }).catch((caught: unknown) => caught)) as ProofPublicationStoreError).kind).toBe("unavailable");
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

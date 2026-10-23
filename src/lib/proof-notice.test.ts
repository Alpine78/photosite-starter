import { describe, expect, it, vi } from "vitest";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { deliverProofNotice, noticeContent, proofNoticeEmail, ProofNoticeDataError } from "@/lib/proof-notice";
import { buildProofNoticeSender, ProofNoticeConfigurationError } from "@/lib/proof-notice-delivery";

const labels = getBuiltInLabels("fi").proofNotice;
const confirmedAt = "2026-10-23T10:00:00.000Z";
function versionDocument(extra: Record<string, unknown> = {}) {
  return { _id: "proofSelection.g1.v2", _type: "clientProofSelectionVersion", _rev: "v", galleryId: "g1", version: 2, confirmedAt, galleryRevision: "grev",
    terms: { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR", jobReference: "Hääkuvaus 2026" },
    totals: { selected: 2, extra: 1, extraTotalMinor: 1250 },
    items: [{ _key: "b", reference: "1000", originalFilename: "DSC_1000.jpg" }, { _key: "a", reference: "999", originalFilename: "DSC_0999.jpg" }], ...extra };
}
const noticeDocument = (extra: Record<string, unknown> = {}) => ({ _id: "proofNotice.g1.v2", _type: "clientProofNotice", _rev: "n1", galleryId: "g1", version: 2, state: "pending", ...extra });

describe("notice content", () => {
  it("is built only from the immutable version, in numeric order, identical on every preparation", () => {
    const content = noticeContent(versionDocument(), "g1", 2);
    expect(content.items).toEqual([{ reference: "999", originalFilename: "DSC_0999.jpg" }, { reference: "1000", originalFilename: "DSC_1000.jpg" }]);
    const first = proofNoticeEmail(content, labels, "fi"), second = proofNoticeEmail(noticeContent(versionDocument(), "g1", 2), labels, "fi");
    expect(second).toEqual(first);
    expect(first.subject).toBe("Vedosvalinta vahvistettu: Hääkuvaus 2026 (versio 2)");
    for (const part of ["Hääkuvaus 2026", "Versio: 2", "valittu: 2, lisäkuvia: 1", "12.50", "EUR", "999 — DSC_0999.jpg", "1000 — DSC_1000.jpg"]) expect(first.text).toContain(part);
  });

  it.each([
    ["another gallery", versionDocument({ galleryId: "g2" })],
    ["a missing job reference", versionDocument({ terms: { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR" } })],
    ["a control character in a filename", versionDocument({ items: [{ _key: "a", reference: "999", originalFilename: "a\nb" }, { _key: "b", reference: "1000", originalFilename: "c" }] })],
    ["a repeated number", versionDocument({ items: [{ _key: "a", reference: "999", originalFilename: "a" }, { _key: "b", reference: "999", originalFilename: "c" }] })],
    ["totals that do not add up", versionDocument({ totals: { selected: 2, extra: 1, extraTotalMinor: 1 } })],
  ])("refuses %s", (_name, doc) => {
    expect(() => noticeContent(doc, "g1", 2)).toThrow(ProofNoticeDataError);
  });
});

describe("delivering the notice", () => {
  function deps(documents: Record<string, unknown>, extra: Partial<Parameters<typeof deliverProofNotice>[2]> = {}) {
    return {
      read: vi.fn(async (id: string) => documents[id] ?? null),
      commit: vi.fn(async () => {}),
      send: vi.fn(async () => ({ status: "delivered" as const })),
      labels, locale: "fi", now: () => "2026-10-23T10:00:05.000Z", ...extra,
    };
  }

  it("sends a pending notice once and records it under the revision read", async () => {
    const d = deps({ "proofNotice.g1.v2": noticeDocument(), "proofSelection.g1.v2": versionDocument() });
    expect(await deliverProofNotice("g1", 2, d)).toEqual({ outcome: "sent" });
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining("Hääkuvaus") }), "proof-notice/g1/v2");
    expect(d.commit).toHaveBeenCalledWith([{ patch: { id: "proofNotice.g1.v2", ifRevisionID: "n1", set: { state: "sent", attemptedAt: "2026-10-23T10:00:05.000Z" } } }]);
  });

  it("does nothing for a notice that is no longer pending", async () => {
    const d = deps({ "proofNotice.g1.v2": noticeDocument({ state: "sent" }), "proofSelection.g1.v2": versionDocument() });
    expect(await deliverProofNotice("g1", 2, d)).toEqual({ outcome: "not-pending" });
    expect(d.send).not.toHaveBeenCalled(); expect(d.commit).not.toHaveBeenCalled();
  });

  it("never sends partial content from a malformed version, and records why", async () => {
    const d = deps({ "proofNotice.g1.v2": noticeDocument(), "proofSelection.g1.v2": versionDocument({ items: [] }) });
    expect(await deliverProofNotice("g1", 2, d)).toEqual({ outcome: "failed", errorClass: "malformed-record" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.commit).toHaveBeenCalledWith([{ patch: expect.objectContaining({ set: expect.objectContaining({ state: "failed", errorClass: "malformed-record" }) }) }]);
  });

  it("reports an unrecorded outcome when the notice changed meanwhile or the record write failed", async () => {
    const d = deps({ "proofNotice.g1.v2": noticeDocument(), "proofSelection.g1.v2": versionDocument() }, { commit: vi.fn(async () => { throw new Error("409"); }) });
    expect(await deliverProofNotice("g1", 2, d)).toEqual({ outcome: "unrecorded" });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("records a provider failure and a thrown transport as failed, never sent", async () => {
    const failing = deps({ "proofNotice.g1.v2": noticeDocument(), "proofSelection.g1.v2": versionDocument() }, { send: vi.fn(async () => { throw new Error("socket"); }) });
    expect(await deliverProofNotice("g1", 2, failing)).toEqual({ outcome: "failed", errorClass: "provider-unavailable" });
    const missing = deps({});
    expect(await deliverProofNotice("g1", 2, missing)).toEqual({ outcome: "unrecorded", errorClass: "malformed-record" });
  });
});

describe("the notice transport", () => {
  const environment = { CONTACT_DELIVERY_ADAPTER: "resend", RESEND_API_KEY: "re_test", CONTACT_DELIVERY_FROM: "Site <site@example.com>", CONTACT_DELIVERY_TO: "owner@example.com", SITE_DEPLOYMENT_STAGE: "production" };

  it("sends the same body and idempotency key for every preparation of one version, to the owner mailbox only", async () => {
    const calls: [string, RequestInit][] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => { calls.push([String(url), init!]); return Response.json({ id: "email-1" }); });
    const send = buildProofNoticeSender(environment, fetcher);
    const email = proofNoticeEmail(noticeContent(versionDocument(), "g1", 2), labels, "fi");
    expect(await send(email, "proof-notice/g1/v2")).toEqual({ status: "delivered" });
    expect(await send(proofNoticeEmail(noticeContent(versionDocument(), "g1", 2), labels, "fi"), "proof-notice/g1/v2")).toEqual({ status: "delivered" });
    expect(calls[0][1].body).toBe(calls[1][1].body);
    expect(new Headers(calls[0][1].headers).get("idempotency-key")).toBe("proof-notice/g1/v2");
    const body = JSON.parse(String(calls[0][1].body));
    expect(body.to).toEqual(["owner@example.com"]); expect(body).not.toHaveProperty("reply_to");
  });

  it.each(["invalid_idempotent_request", "concurrent_idempotent_requests"])("never treats a %s refusal as delivered", async (name) => {
    const send = buildProofNoticeSender(environment, vi.fn<typeof fetch>(async () => Response.json({ name, statusCode: 409, message: "x" }, { status: 409 })));
    expect((await send({ subject: "s", text: "t" }, "proof-notice/g1/v2")).status).toBe("failed");
  });

  it("refuses the sink in production and requires the mailbox settings", () => {
    expect(() => buildProofNoticeSender({ ...environment, CONTACT_DELIVERY_ADAPTER: "sink" })).toThrow(ProofNoticeConfigurationError);
    expect(() => buildProofNoticeSender({ ...environment, CONTACT_DELIVERY_TO: "" })).toThrow(ProofNoticeConfigurationError);
    expect(() => buildProofNoticeSender({ ...environment, CONTACT_DELIVERY_ADAPTER: "other" })).toThrow(ProofNoticeConfigurationError);
  });
});

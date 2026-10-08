import { describe, expect, it } from "vitest";
import { classifyRecoveryResult, describeRecoveryFailure, isRecoveryAcknowledgement, readRecoveryPreviewSettings, readRecoveryResponse } from "./revalidation-recovery.mts";
import { VercelApiError } from "./vercel-preview-api.mts";

const id = "dbb4c2b2-96c2-4672-9e03-e33dc3904173";
describe("cache recovery response boundary", () => {
  it.each([301, 403, 503])("refuses HTTP %d even with an otherwise valid success acknowledgement", status => {
    expect(classifyRecoveryResult(new Response(null, { status }), { status: "accepted", correlationId: id }))
      .toEqual({ kind: "http-failure", status });
  });
  it("retains a reference only for HTTP success with a valid acknowledgement", () => {
    expect(classifyRecoveryResult(new Response(null), { status: "accepted", correlationId: id }))
      .toEqual({ kind: "accepted", correlationId: id });
    expect(classifyRecoveryResult(new Response(null), { status: "accepted", correlationId: "fixture-invalid" }))
      .toEqual({ kind: "unverified", status: 200 });
  });
  it.each([[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]].map(bytes => ({ bytes })))("refuses malformed UTF-8 %#", async ({ bytes }) => {
    const body = Buffer.concat([Buffer.from('{"note":"'), Buffer.from(bytes), Buffer.from('"}')]);
    await expect(readRecoveryResponse(new Response(body))).rejects.toThrow();
  });
  it("preserves Unicode and a literal replacement character, including a response BOM", async () => {
    const value = { status: "accepted", correlationId: id, note: "Ää 📷 �" };
    expect(await readRecoveryResponse(new Response(`\uFEFF${JSON.stringify(value)}`))).toEqual(value);
    expect(isRecoveryAcknowledgement(value)).toBe(true);
  });
  it.each([undefined, null, {}, { status: "rejected", correlationId: id },
    ...["", id.toUpperCase(), `{${id}}`, id.replace("4672", "1672"), id.replace("4672", "7672"), `${id}\nprivate`]
      .map(correlationId => ({ status: "accepted", correlationId }))])("rejects an unusable acknowledgement %#", value => {
    expect(isRecoveryAcknowledgement(value)).toBe(false);
  });
  it("does not serialize arbitrary errors or hostile objects", () => {
    const secret = "fixture-secret\ninvalid";
    let native: unknown;
    try { new Headers({ "x-vercel-protection-bypass": secret }); } catch (cause) { native = cause; }
    expect((native as Error).message).toContain(secret);
    for (const cause of [native, secret, new Error(secret, { cause: secret }), { toString() { throw new Error(secret); } }]) {
      expect(describeRecoveryFailure(cause)).toBe("request failed; details withheld");
    }
    expect(describeRecoveryFailure(new VercelApiError("Vercel identity lookup failed with HTTP 403"))).toContain("HTTP 403");
  });
  it("refuses malformed JSON and body read failures", async () => {
    await expect(readRecoveryResponse(new Response('{"private":'))).rejects.toThrow();
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error("fixture-private")); } }));
    await expect(readRecoveryResponse(response)).rejects.toThrow();
  });
  it("keeps configuration and timeout cues actionable without forwarding their cause", () => {
    let error: unknown;
    try { readRecoveryPreviewSettings({ NODE_ENV: "test" }); } catch (cause) { error = cause; }
    expect(describeRecoveryFailure(error)).toContain("VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID");
    expect(describeRecoveryFailure(new DOMException("fixture-private", "TimeoutError"))).toBe("request timed out or was aborted; details withheld");
    expect(describeRecoveryFailure(new Proxy({}, { getPrototypeOf() { throw new Error("fixture-private"); } }))).toBe("request failed; details withheld");
    expect(readRecoveryPreviewSettings({ NODE_ENV: "test", VERCEL_TOKEN: "fixture-token", VERCEL_ORG_ID: "team_x", VERCEL_PROJECT_ID: "prj_x" })).toEqual({ token: "fixture-token", orgId: "team_x", projectId: "prj_x" });
  });
});

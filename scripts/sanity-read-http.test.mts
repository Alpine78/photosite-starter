import { describe, expect, it } from "vitest";
import { readSanityJsonResponse, SanityReadHttpError } from "./sanity-read-http.mts";
const read = (response: Response) => readSanityJsonResponse(response, "Synthetic query");
const message = "[sanity-read-http] Synthetic query returned a non-JSON response";
function chunked(bytes: Uint8Array): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } }));
}
describe("strict shared Sanity JSON response", () => {
  it.each([[0xff], [0x80], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe2, 0x82]].map(bytes => ({ bytes })))
    ("rejects malformed UTF-8 bytes without silent replacement: %j", async ({ bytes: invalid }) => {
      const bytes = Buffer.concat([Buffer.from('{"result":"'), Buffer.from(invalid), Buffer.from('"}')]);
      await expect(read(chunked(bytes))).rejects.toMatchObject({ name: "SanityReadHttpError", message });
    });
  it.each([false, true])("accepts valid chunked Unicode, literal U+FFFD and transport BOM: %s", async (bom) => {
    const body = { result: "\u00e4\u20ac\ud83d\ude00\ufffd" };
    const bytes = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(JSON.stringify(body))]);
    expect(await read(chunked(bytes))).toEqual(body);
  });
  it.each([Buffer.alloc(0), Buffer.from([0xe2, 0x82])])("preserves the fixed non-JSON error for empty or truncated input", async (bytes) => {
    await expect(read(new Response(bytes))).rejects.toMatchObject({ message });
  });
  it("redacts stream rejection and retains no native cause", async () => {
    const result = await read(new Response(new ReadableStream({ start(controller) { controller.error(new Error("synthetic-provider-detail")); } }))).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(SanityReadHttpError); expect(result).toMatchObject({ message });
    expect(result).not.toHaveProperty("cause"); expect((result as Error).stack).not.toContain("synthetic-provider-detail");
  });
  it("rejects HTTP status before consuming the body", async () => {
    const response = new Response("synthetic-provider-detail", { status: 403 });
    await expect(read(response)).rejects.toMatchObject({ name: "SanityReadHttpError", status: 403, message: "[sanity-read-http] Synthetic query failed with HTTP 403" });
    expect(response.bodyUsed).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { sealCapability } from "@/lib/private-gallery-capability";
import { buildPrivateGalleryDeliveryNotification, PrivateGalleryDeliveryNotificationError } from "./private-gallery-delivery-notification";
import type { PrivateGallery } from "@/lib/private-gallery";

const SECRET = Buffer.alloc(32, 21).toString("base64url");
const HANDLE = Buffer.alloc(16, 13).toString("base64url");
const keyring = { activeKeyId: "k1", keyIds: ["k1"], getKey: (id: string) => id === "k1" ? Buffer.alloc(32, 7) : undefined };
const gallery: PrivateGallery = { galleryId: "gallery-notice", galleryHandle: HANDLE, kind: "delivery", state: "published",
  capabilityGeneration: 3, createdAt: new Date("2026-10-15T12:00:00Z"), publishedAt: new Date("2026-10-16T12:00:00Z"), accessExpiresAt: new Date("2027-04-16T12:00:00Z") };
const capability = sealCapability(keyring, { galleryId: gallery.galleryId, handle: HANDLE, generation: 3 }, SECRET);
const input = { gallery, capability, keyring, recipient: "client@example.test", canonicalOrigin: "https://site.example.test",
  routePrefix: "private", locale: "en-GB", outboxIdempotencyKey: "delivery-notification:gallery-notice", now: new Date("2026-10-16T12:01:00Z") };

function refused(overrides: Partial<typeof input>, reason: string) {
  let error: unknown;
  try { buildPrivateGalleryDeliveryNotification({ ...input, ...overrides }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(PrivateGalleryDeliveryNotificationError);
  expect(error).toMatchObject({ reason });
  expect(String(error)).not.toContain(SECRET);
  expect(JSON.stringify(error)).not.toMatch(/client@example|gallery-notice|site\.example/);
  expect((error as Error).cause).toBeUndefined();
}

describe("delivery gallery customer notification", () => {
  it.each(["fi", "en-GB", "fi-FI", "en-US"])("builds transient access instructions in %s from the matching encrypted generation", (locale) => {
    const message = buildPrivateGalleryDeliveryNotification({ ...input, locale });
    const labels = getBuiltInLabels(locale).deliveryNotificationEmail;
    expect(message).toMatchObject({ to: input.recipient, subject: labels.subject, idempotencyKey: input.outboxIdempotencyKey });
    expect(message.text).toContain(labels.ready);
    expect(message.text).toContain(labels.download);
    expect(message.text).toContain(labels.sharing);
    expect(message.text).toContain(labels.replace);
    expect(message.text).toContain("2027-04-16T12:00:00.000Z (UTC)");
    const line = message.text.split("\n").find((value) => value.startsWith("https:"))!;
    expect(line).toBe(`https://site.example.test/private/${HANDLE}#${SECRET}`);
    const url = new URL(line);
    expect(url.search).toBe(""); expect(url.pathname).not.toContain(SECRET); expect(url.hash).toBe(`#${SECRET}`);
    expect(message.subject).not.toContain(HANDLE);
    expect(message.subject).not.toContain(SECRET);
    expect(message.text).not.toContain(gallery.galleryId);
    expect(Object.isFrozen(message)).toBe(true);
  });
  it("preserves a configured private route prefix and explicit HTTPS port", () => {
    expect(buildPrivateGalleryDeliveryNotification({ ...input, canonicalOrigin: "https://site.example.test:8443", routePrefix: "client-photos" }).text)
      .toContain(`https://site.example.test:8443/client-photos/${HANDLE}#${SECRET}`);
  });
  it("refuses capability material for another gallery, handle, generation, key or malformed envelope", () => {
    for (const changed of [{ galleryId: "other-gallery" }, { galleryHandle: Buffer.alloc(16, 14).toString("base64url") }, { capabilityGeneration: 4 }]) {
      refused({ gallery: { ...gallery, ...changed } }, "capability-unavailable");
    }
    refused({ capability: { ...capability, keyId: "other-key" } }, "capability-unavailable");
    refused({ capability: { keyId: "k1", envelope: SECRET } }, "capability-unavailable");
    refused({ keyring: { ...keyring, getKey: () => undefined } }, "capability-unavailable");
  });
  it.each(["draft", "preparing", "ready", "access-suspended", "expiring", "deleting", "deleted"] as const)("refuses %s without exposing a link", (state) => {
    refused({ gallery: { ...gallery, state } }, "invalid-gallery");
  });
  it("refuses proof galleries, invalid handles and invalid generations", () => {
    refused({ gallery: { ...gallery, kind: "proof" } }, "invalid-gallery");
    refused({ gallery: { ...gallery, galleryHandle: "bad/handle" } }, "invalid-gallery");
    for (const capabilityGeneration of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) refused({ gallery: { ...gallery, capabilityGeneration } }, "invalid-gallery");
  });
  it("uses an absolute expiry and refuses invalid/future publication times", () => {
    expect(buildPrivateGalleryDeliveryNotification({ ...input, now: new Date(gallery.accessExpiresAt!.getTime() - 1) }).text).toContain(SECRET);
    refused({ now: gallery.accessExpiresAt! }, "invalid-time");
    refused({ now: new Date(NaN) }, "invalid-time");
    refused({ now: new Date(gallery.publishedAt!.getTime() - 1) }, "invalid-time");
    refused({ gallery: { ...gallery, accessExpiresAt: undefined } }, "invalid-time");
    refused({ gallery: { ...gallery, publishedAt: new Date("2026-01-01Z") } }, "invalid-time");
  });
  it.each(["http://site.example.test", "https://site.example.test/", "https://site.example.test/path", "https://site.example.test?q=1",
    "https://site.example.test#fragment", "https://user:password@site.example.test", "https://site.example.test:", "https://SITE.example.test",
    "https://site.example.test:0", "https://site.example.test:65536", "https://site.example.test\\other", "//site.example.test", "javascript:alert(1)"])("rejects noncanonical origin %s", (canonicalOrigin) => {
    refused({ canonicalOrigin }, "invalid-address");
  });
  it.each(["", "a/b", "../private", "Private", "a%2fb", "a-", "x".repeat(33)])("rejects invalid prefix %s", (routePrefix) => {
    refused({ routePrefix }, "invalid-address");
  });
  it("refuses header injection, invalid recipients, keys and unsupported locale without an unsafe cause", () => {
    for (const recipient of ["x\r\nbcc:bad@example.test", "bad-address"]) refused({ recipient }, "invalid-recipient");
    refused({ outboxIdempotencyKey: "key\r\nsecret" }, "invalid-idempotency-key");
    refused({ locale: "fr" }, "invalid-locale");
  });
  it("does not mutate or retain mutable gallery metadata", () => {
    const copy = structuredClone(gallery);
    const message = buildPrivateGalleryDeliveryNotification({ ...input, gallery: copy });
    copy.accessExpiresAt!.setFullYear(2030);
    expect(message.text).toContain("2027-04-16T12:00:00.000Z");
    expect(gallery.accessExpiresAt!.getUTCFullYear()).toBe(2027);
  });
});

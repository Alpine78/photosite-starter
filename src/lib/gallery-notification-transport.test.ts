import { describe, expect, it } from "vitest";

import {
  buildGalleryNotificationTransport,
  GalleryNotificationTransportConfigurationError,
} from "@/lib/gallery-notification-transport";

const resendEnvironment = {
  PRIVATE_GALLERY_NOTIFICATION_ADAPTER: "resend",
  PRIVATE_GALLERY_NOTIFICATION_FROM: "Studio <notices@studio.example>",
  RESEND_API_KEY: "re_test_key",
};

describe("buildGalleryNotificationTransport", () => {
  it("builds the sink transport, which reports delivery and sends nothing", async () => {
    const transport = buildGalleryNotificationTransport({
      PRIVATE_GALLERY_NOTIFICATION_ADAPTER: "sink",
      SITE_DEPLOYMENT_STAGE: "development",
    });
    expect(transport.name).toBe("sink");
    await expect(
      transport.deliver({
        to: "photographer@studio.example",
        subject: "Proof confirmation",
        text: "001 — DSC_0001.jpg",
        idempotencyKey: "proof-confirmation:gallery-a:1",
      }),
    ).resolves.toEqual({ status: "delivered" });
  });

  it.each(["development", "preview"] as const)(
    "allows the sink transport in a %s deployment",
    (stage) => {
      expect(
        buildGalleryNotificationTransport({
          PRIVATE_GALLERY_NOTIFICATION_ADAPTER: "sink",
          SITE_DEPLOYMENT_STAGE: stage,
        }).name,
      ).toBe("sink");
    },
  );

  it("refuses the sink transport in a production deployment", () => {
    expect(() =>
      buildGalleryNotificationTransport({
        PRIVATE_GALLERY_NOTIFICATION_ADAPTER: "sink",
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toThrow(/must not run in a production deployment/);
  });

  it("treats an undeclared stage as production, so the guard fails closed", () => {
    expect(() =>
      buildGalleryNotificationTransport({
        PRIVATE_GALLERY_NOTIFICATION_ADAPTER: "sink",
      }),
    ).toThrow(/must not run in a production deployment/);
  });

  it("builds the resend transport with the configured sender", () => {
    const transport = buildGalleryNotificationTransport(resendEnvironment);
    expect(transport.name).toBe("resend");
  });

  it("builds the resend transport in production, which is the point", () => {
    expect(
      buildGalleryNotificationTransport({
        ...resendEnvironment,
        SITE_DEPLOYMENT_STAGE: "production",
      }).name,
    ).toBe("resend");
  });

  it("rejects an unknown adapter", () => {
    expect(() =>
      buildGalleryNotificationTransport({
        PRIVATE_GALLERY_NOTIFICATION_ADAPTER: "postcard",
      }),
    ).toThrow(/expected "resend" or "sink"/);
  });

  it("requires an adapter setting with no default", () => {
    expect(() => buildGalleryNotificationTransport({})).toThrow(
      /Missing required deployment setting: PRIVATE_GALLERY_NOTIFICATION_ADAPTER/,
    );
  });

  it.each([
    ["PRIVATE_GALLERY_NOTIFICATION_FROM", { PRIVATE_GALLERY_NOTIFICATION_FROM: undefined }],
    ["RESEND_API_KEY", { RESEND_API_KEY: undefined }],
  ] as const)("requires %s for the resend transport", (settingName, overrides) => {
    expect(() =>
      buildGalleryNotificationTransport({ ...resendEnvironment, ...overrides }),
    ).toThrow(new RegExp(`Missing required deployment setting: ${settingName}`));
  });

  it("raises its own error type, never a bare Error", () => {
    let error: unknown;
    try {
      buildGalleryNotificationTransport({});
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(GalleryNotificationTransportConfigurationError);
  });
});

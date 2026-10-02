import { describe, expect, it } from "vitest";

import { createSinkGalleryNotificationTransport } from "@/lib/gallery-notification-sink";

describe("gallery notification sink transport", () => {
  it("is named sink and reports delivery for any request", async () => {
    const transport = createSinkGalleryNotificationTransport();
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
});

import { describe, expect, it } from "vitest";

import type { ContactDeliveryErrorClass } from "@/lib/contact-delivery";
import {
  CONTACT_SINK_FAILURE_DOMAIN,
  contactSinkFailureAddress,
  createSinkDeliveryAdapter,
} from "@/lib/contact-delivery-sink";

const adapter = createSinkDeliveryAdapter();

function deliverTo(replyTo: string) {
  return adapter.deliver({
    subject: "New contact message — Studio Example",
    text: "Name: Jane Example",
    replyTo,
    idempotencyKey: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  });
}

/**
 * Every failure class and the retry decision it carries. Typed as a total
 * record so adding a class to `ContactDeliveryErrorClass` without deciding
 * whether a retry can help fails the build here rather than shipping a
 * failure the form does not know how to advise on.
 */
const RETRYABLE: Record<ContactDeliveryErrorClass, boolean> = {
  configuration: false,
  "provider-rejected": false,
  "provider-quota-exceeded": false,
  "provider-unavailable": true,
  timeout: true,
};

const errorClasses = Object.keys(RETRYABLE) as ContactDeliveryErrorClass[];

describe("createSinkDeliveryAdapter", () => {
  it("names the delivery path without naming a credential", () => {
    expect(adapter.name).toBe("sink");
  });

  it("accepts an ordinary address and sends nothing", async () => {
    await expect(deliverTo("jane@example.com")).resolves.toEqual({
      status: "delivered",
    });
  });

  it.each(errorClasses)(
    "reports %s for the address reserved for it",
    async (errorClass) => {
      await expect(
        deliverTo(contactSinkFailureAddress(errorClass)),
      ).resolves.toEqual({
        status: "failed",
        errorClass,
        retryable: RETRYABLE[errorClass],
      });
    },
  );

  it("reserves a domain that can never belong to a person", () => {
    // RFC 6761 reserves `.test`, so no address a visitor could receive mail at
    // ends here and no real enquiry can land on a failure by coincidence.
    expect(CONTACT_SINK_FAILURE_DOMAIN.endsWith(".test")).toBe(true);
  });

  it("recognizes the address however the visitor capitalized it", async () => {
    await expect(deliverTo("TimeOut@Delivery-Failure.TEST")).resolves.toEqual({
      status: "failed",
      errorClass: "timeout",
      retryable: true,
    });
  });

  it("delivers to a real domain that borrows a failure class as its name", async () => {
    await expect(deliverTo("timeout@example.com")).resolves.toEqual({
      status: "delivered",
    });
  });

  it("delivers to the reserved domain when the local part names no class", async () => {
    await expect(deliverTo(`visitor@${CONTACT_SINK_FAILURE_DOMAIN}`)).resolves.toEqual({
      status: "delivered",
    });
  });

  it("does not accept an inherited property name as a failure class", async () => {
    // `"toString" in table` would be true. The lookup uses `Object.hasOwn`, so
    // an address naming a prototype member is an ordinary address.
    await expect(
      deliverTo(`toString@${CONTACT_SINK_FAILURE_DOMAIN}`),
    ).resolves.toEqual({ status: "delivered" });
  });
});

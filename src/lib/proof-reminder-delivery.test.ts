import { describe, expect, it, vi } from "vitest";
import { buildProofReminderSender, ProofReminderConfigurationError } from "@/lib/proof-reminder-delivery";

const environment = { CONTACT_DELIVERY_ADAPTER: "resend", RESEND_API_KEY: "re_test", CONTACT_DELIVERY_FROM: "Site <site@example.com>", CONTACT_DELIVERY_TO: "owner@example.com", SITE_DEPLOYMENT_STAGE: "production" };

describe("the reminder transport", () => {
  it("writes to the customer with the owner mailbox as Reply-To and the step's idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "e1" }));
    const send = buildProofReminderSender(environment, fetcher);
    expect(await send({ to: "c@example.fi", subject: "s", text: "t" }, "proof-reminder/g1/2")).toEqual({ status: "delivered" });
    const [, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.to).toEqual(["c@example.fi"]); expect(body.reply_to).toBe("owner@example.com");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("proof-reminder/g1/2");
  });

  it("refuses the sink in production and requires the mailbox settings", () => {
    expect(() => buildProofReminderSender({ ...environment, CONTACT_DELIVERY_ADAPTER: "sink" })).toThrow(ProofReminderConfigurationError);
    expect(() => buildProofReminderSender({ ...environment, CONTACT_DELIVERY_TO: "" })).toThrow(ProofReminderConfigurationError);
  });
});

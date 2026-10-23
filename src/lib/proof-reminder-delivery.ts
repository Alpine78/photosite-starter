/**
 * The customer's reminder transport (ADR-0038 decision 9): the shared Resend
 * boundary with the contact sender, the customer's address as recipient and
 * the owner's contact mailbox as Reply-To. The sink sends nothing and is
 * refused in production, as for contact delivery.
 */
import "server-only";
import { readDeploymentStage } from "@/lib/deployment-stage";
import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import { sendResendEmail } from "@/lib/resend-email";
import type { ReminderEmail } from "@/lib/proof-reminder-access";

const PROOF_REMINDER_TIMEOUT_MS = 10_000;

export class ProofReminderConfigurationError extends Error {
  constructor(message: string) { super(`[proof-reminder-delivery] ${message}`); this.name = "ProofReminderConfigurationError"; }
}
function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ProofReminderConfigurationError(`Missing required deployment setting: ${name}`);
  return value;
}

export function buildProofReminderSender(environment: Readonly<Record<string, string | undefined>>, fetchImplementation?: typeof fetch) {
  const adapter = required(environment, "CONTACT_DELIVERY_ADAPTER");
  if (adapter === "sink") {
    if (readDeploymentStage(environment) === "production") throw new ProofReminderConfigurationError("The sink adapter must not run in production.");
    return async (): Promise<ContactDeliveryOutcome> => ({ status: "delivered" });
  }
  if (adapter !== "resend") throw new ProofReminderConfigurationError("CONTACT_DELIVERY_ADAPTER must be resend or sink.");
  const settings = { apiKey: required(environment, "RESEND_API_KEY"), from: required(environment, "CONTACT_DELIVERY_FROM"), fetchImplementation };
  const replyTo = required(environment, "CONTACT_DELIVERY_TO");
  return (email: ReminderEmail, idempotencyKey: string) =>
    sendResendEmail(settings, { to: email.to, subject: email.subject, text: email.text, replyTo, providerIdempotencyKey: idempotencyKey }, PROOF_REMINDER_TIMEOUT_MS);
}

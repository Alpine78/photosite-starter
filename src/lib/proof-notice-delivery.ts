/**
 * Where the photographer's proof notice goes (ADR-0038 decision 6): the site
 * owner's existing contact mailbox and sender, through the shared Resend
 * boundary, with the proof notice's own subject, text and idempotency key. The
 * `sink` adapter sends nothing and is refused in production, exactly as for
 * contact delivery, so a production deployment cannot silently drop notices.
 */
import "server-only";
import { readDeploymentStage } from "@/lib/deployment-stage";
import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import { sendResendEmail } from "@/lib/resend-email";
import type { ProofNoticeSender } from "@/lib/proof-notice";

const PROOF_NOTICE_TIMEOUT_MS = 10_000;

export class ProofNoticeConfigurationError extends Error {
  constructor(message: string) { super(`[proof-notice-delivery] ${message}`); this.name = "ProofNoticeConfigurationError"; }
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ProofNoticeConfigurationError(`Missing required deployment setting: ${name}`);
  return value;
}

export function buildProofNoticeSender(environment: Readonly<Record<string, string | undefined>>, fetchImplementation?: typeof fetch): ProofNoticeSender {
  const adapter = required(environment, "CONTACT_DELIVERY_ADAPTER");
  if (adapter === "sink") {
    if (readDeploymentStage(environment) === "production") throw new ProofNoticeConfigurationError("The sink adapter must not run in production.");
    return async (): Promise<ContactDeliveryOutcome> => ({ status: "delivered" });
  }
  if (adapter !== "resend") throw new ProofNoticeConfigurationError("CONTACT_DELIVERY_ADAPTER must be resend or sink.");
  const settings = { apiKey: required(environment, "RESEND_API_KEY"), from: required(environment, "CONTACT_DELIVERY_FROM"), fetchImplementation };
  const to = required(environment, "CONTACT_DELIVERY_TO");
  return (email, idempotencyKey) => sendResendEmail(settings, { to, subject: email.subject, text: email.text, providerIdempotencyKey: idempotencyKey }, PROOF_NOTICE_TIMEOUT_MS);
}

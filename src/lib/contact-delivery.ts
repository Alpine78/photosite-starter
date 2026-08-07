/**
 * How a validated contact message becomes a delivered email, and where the
 * provider that delivers it plugs in.
 *
 * The adapter boundary is the point of the module. ADR-0004 §5 makes the
 * delivery account, the recipient mailbox, and their retention controls
 * customer-owned: every clone runs its own, and no shared cross-customer
 * credential exists. A deployment therefore names its adapter and its
 * addresses in configuration, and replacing the provider is one file plus
 * three settings rather than a change to the endpoint.
 *
 * Nothing here is importable from a client component, and nothing here is read
 * at module load: the credentials live behind `getContactDeliveryAdapter`,
 * which the POST handler alone calls. A missing setting fails that call with a
 * `configuration` error class rather than breaking the build or the page, so a
 * developer with no delivery account still gets a working contact page and a
 * clear failure at the moment delivery is attempted.
 */

import {
  readDeploymentStage,
  type BuiltInLabels,
  type DeploymentStage,
} from "@/lib/deployment-config";
import type { ContactMessage } from "@/lib/contact-message";
import { createResendDeliveryAdapter } from "@/lib/contact-delivery-resend";

const contactSettingNames = {
  adapter: "CONTACT_DELIVERY_ADAPTER",
  from: "CONTACT_DELIVERY_FROM",
  to: "CONTACT_DELIVERY_TO",
  resendApiKey: "RESEND_API_KEY",
} as const;

/**
 * Bound on one outbound delivery attempt. It exists so a slow provider becomes
 * a fast, retryable failure the visitor is told about, instead of a request
 * that hangs until the platform kills the function and the visitor sees
 * nothing.
 */
export const CONTACT_DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Why a delivery attempt did not succeed, at the granularity an operational
 * log may record. Each value is a class of failure, never a provider message:
 * ADR-0004 §5 keeps contact fields, provider bodies, and authorization values
 * out of application-emitted logs, and a provider's error text is not
 * guaranteed to be free of the request it describes.
 */
export type ContactDeliveryErrorClass =
  | "configuration"
  /** The request itself was refused: bad sender domain, malformed address. */
  | "provider-rejected"
  /**
   * The account's sending allowance is spent. Separate from a rejection
   * because it is the site owner's billing problem rather than a problem with
   * the message, and separate from a transient outage because waiting a moment
   * does not fix it — the allowance resets on the provider's own schedule.
   */
  | "provider-quota-exceeded"
  | "provider-unavailable"
  | "timeout";

export type ContactDeliveryOutcome =
  | { readonly status: "delivered" }
  | {
      readonly status: "failed";
      readonly errorClass: ContactDeliveryErrorClass;
      /** Whether submitting the same message again could succeed. */
      readonly retryable: boolean;
    };

export type ContactDeliveryRequest = {
  readonly subject: string;
  /** Plain text only. The MVP sends no HTML part and no attachments. */
  readonly text: string;
  /** The visitor's address, so a reply goes to them rather than to the site. */
  readonly replyTo: string;
  /**
   * Stable across retries of one submission and unique per new one, so a
   * provider that supports idempotent sends delivers a retried message once.
   */
  readonly idempotencyKey: string;
};

export type ContactDeliveryAdapter = {
  /** Names the delivery path in operational events. Never a credential. */
  readonly name: string;
  deliver(request: ContactDeliveryRequest): Promise<ContactDeliveryOutcome>;
};

/**
 * Composes the email the site owner receives.
 *
 * The subject carries no visitor-supplied text: a subject line is the one part
 * of a message a mail client shows before anyone has decided to trust it, and
 * a name is the wrong place to let a stranger write there. The name and
 * address appear in the body and in `Reply-To`, where they belong.
 *
 * Labels come from the deployment's default locale because the recipient is
 * the site owner, not the visitor — the enquiry itself stays in whatever
 * language it was written in.
 */
export function buildContactEmail(
  message: ContactMessage,
  { siteName, labels }: { siteName: string; labels: BuiltInLabels },
): Omit<ContactDeliveryRequest, "idempotencyKey"> {
  const { contact } = labels;

  return {
    subject: `${contact.emailSubject} — ${siteName}`,
    text: [
      `${contact.nameLabel}: ${message.name}`,
      `${contact.emailLabel}: ${message.email}`,
      "",
      `${contact.messageLabel}:`,
      message.message,
    ].join("\n"),
    replyTo: message.email,
  };
}

/**
 * Accepts every message and sends nothing.
 *
 * This is the adapter Preview and CI run on (ADR-0004 §3): the release
 * candidate and the Playwright journey exercise the real endpoint, the real
 * validation, and the real response contract without a credential in the
 * environment or a synthetic enquiry in a real mailbox. It is a delivery
 * boundary that succeeds, not a stub of the endpoint.
 *
 * It reports success, which is the whole point everywhere it belongs and
 * silent data loss in production — a visitor would be told their enquiry was
 * sent and it would exist nowhere. `buildContactDeliveryAdapter` therefore
 * refuses to build it in a production deployment; documentation saying where it
 * belongs is not a control, and this one is worth having as code.
 */
function createSinkDeliveryAdapter(): ContactDeliveryAdapter {
  return {
    name: "sink",
    async deliver() {
      return { status: "delivered" };
    },
  };
}

type ContactEnvironment = Record<string, string | undefined>;

/** Raised when a deployment's delivery settings are missing or unusable. */
export class ContactDeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(`[contact-delivery] ${message}`);
    this.name = "ContactDeliveryConfigurationError";
  }
}

function requireSetting(
  environment: ContactEnvironment,
  settingName: string,
): string {
  const value = environment[settingName]?.trim();
  if (!value) {
    throw new ContactDeliveryConfigurationError(
      `Missing required deployment setting: ${settingName}`,
    );
  }
  return value;
}

/**
 * Builds the adapter a deployment configured.
 *
 * The adapter is named explicitly and has no default. A default of `sink`
 * would let a production deployment silently discard enquiries; a default of
 * `resend` would make every developer machine fail on a missing credential.
 * Neither is a better outcome than the first attempted delivery reporting
 * which setting it needs without claiming success.
 */
export function buildContactDeliveryAdapter(
  environment: ContactEnvironment,
): ContactDeliveryAdapter {
  const adapter = requireSetting(environment, contactSettingNames.adapter);
  const stage: DeploymentStage = readDeploymentStage(environment);

  switch (adapter) {
    case "sink":
      // Fail closed before the adapter can accept anything: a production
      // deployment configured this way is a misconfiguration, not a mode.
      if (stage === "production") {
        throw new ContactDeliveryConfigurationError(
          `Invalid ${contactSettingNames.adapter}: the "sink" adapter accepts a message and sends nothing, so it must not run in a production deployment. Configure a delivery provider, or declare ${"SITE_DEPLOYMENT_STAGE"} as development or preview.`,
        );
      }
      return createSinkDeliveryAdapter();
    case "resend":
      return createResendDeliveryAdapter({
        apiKey: requireSetting(environment, contactSettingNames.resendApiKey),
        from: requireSetting(environment, contactSettingNames.from),
        to: requireSetting(environment, contactSettingNames.to),
      });
    default:
      throw new ContactDeliveryConfigurationError(
        `Invalid ${contactSettingNames.adapter}: expected "resend" or "sink", received "${adapter}"`,
      );
  }
}

let cachedAdapter: ContactDeliveryAdapter | undefined;

/**
 * The configured adapter, built once per runtime instance. Caching the adapter
 * caches no request state, so it holds nothing an instance would have to share
 * with another one (ADR-0004 §2).
 */
export function getContactDeliveryAdapter(): ContactDeliveryAdapter {
  cachedAdapter ??= buildContactDeliveryAdapter(process.env);
  return cachedAdapter;
}

/**
 * How a queued private-gallery notification attempt (AB#130's proof
 * confirmation, and any future AB#29 delivery notification) becomes a
 * delivered email, and where the provider that delivers it plugs in.
 *
 * This is the `gallery-notification transport` ADR-0014 §8d requires:
 * "Neither can reuse the `ContactDeliveryRequest` contract, which carries no
 * recipient and whose adapter factory binds every send to the single
 * configured `CONTACT_DELIVERY_TO` owner mailbox. Instead, a
 * gallery-notification transport with a validated per-message recipient sits
 * on top of the same Resend HTTP provider adapter." It mirrors
 * `buildContactDeliveryAdapter` deliberately: same explicit-adapter-with-no-
 * default shape, same production refusal of the sink, same lazy
 * per-runtime-instance cache — a deployment already trusts that pattern for
 * the contact path, and a second delivery boundary reusing it is one fewer
 * thing to review.
 *
 * Nothing here is wired into a route or a scheduled worker yet: ADR-0014 §7
 * and §8d name the retention worker and the outbox dispatcher as their own
 * action items, needing a durable store neither has (`docs/feature-status.md`).
 * This module is the configuration and provider-selection half a future
 * worker supplies to `runPrivateGalleryProofOutboxBatch`; building the
 * durable worker runtime itself is out of this slice.
 */
import "server-only";

import {
  readDeploymentStage,
  type DeploymentStage,
} from "@/lib/deployment-stage";
import type { GalleryNotificationTransport } from "@/lib/gallery-notification";
import { createResendGalleryNotificationTransport } from "@/lib/gallery-notification-resend";
import { createSinkGalleryNotificationTransport } from "@/lib/gallery-notification-sink";

const settingNames = {
  adapter: "PRIVATE_GALLERY_NOTIFICATION_ADAPTER",
  from: "PRIVATE_GALLERY_NOTIFICATION_FROM",
  resendApiKey: "RESEND_API_KEY",
} as const;

type Environment = Record<string, string | undefined>;

/** Raised when a deployment's gallery-notification transport settings are unusable. */
export class GalleryNotificationTransportConfigurationError extends Error {
  constructor(message: string) {
    super(`[gallery-notification-transport] ${message}`);
    this.name = "GalleryNotificationTransportConfigurationError";
  }
}

function requireSetting(environment: Environment, settingName: string): string {
  const value = environment[settingName]?.trim();
  if (!value) {
    throw new GalleryNotificationTransportConfigurationError(
      `Missing required deployment setting: ${settingName}`,
    );
  }
  return value;
}

/**
 * Builds the transport a deployment configured. No default, for the same
 * reason `buildContactDeliveryAdapter` has none: a default of `sink` would
 * let a production deployment silently discard proof-confirmation
 * notifications, and a default of `resend` would make every developer
 * machine fail on a missing credential.
 */
export function buildGalleryNotificationTransport(
  environment: Environment,
): GalleryNotificationTransport {
  const adapter = requireSetting(environment, settingNames.adapter);
  const stage: DeploymentStage = readDeploymentStage(environment);

  switch (adapter) {
    case "sink":
      if (stage === "production") {
        throw new GalleryNotificationTransportConfigurationError(
          `Invalid ${settingNames.adapter}: the "sink" transport accepts a notification and sends nothing, so it must not run in a production deployment. Configure "resend", or declare SITE_DEPLOYMENT_STAGE as development or preview.`,
        );
      }
      return createSinkGalleryNotificationTransport();
    case "resend":
      return createResendGalleryNotificationTransport({
        apiKey: requireSetting(environment, settingNames.resendApiKey),
        from: requireSetting(environment, settingNames.from),
      });
    default:
      throw new GalleryNotificationTransportConfigurationError(
        `Invalid ${settingNames.adapter}: expected "resend" or "sink", received "${adapter}"`,
      );
  }
}

let cached: GalleryNotificationTransport | undefined;

/**
 * The configured transport, built once per runtime instance — the same
 * per-instance cache `getContactDeliveryAdapter` uses, and safe for the same
 * reason: the transport holds no per-request state, only its provider
 * settings.
 */
export function getGalleryNotificationTransport(): GalleryNotificationTransport {
  cached ??= buildGalleryNotificationTransport(process.env);
  return cached;
}

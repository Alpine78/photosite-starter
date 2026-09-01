/**
 * The operational events the contact endpoint — and, since AB#60, the gallery
 * enquiry endpoint — write, and nothing else.
 *
 * ADR-0004 §5 fixes this schema: a random correlation identifier, a state, and
 * a redacted error class — nothing else. No name, no address, no message, no
 * provider response body, no authorization value, no client identifier. The
 * event type is deliberately closed and the emitter takes no free-form payload,
 * so a later change cannot widen it by accident: adding a field means editing
 * this file and re-reading the boundary the project owner accepted.
 *
 * Both flows share one line-writer (`writeSubmissionLine`, module-private) but
 * keep separate, separately-closed public wrappers and event types, so a
 * contact caller cannot compile while logging an enquiry-only class and vice
 * versa. The writer's `errorClass` argument is the *union* of the two closed
 * class sets — never a bare `string` — so nothing can route arbitrary text
 * through it either. The event name is a closed union too.
 *
 * The adapter that handled a delivery is not recorded either. It is not
 * personal data and it would be useful, but the accepted schema names three
 * fields and this module does not get to add a fourth on its own judgment.
 *
 * Not every refused request produces an event. A request that fails the
 * stateless header checks — wrong method, wrong content type, another site's
 * origin — never became a submission, and emitting a line for each would hand
 * an unbounded log-volume lever to anyone willing to keep sending. Those are
 * visible as statuses in the hosting provider's own request log. A throttled
 * client is logged once per window for the same reason.
 *
 * The correlation identifier is minted per request from a cryptographic random
 * source. It embeds nothing about the visitor or the message, and when an event
 * is written it is returned to the client so a person can quote it when asking
 * what happened. An unlogged refusal returns no identifier: a reference that
 * cannot be found is worse than none. It is never stored beside form content —
 * because no form content is stored at all.
 */

import { randomUUID } from "node:crypto";

import type { PrivateGalleryExchangeFailure } from "@/lib/private-gallery-access";
import type { ContactDeliveryErrorClass } from "@/lib/contact-delivery";
import type { ContactRejectionReason } from "@/lib/contact-request";
import type { EnquiryResolutionRejection } from "@/lib/enquiry-media";

/**
 * Every value `errorClass` may take on a contact event, as a type rather than
 * as a promise in a comment. A free `string` here would let a future caller
 * pass a provider's error message — prose that can restate the request it
 * describes — straight into the log the whole privacy boundary rests on. The
 * compiler refuses it.
 */
export type ContactErrorClass =
  | ContactRejectionReason
  | ContactDeliveryErrorClass
  /** The hidden field was filled, so nothing was delivered. */
  | "honeypot";

/**
 * The enquiry endpoint's own closed class set. It adds every
 * `EnquiryResolutionRejection` (structural, never personal data — only the
 * *response* is coarsened) and `"internal"`, the one case the route cannot
 * classify: it logs a terminal event and then lets the defect propagate so a
 * genuine bug still surfaces a server-side stack.
 */
export type EnquiryErrorClass =
  | ContactRejectionReason
  | ContactDeliveryErrorClass
  | EnquiryResolutionRejection
  | "honeypot"
  | "internal";

/** The states any submission event may report. */
export type SubmissionState =
  | "accepted"
  | "delivered"
  | "rejected"
  | "delivery-failed";

/** The closed set of event names the submission-log family emits. */
type SubmissionEventName =
  | "contact.submission"
  | "enquiry.submission"
  | "private-gallery.exchange";

export type ContactEvent =
  | {
      readonly correlationId: string;
      readonly state: "accepted" | "delivered";
      readonly errorClass?: never;
    }
  | {
      readonly correlationId: string;
      readonly state: "rejected" | "delivery-failed";
      readonly errorClass: ContactErrorClass;
    };

export type EnquiryEvent =
  | {
      readonly correlationId: string;
      readonly state: "accepted" | "delivered";
      readonly errorClass?: never;
    }
  | {
      readonly correlationId: string;
      readonly state: "rejected" | "delivery-failed";
      readonly errorClass: EnquiryErrorClass;
    };

/**
 * One private-gallery exchange event (AB#29, ADR-0014 §3). The class is the
 * facade's own refusal reason, imported as a type so the two cannot drift; the
 * route emits an event only for the refusals the facade marks `logWorthy`, so a
 * prober sending well-formed handles cannot flood the log.
 */
export type PrivateGalleryExchangeEvent =
  | {
      readonly correlationId: string;
      readonly state: "accepted";
      readonly errorClass?: never;
    }
  | {
      readonly correlationId: string;
      readonly state: "rejected";
      readonly errorClass: PrivateGalleryExchangeFailure["reason"];
    };

export function createCorrelationId(): string {
  return randomUUID();
}

/**
 * Writes one submission event as a single line of JSON.
 *
 * Module-private, and its `errorClass` is the union of the two closed class
 * sets — never a bare `string` — so the only way to log is through
 * `logContactEvent` / `logEnquiryEvent`, each of which has already narrowed to
 * its own set. A failure goes to `console.error` and everything else to
 * `console.info`, so platform log filtering can separate them without parsing.
 * One line keeps it greppable and keeps a multi-line value — the one shape a
 * form field could take — impossible to introduce.
 */
function writeSubmissionLine(
  name: SubmissionEventName,
  correlationId: string,
  state: SubmissionState,
  errorClass?:
    | ContactErrorClass
    | EnquiryErrorClass
    | PrivateGalleryExchangeFailure["reason"],
): void {
  const line = JSON.stringify({
    event: name,
    correlationId,
    state,
    ...(errorClass === undefined ? {} : { errorClass }),
  });

  if (state === "delivery-failed" || state === "rejected") {
    console.error(line);
  } else {
    console.info(line);
  }
}

/** Emits one contact-endpoint operational event. */
export function logContactEvent(event: ContactEvent): void {
  writeSubmissionLine(
    "contact.submission",
    event.correlationId,
    event.state,
    event.errorClass,
  );
}

/** Emits one gallery-enquiry operational event (AB#60). */
export function logEnquiryEvent(event: EnquiryEvent): void {
  writeSubmissionLine(
    "enquiry.submission",
    event.correlationId,
    event.state,
    event.errorClass,
  );
}

/** Emits one private-gallery capability-exchange event (AB#29). */
export function logPrivateGalleryExchangeEvent(
  event: PrivateGalleryExchangeEvent,
): void {
  writeSubmissionLine(
    "private-gallery.exchange",
    event.correlationId,
    event.state,
    event.errorClass,
  );
}

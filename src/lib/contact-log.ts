/**
 * The only thing the contact endpoint writes anywhere.
 *
 * ADR-0004 §5 fixes this schema: a random correlation identifier, a state, and
 * a redacted error class — nothing else. No name, no address, no message, no
 * provider response body, no authorization value, no client identifier. The
 * event type is deliberately closed and the emitter takes no free-form payload,
 * so a later change cannot widen it by accident: adding a field means editing
 * this file and re-reading the boundary the project owner accepted.
 *
 * The adapter that handled a delivery is not recorded either. It is not
 * personal data and it would be useful, but the accepted schema names three
 * fields and this module does not get to add a fourth on its own judgment.
 *
 * Not every refused request produces an event. A request that fails the
 * stateless header checks — wrong method, wrong content type, another site's
 * origin — never became a submission, and emitting a line for each would hand
 * an unbounded log-volume lever to anyone willing to keep sending. Those are
 * visible as statuses in the hosting provider's own request log, which
 * `docs/contact-data-flow.md` records. A throttled client is logged once per
 * window for the same reason.
 *
 * The correlation identifier is minted per request from a cryptographic random
 * source. It embeds nothing about the visitor or the message, and when an event
 * is written it is returned to the client so a person can quote it when asking
 * what happened. An unlogged refusal returns no identifier: a reference that
 * cannot be found is worse than none. It is never stored beside form content —
 * because no form content is stored at all.
 */

import { randomUUID } from "node:crypto";
import type { ContactDeliveryErrorClass } from "@/lib/contact-delivery";
import type { ContactRejectionReason } from "@/lib/contact-request";

/**
 * Every value `errorClass` may take, as a type rather than as a promise in a
 * comment. A free `string` here would let a future caller pass a provider's
 * error message — prose that can restate the request it describes — straight
 * into the log the whole privacy boundary rests on. The compiler refuses it.
 */
export type ContactErrorClass =
  | ContactRejectionReason
  | ContactDeliveryErrorClass
  /** The hidden field was filled, so nothing was delivered. */
  | "honeypot";

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

export function createCorrelationId(): string {
  return randomUUID();
}

/**
 * Emits one operational event.
 *
 * A failure goes to `console.error` and everything else to `console.info`, so
 * platform log filtering can separate them without parsing. The payload is
 * serialized as JSON on one line, which keeps it greppable and keeps a
 * multi-line value — the one shape a form field could take — impossible to
 * introduce here.
 */
export function logContactEvent(event: ContactEvent): void {
  const line = JSON.stringify({
    event: "contact.submission",
    correlationId: event.correlationId,
    state: event.state,
    ...(event.errorClass === undefined ? {} : { errorClass: event.errorClass }),
  });

  if (event.state === "delivery-failed" || event.state === "rejected") {
    console.error(line);
  } else {
    console.info(line);
  }
}

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
 * The correlation identifier is minted per request from a cryptographic random
 * source. It embeds nothing about the visitor or the message, it is returned to
 * the client so a person can quote it when asking what happened, and it is
 * never stored beside form content — because no form content is stored at all.
 */

import { randomUUID } from "node:crypto";

export type ContactEventState =
  | "accepted"
  | "rejected"
  | "delivered"
  | "delivery-failed";

export type ContactEvent = {
  readonly correlationId: string;
  readonly state: ContactEventState;
  /**
   * Present only on a non-success state. Always one of the closed sets the
   * request boundary and the delivery adapters define, never provider prose.
   */
  readonly errorClass?: string;
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

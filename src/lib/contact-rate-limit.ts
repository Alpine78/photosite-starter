/**
 * Best-effort submission throttling for the contact endpoint.
 *
 * ADR-0004 §2 forbids depending on process memory for *shared* state, and the
 * MVP provisions no shared store. This limiter therefore makes no cross-instance
 * promise: it is a local heuristic that blunts a burst from one client against
 * one runtime instance, sitting underneath the platform's own firewall and rate
 * controls, which ADR-0004 §5 keeps as the defense-in-depth layer above the
 * application. It is documented as best-effort rather than presented as a
 * guarantee, because a limiter that quietly does less than its name suggests is
 * worse than one whose limits are written down.
 *
 * The privacy shape matters as much as the throttling. A client is tracked as a
 * keyed hash of its address, salted with a value minted fresh at module load,
 * so the stored key cannot be reversed to an address, cannot be correlated
 * across instances, and stops meaning anything the moment the instance ends.
 * Nothing here is logged, returned, or persisted.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Attempts one client may make per window.
 *
 * Set generously rather than tightly. A single address can be a whole office or
 * a mobile carrier's NAT pool, so a low ceiling refuses real enquiries before
 * it inconveniences anyone sending them automatically — and this limiter is
 * per-instance defense in depth, not the control that stops a determined
 * sender. The public-journey suite also submits through this endpoint from one
 * loopback address across the whole browser matrix, retries included.
 */
export const CONTACT_RATE_LIMIT_MAX_ATTEMPTS = 10;

export const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Upper bound on tracked clients, so a burst of distinct addresses cannot grow
 * the map without limit. Reaching it drops expired entries first and, failing
 * that, clears the map: losing throttling state is a smaller problem than an
 * instance running out of memory, and the platform layer still applies.
 */
const MAX_TRACKED_CLIENTS = 10_000;

/** Per-instance and per-process. Never configured, never logged, never stored. */
const CLIENT_KEY_SALT = randomBytes(32);

type ClientWindow = {
  windowStartedAt: number;
  attempts: number;
  refusals: number;
};

/**
 * `firstRefusalInWindow` exists so the caller can log a refusal once instead of
 * once per request. Without it, the cheapest way to flood the application's
 * operational log would be to keep sending after being throttled — which is
 * exactly what an automated client does.
 */
export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly firstRefusalInWindow: boolean };

export type ContactRateLimiter = {
  /** Whether this attempt is within the window's allowance, counting it. */
  tryConsume(clientKey: string, now: number): RateLimitDecision;
};

export function createContactRateLimiter({
  maxAttempts = CONTACT_RATE_LIMIT_MAX_ATTEMPTS,
  windowMs = CONTACT_RATE_LIMIT_WINDOW_MS,
}: {
  maxAttempts?: number;
  windowMs?: number;
} = {}): ContactRateLimiter {
  const windows = new Map<string, ClientWindow>();

  function prune(now: number): void {
    for (const [key, window] of windows) {
      if (now - window.windowStartedAt >= windowMs) windows.delete(key);
    }
    if (windows.size >= MAX_TRACKED_CLIENTS) windows.clear();
  }

  return {
    tryConsume(clientKey, now) {
      const existing = windows.get(clientKey);

      if (existing === undefined || now - existing.windowStartedAt >= windowMs) {
        if (windows.size >= MAX_TRACKED_CLIENTS) prune(now);
        windows.set(clientKey, {
          windowStartedAt: now,
          attempts: 1,
          refusals: 0,
        });
        return { allowed: true };
      }

      if (existing.attempts >= maxAttempts) {
        existing.refusals += 1;
        return { allowed: false, firstRefusalInWindow: existing.refusals === 1 };
      }

      existing.attempts += 1;
      return { allowed: true };
    },
  };
}

/**
 * An opaque, salted identity for the client behind a request.
 *
 * The address comes from the proxy header the hosting platform sets. A client
 * can forge it, which only ever splits its own throttling bucket — it cannot
 * take another client's allowance away, because the value is never used for
 * anything but counting. A request with no address at all falls into one shared
 * bucket rather than escaping the limit.
 */
export function deriveClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "";

  return createHash("sha256")
    .update(CLIENT_KEY_SALT)
    .update(address)
    .digest("base64url");
}

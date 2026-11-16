import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Shared guards for the platform-cron routes (`/api/client-gallery-cleanup`,
 * `/api/proof-reminders`), so the two cannot drift apart again (AB#420).
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** True only for the exact `Bearer <secret>` header, compared in constant time. */
export function isCronBearer(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`), presented = Buffer.from(header ?? "");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * The answer for every method but GET. Next.js implements a missing HEAD by
 * calling GET, and both routes mutate state, so each exports this for HEAD and
 * every other method rather than leaving any of them to the framework.
 */
export function cronMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "GET" } });
}

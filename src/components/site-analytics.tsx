"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { scrubAnalyticsEvent, type SiteAnalyticsPolicy } from "@/lib/site-analytics";

/**
 * The only place the analytics provider's script is loaded (ADR-0037). It is
 * rendered by `SiteRoot` alone, so the document shells of the private, client
 * and administrator namespaces never include it; `beforeSend` still drops those
 * namespaces and strips query strings and fragments from every other URL.
 */
export function SiteAnalytics({ policy }: Readonly<{ policy: SiteAnalyticsPolicy }>) {
  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent) => scrubAnalyticsEvent(event, policy)}
    />
  );
}

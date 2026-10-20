"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { scrubAnalyticsEvent, type SiteAnalyticsPolicy } from "@/lib/site-analytics";

/**
 * The only place the Speed Insights script is loaded (ADR-0037 amendment,
 * AB#376). Like `SiteAnalytics`, it is rendered by `SiteRoot` alone, and the
 * same policy drops private, client and administrator namespaces and strips
 * query strings and fragments before a Web Vital leaves the browser.
 */
export function SiteSpeedInsights({ policy }: Readonly<{ policy: SiteAnalyticsPolicy }>) {
  return <SpeedInsights beforeSend={(event) => scrubAnalyticsEvent(event, policy)} />;
}

/**
 * Opt-in, cookieless site analytics (ADR-0037, AB#371).
 *
 * Pure decisions only: whether analytics is on for this deployment, which route
 * namespaces never report, and how an event URL is reduced before it leaves the
 * browser. The one component that loads the provider's script is
 * `src/components/site-analytics.tsx`; nothing here touches the network.
 */
import { readDeploymentStage, type DeploymentStage } from "@/lib/deployment-stage";
import { LEGACY_GALLERY_ROOT } from "@/lib/legacy-gallery-path";
import { PROOF_GALLERY_ROOT } from "@/lib/proof-gallery-path";

const SITE_ANALYTICS_SETTING = "SITE_ANALYTICS";

export type SiteAnalyticsProvider = "off" | "vercel";

const PROVIDERS: readonly SiteAnalyticsProvider[] = ["off", "vercel"];

/** Root segments that never report, beside the deployment's private prefixes. */
const ALWAYS_EXCLUDED_ROOT_SEGMENTS: readonly string[] = [LEGACY_GALLERY_ROOT, PROOF_GALLERY_ROOT, "api"];

/**
 * Which provider this deployment reports to.
 *
 * Unset means off, the opposite direction to the deployment stage: a clone
 * that never heard of analytics sends nothing. A recognized provider is
 * honored only in a production stage, so development, Preview and the
 * Playwright harness never load it even when the setting is inherited.
 * Anything else is a configuration error, not a silent "off", because an
 * operator who typed a provider expects statistics.
 */
export function readSiteAnalyticsProvider(
  environment: Record<string, string | undefined>,
  stage: DeploymentStage = readDeploymentStage(environment),
): SiteAnalyticsProvider {
  const value = environment[SITE_ANALYTICS_SETTING]?.trim();
  if (!value) return "off";
  if (!PROVIDERS.includes(value as SiteAnalyticsProvider)) {
    throw new Error(
      `[site-analytics] Invalid ${SITE_ANALYTICS_SETTING}: expected one of ${PROVIDERS.join(", ")}, received "${value}"`,
    );
  }
  return stage === "production" ? (value as SiteAnalyticsProvider) : "off";
}

const SITE_SPEED_INSIGHTS_SETTING = "SITE_SPEED_INSIGHTS";

/**
 * Whether this deployment reports Web Vitals to Vercel Speed Insights
 * (ADR-0037 amendment, AB#376). The same contract as `SITE_ANALYTICS`: unset
 * means off, only a production stage honors it, and an unknown value is a
 * configuration error. It is a separate switch, so analytics and performance
 * measurement are enabled, disabled and assessed independently.
 */
export function readSiteSpeedInsightsProvider(
  environment: Record<string, string | undefined>,
  stage: DeploymentStage = readDeploymentStage(environment),
): SiteAnalyticsProvider {
  const value = environment[SITE_SPEED_INSIGHTS_SETTING]?.trim();
  if (!value) return "off";
  if (!PROVIDERS.includes(value as SiteAnalyticsProvider)) {
    throw new Error(
      `[site-analytics] Invalid ${SITE_SPEED_INSIGHTS_SETTING}: expected one of ${PROVIDERS.join(", ")}, received "${value}"`,
    );
  }
  return stage === "production" ? (value as SiteAnalyticsProvider) : "off";
}

export type SiteAnalyticsPolicy = Readonly<{
  /** Root segments whose whole subtree is excluded (see `isAnalyticsExcludedPath`). */
  excludedRootSegments: readonly string[];
  /** Configured locale prefixes, so `/en/<excluded>` aliases are excluded too. */
  localePrefixes: readonly string[];
}>;

/**
 * The exclusion policy, derived from the same reserved prefixes the Proxy
 * enforces rather than from a second hand-kept list. Plain strings only: the
 * result is passed from a server component to the client component.
 */
export function buildSiteAnalyticsPolicy(input: {
  privateRoutePrefix: string;
  privateAdminRoutePrefix: string;
  localePrefixes: readonly (string | null)[];
}): SiteAnalyticsPolicy {
  return {
    excludedRootSegments: [
      ...ALWAYS_EXCLUDED_ROOT_SEGMENTS,
      input.privateRoutePrefix,
      input.privateAdminRoutePrefix,
    ],
    localePrefixes: input.localePrefixes.filter(
      (prefix): prefix is string => prefix !== null,
    ),
  };
}

function decodeSegment(value: string | undefined): string {
  if (value === undefined || value.length > 128) return "";
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    // An undecodable segment cannot be proven public, so fail toward excluding.
    return "\0";
  }
}

/**
 * Whether a pathname is inside an excluded namespace, directly or beneath a
 * locale prefix. Segments are decoded and lowercased first, so an encoded or
 * differently-cased alias of a reserved namespace cannot report.
 */
export function isAnalyticsExcludedPath(
  pathname: string,
  policy: SiteAnalyticsPolicy,
): boolean {
  const segments = pathname.slice(1).split("/", 3);
  const first = decodeSegment(segments[0]);
  if (first === "\0" || policy.excludedRootSegments.includes(first)) return true;
  if (!policy.localePrefixes.includes(first)) return false;
  const second = decodeSegment(segments[1]);
  return second === "\0" || policy.excludedRootSegments.includes(second);
}

/**
 * The provider's `beforeSend` hook: drop events from excluded namespaces and
 * reduce every other URL to origin and pathname. Query strings and fragments
 * can carry tokens or personal data (ADR-0004), so none is ever sent. An
 * unparsable URL is dropped rather than forwarded.
 */
export function scrubAnalyticsEvent<T extends { url: string }>(
  event: T,
  policy: SiteAnalyticsPolicy,
): T | null {
  let url: URL;
  try {
    url = new URL(event.url);
  } catch {
    return null;
  }
  if (isAnalyticsExcludedPath(url.pathname, policy)) return null;
  return { ...event, url: `${url.origin}${url.pathname}` };
}

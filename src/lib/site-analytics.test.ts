import { describe, expect, it } from "vitest";
import {
  buildSiteAnalyticsPolicy,
  isAnalyticsExcludedPath,
  readSiteAnalyticsProvider,
  readSiteSpeedInsightsProvider,
  scrubAnalyticsEvent,
} from "@/lib/site-analytics";

describe("readSiteAnalyticsProvider", () => {
  it.each([undefined, "", "   ", "off"])("is off when the setting is %j", (value) => {
    expect(
      readSiteAnalyticsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_ANALYTICS: value }),
    ).toBe("off");
  });

  it("reports to Vercel only in a production stage", () => {
    expect(
      readSiteAnalyticsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_ANALYTICS: "vercel" }),
    ).toBe("vercel");
  });

  it("treats an unset stage as production, matching the stage reader", () => {
    expect(readSiteAnalyticsProvider({ SITE_ANALYTICS: " vercel " })).toBe("vercel");
  });

  it.each(["development", "preview"])(
    "stays off in the %s stage even when the setting is inherited",
    (stage) => {
      expect(
        readSiteAnalyticsProvider({ SITE_DEPLOYMENT_STAGE: stage, SITE_ANALYTICS: "vercel" }),
      ).toBe("off");
    },
  );

  it.each(["Vercel", "plausible", "on", "true"])(
    "refuses the unknown provider %j rather than silently dropping statistics",
    (value) => {
      expect(() =>
        readSiteAnalyticsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_ANALYTICS: value }),
      ).toThrow(/Invalid SITE_ANALYTICS/);
    },
  );

  it("still validates the value outside production", () => {
    expect(() =>
      readSiteAnalyticsProvider({ SITE_DEPLOYMENT_STAGE: "development", SITE_ANALYTICS: "nope" }),
    ).toThrow(/Invalid SITE_ANALYTICS/);
  });
});

const policy = buildSiteAnalyticsPolicy({
  privateRoutePrefix: "private",
  privateAdminRoutePrefix: "studio-admin",
  localePrefixes: [null, "en"],
});

describe("buildSiteAnalyticsPolicy", () => {
  it("excludes the legacy, private, administrator and API roots", () => {
    expect(policy.excludedRootSegments).toEqual([
      "client-gallery",
      "api",
      "private",
      "studio-admin",
    ]);
  });

  it("keeps only real locale prefixes, dropping the unprefixed default", () => {
    expect(policy.localePrefixes).toEqual(["en"]);
  });
});

describe("isAnalyticsExcludedPath", () => {
  it.each([
    "/client-gallery",
    "/client-gallery/0123456789abcdef0123456789abcdef",
    "/private",
    "/private/abc",
    "/studio-admin/login",
    "/api/contact",
    "/en/client-gallery/0123456789abcdef0123456789abcdef",
    "/en/private",
    "/en/studio-admin",
    "/Client-Gallery/x",
    "/%63lient-gallery/x",
    "/en/%50rivate",
    "/%E0%A4%A",
    "/en/%E0%A4%A",
  ])("excludes %s", (pathname) => {
    expect(isAnalyticsExcludedPath(pathname, policy)).toBe(true);
  });

  it.each([
    "/",
    "/en",
    "/en/",
    "/stories/coast",
    "/en/stories/coast",
    "/stories/private",
    "/stories/client-gallery",
    "/privateer",
    "/private-notes",
    "/fi/private",
    "/contact",
  ])("keeps %s reporting", (pathname) => {
    expect(isAnalyticsExcludedPath(pathname, policy)).toBe(false);
  });
});

describe("scrubAnalyticsEvent", () => {
  it("reduces a reporting URL to origin and pathname", () => {
    expect(
      scrubAnalyticsEvent(
        { type: "pageview" as const, url: "https://example.test/stories/coast?token=secret&cursor=abc#frag" },
        policy,
      ),
    ).toEqual({ type: "pageview", url: "https://example.test/stories/coast" });
  });

  it("keeps the other event fields untouched", () => {
    expect(
      scrubAnalyticsEvent({ type: "event" as const, url: "https://example.test/?q=1", extra: 7 }, policy),
    ).toEqual({ type: "event", url: "https://example.test/", extra: 7 });
  });

  it("drops events from an excluded namespace, with or without a query or fragment", () => {
    for (const url of [
      "https://example.test/client-gallery/0123456789abcdef0123456789abcdef",
      "https://example.test/private/abc?access=secret",
      "https://example.test/en/studio-admin#session",
    ]) {
      expect(scrubAnalyticsEvent({ type: "pageview" as const, url }, policy)).toBeNull();
    }
  });

  it("drops an event whose URL cannot be parsed", () => {
    expect(scrubAnalyticsEvent({ type: "pageview" as const, url: "not a url" }, policy)).toBeNull();
  });

  it("never mutates its input", () => {
    const event = { type: "pageview" as const, url: "https://example.test/a?b=1#c" };
    scrubAnalyticsEvent(event, policy);
    expect(event.url).toBe("https://example.test/a?b=1#c");
  });
});

describe("readSiteSpeedInsightsProvider (AB#376)", () => {
  it.each([undefined, "", " ", "off"])("is off when the setting is %j", (value) => {
    expect(readSiteSpeedInsightsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_SPEED_INSIGHTS: value })).toBe("off");
  });

  it("is on only in production and independent of SITE_ANALYTICS", () => {
    expect(readSiteSpeedInsightsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_SPEED_INSIGHTS: "vercel" })).toBe("vercel");
    expect(readSiteSpeedInsightsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_ANALYTICS: "vercel" })).toBe("off");
    for (const stage of ["development", "preview"]) {
      expect(readSiteSpeedInsightsProvider({ SITE_DEPLOYMENT_STAGE: stage, SITE_SPEED_INSIGHTS: "vercel" })).toBe("off");
    }
  });

  it.each(["on", "true", "Vercel"])("rejects %j as a configuration error", (value) => {
    expect(() => readSiteSpeedInsightsProvider({ SITE_DEPLOYMENT_STAGE: "production", SITE_SPEED_INSIGHTS: value }))
      .toThrow(/Invalid SITE_SPEED_INSIGHTS/);
  });

  it("drops a vital from an excluded namespace and strips the query from others", () => {
    const policy = { excludedRootSegments: ["private"], localePrefixes: ["en"] };
    expect(scrubAnalyticsEvent({ type: "vital" as const, url: "https://example.test/en/private/x" }, policy)).toBeNull();
    expect(scrubAnalyticsEvent({ type: "vital" as const, url: "https://example.test/stories?q=a#b", route: "/stories" }, policy))
      .toMatchObject({ url: "https://example.test/stories", route: "/stories" });
  });
});

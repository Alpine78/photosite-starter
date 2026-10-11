import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceListing } from "@/components/service-pages";
import { buildServiceRoutes } from "@/lib/service-routes";
import type { Service } from "@/lib/services";

describe("localized service listing visibility", () => {
  it("hides a landing card without flattening or removing its child's route", () => {
    const base = { language: "en", shortDescription: "A session.", description: ["A session."] };
    const services: Service[] = [
      { ...base, serviceId: "sessions", slug: "sessions", name: "Session overview", hideFromListing: true },
      { ...base, serviceId: "short-session", parentServiceId: "sessions", slug: "short", name: "Short session", startingPrice: "75 €" },
      { ...base, serviceId: "events", slug: "events", name: "Events", hideFromListing: false },
    ];
    const html = renderToStaticMarkup(createElement(ServiceListing, {
      title: "Services", serviceRootPath: "/en/services",
      routes: buildServiceRoutes(services, "en"), contactLabel: "Contact",
    }));
    expect(html).not.toContain("Session overview");
    expect(html).toContain('href="/en/services/sessions/short"');
    expect(html).toContain("Short session");
    expect(html).toContain("75 €");
    expect(html).toContain('href="/en/services/events"');
  });
});

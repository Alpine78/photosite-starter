import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listDirectChildServices, ServiceDetail, ServiceListing, ServicePackages } from "@/components/service-pages";
import { getBuiltInLabels } from "@/lib/deployment-config";
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

describe("a service's packages (AB#252)", () => {
  const base = { language: "en", shortDescription: "Short text.", description: ["Long text."] };
  const services: Service[] = [
    { ...base, serviceId: "weddings", slug: "weddings", name: "Weddings" },
    { ...base, serviceId: "half", parentServiceId: "weddings", slug: "half-day", name: "Half day", startingPrice: "900 €" },
    { ...base, serviceId: "full", parentServiceId: "weddings", slug: "full-day", name: "Full day", hideFromListing: true },
    { ...base, serviceId: "extra", parentServiceId: "full", slug: "extra-hour", name: "Extra hour" },
    { ...base, serviceId: "events", slug: "events", name: "Events" },
  ];
  const routes = buildServiceRoutes(services, "en");
  const labels = getBuiltInLabels("en");
  const render = (serviceId: string) => {
    const route = routes.find((candidate) => candidate.service.serviceId === serviceId)!;
    return renderToStaticMarkup(createElement(ServiceDetail, {
      service: route.service, serviceSegments: route.path, serviceRootPath: "/en/services",
      routes, languages: [], labels,
    }));
  };

  it("lists only direct children, keeping the catalog order and a hidden-from-listing child", () => {
    expect(listDirectChildServices(routes, ["weddings"]).map((route) => route.service.serviceId))
      .toEqual(["half", "full"]);
    expect(listDirectChildServices(routes, ["weddings", "full-day"]).map((route) => route.service.serviceId))
      .toEqual(["extra"]);
    expect(listDirectChildServices(routes, ["events"])).toEqual([]);
  });

  it("renders each package as a subordinate heading linking to its nested route, without price or text", () => {
    const html = render("weddings");
    expect(html).toContain(`<h2 id="service-packages-heading"`);
    expect(html).toContain(labels.services.packages);
    expect(html).toContain('href="/en/services/weddings/half-day"');
    expect(html).toContain('href="/en/services/weddings/full-day"');
    expect(html).toMatch(/<h3[^>]*>Half day<\/h3>/);
    expect(html).not.toContain("900 €");
    expect(html).not.toContain("Short text.");
  });

  it("renders no packages section for a service without children", () => {
    expect(render("events")).not.toContain("service-packages-heading");
  });

  it("builds package links under whatever service namespace the caller resolved", () => {
    const html = renderToStaticMarkup(createElement(ServicePackages, {
      packages: listDirectChildServices(routes, ["weddings"]),
      serviceRootPath: "/palvelut",
      heading: "Paketit",
    }));
    expect(html).toContain('href="/palvelut/weddings/half-day"');
    expect(html).not.toContain('href="/services/');
  });
});

import { describe, expect, it } from "vitest";

import {
  buildServiceRoutes,
  findServiceRoute,
  ServiceRouteError,
} from "@/lib/service-routes";
import type { Service } from "@/lib/services";

function service(overrides: Partial<Service> = {}): Service {
  return {
    serviceId: "weddings",
    language: "fi",
    slug: "haakuvaus",
    name: "Wedding photography",
    shortDescription: "A service.",
    description: ["A service."],
    ...overrides,
  };
}

describe("buildServiceRoutes", () => {
  it("builds a parent and child path from stable identities", () => {
    const routes = buildServiceRoutes(
      [
        service(),
        service({
          serviceId: "wedding-portraits",
          parentServiceId: "weddings",
          slug: "miljoomuotokuvaus",
        }),
      ],
      "fi",
    );

    expect(routes.map((route) => route.path)).toEqual([
      ["haakuvaus"],
      ["haakuvaus", "miljoomuotokuvaus"],
    ]);
    expect(findServiceRoute(routes, ["haakuvaus", "miljoomuotokuvaus"])?.service.serviceId).toBe(
      "wedding-portraits",
    );
  });

  it.each([
    ["a missing parent", [service({ parentServiceId: "missing" })]],
    ["a self parent", [service({ parentServiceId: "weddings" })]],
    [
      "a parent cycle",
      [
        service({ serviceId: "one", parentServiceId: "two", slug: "one" }),
        service({ serviceId: "two", parentServiceId: "one", slug: "two" }),
      ],
    ],
    [
      "a duplicate sibling slug",
      [service(), service({ serviceId: "other", slug: "haakuvaus" })],
    ],
  ])("rejects %s", (_name, services) => {
    expect(() => buildServiceRoutes(services, "fi")).toThrow(ServiceRouteError);
  });

  it("does not resolve a prefix as a detail route", () => {
    const routes = buildServiceRoutes([service()], "fi");
    expect(findServiceRoute(routes, [])).toBeUndefined();
    expect(findServiceRoute(routes, ["haakuvaus", "extra"])).toBeUndefined();
  });
});

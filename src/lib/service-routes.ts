import type { Service } from "@/lib/services";

export type ResolvedService = {
  readonly service: Service;
  /** Canonical service segments below the locale's service namespace. */
  readonly path: readonly string[];
};

export class ServiceRouteError extends Error {
  constructor(message: string) {
    super(`[service-routes] ${message}`);
    this.name = "ServiceRouteError";
  }
}

/**
 * Resolves one language's published service documents into canonical paths.
 * The store adapter has already selected the language; accepting mixed
 * languages here would make a parent lookup silently cross route spaces.
 */
export function buildServiceRoutes(
  services: readonly Service[],
  language: string,
): readonly ResolvedService[] {
  const byId = new Map<string, Service>();
  for (const service of services) {
    if (service.language !== language) {
      throw new ServiceRouteError(
        `service "${service.serviceId}" belongs to language "${service.language}", not "${language}"`,
      );
    }
    if (byId.has(service.serviceId)) {
      throw new ServiceRouteError(
        `two ${language} services use id "${service.serviceId}"`,
      );
    }
    byId.set(service.serviceId, service);
  }

  const siblingSlugs = new Set<string>();
  for (const service of services) {
    const parent = service.parentServiceId ?? "";
    if (service.parentServiceId === service.serviceId) {
      throw new ServiceRouteError(
        `service "${service.serviceId}" cannot be its own parent`,
      );
    }
    if (service.parentServiceId !== undefined && !byId.has(service.parentServiceId)) {
      throw new ServiceRouteError(
        `service "${service.serviceId}" names missing ${language} parent "${service.parentServiceId}"`,
      );
    }
    const key = `${parent}\u0000${service.slug}`;
    if (siblingSlugs.has(key)) {
      throw new ServiceRouteError(
        `two siblings below "${parent || "root"}" use slug "${service.slug}" in ${language}`,
      );
    }
    siblingSlugs.add(key);
  }

  const resolved = new Map<string, readonly string[]>();
  const resolving = new Set<string>();
  const resolve = (service: Service): readonly string[] => {
    const prior = resolved.get(service.serviceId);
    if (prior !== undefined) return prior;
    if (resolving.has(service.serviceId)) {
      throw new ServiceRouteError(
        `service parent cycle reaches "${service.serviceId}" in ${language}`,
      );
    }
    resolving.add(service.serviceId);
    const parent =
      service.parentServiceId === undefined
        ? undefined
        : byId.get(service.parentServiceId)!;
    const path = [...(parent === undefined ? [] : resolve(parent)), service.slug];
    resolving.delete(service.serviceId);
    resolved.set(service.serviceId, path);
    return path;
  };

  return services.map((service) => ({ service, path: resolve(service) }));
}

/** Exact segment match; a prefix identifies no detail page by itself. */
export function findServiceRoute(
  routes: readonly ResolvedService[],
  segments: readonly string[],
): ResolvedService | undefined {
  return routes.find(
    (route) =>
      route.path.length === segments.length &&
      route.path.every((segment, index) => segment === segments[index]),
  );
}

import { readSiteMaintenanceMode, siteMaintenanceResponse } from "@/lib/site-maintenance";

/** afterFiles target for missing static candidates; never enters the content tree. */
function maintenanceFallback(request: Request): Response {
  if (readSiteMaintenanceMode(process.env) === "off") {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return siteMaintenanceResponse(request.method, false);
}

export const GET = maintenanceFallback;
export const HEAD = maintenanceFallback;
export const POST = maintenanceFallback;
export const PUT = maintenanceFallback;
export const PATCH = maintenanceFallback;
export const DELETE = maintenanceFallback;
export const OPTIONS = maintenanceFallback;

export const dynamic = "force-dynamic";

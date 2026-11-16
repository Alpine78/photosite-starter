import { readClientGalleryCleanupConfig } from "@/lib/client-gallery-cleanup-config";
import { runConfiguredClientGalleryCleanup } from "@/lib/client-gallery-cleanup-access";
import { cronMethodNotAllowed, isCronBearer } from "@/lib/cron-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The worker stops at 185 s, leaving 15 s for route setup and response. */
export const maxDuration = 200;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request): Promise<Response> {
  const config = readClientGalleryCleanupConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404, headers });
  if (config.state !== "enabled") return Response.json({ status: "failed" }, { status: 503, headers });
  if (!isCronBearer(request.headers.get("authorization"), config.cronSecret)) return new Response(null, { status: 401, headers });
  try {
    const counts = await runConfiguredClientGalleryCleanup(config);
    return Response.json({ status: "ok", ...counts }, { headers });
  } catch { return Response.json({ status: "failed" }, { status: 503, headers }); }
}
// Next otherwise implements HEAD by invoking GET. This endpoint mutates state.
export const HEAD = cronMethodNotAllowed;
export const POST = cronMethodNotAllowed;
export const PUT = cronMethodNotAllowed;
export const PATCH = cronMethodNotAllowed;
export const DELETE = cronMethodNotAllowed;
export const OPTIONS = cronMethodNotAllowed;

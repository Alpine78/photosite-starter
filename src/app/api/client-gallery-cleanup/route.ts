import { timingSafeEqual } from "node:crypto";
import { readClientGalleryCleanupConfig } from "@/lib/client-gallery-cleanup-config";
import { runConfiguredClientGalleryCleanup } from "@/lib/client-gallery-cleanup-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The worker stops at 185 s, leaving 15 s for route setup and response. */
export const maxDuration = 200;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request): Promise<Response> {
  const config = readClientGalleryCleanupConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404, headers });
  if (config.state !== "enabled") return Response.json({ status: "failed" }, { status: 503, headers });
  const presented = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${config.cronSecret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return new Response(null, { status: 401, headers });
  try {
    const counts = await runConfiguredClientGalleryCleanup(config);
    return Response.json({ status: "ok", ...counts }, { headers });
  } catch { return Response.json({ status: "failed" }, { status: 503, headers }); }
}
// Next otherwise implements HEAD by invoking GET. This endpoint mutates state.
export function HEAD(): Response { return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } }); }
export const POST = HEAD;
export const PUT = HEAD;
export const PATCH = HEAD;
export const DELETE = HEAD;
export const OPTIONS = HEAD;

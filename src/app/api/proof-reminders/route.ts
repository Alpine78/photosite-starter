import { readProofReminderConfig } from "@/lib/proof-reminder-config";
import { runConfiguredProofReminders } from "@/lib/proof-reminder-access";
import { cronMethodNotAllowed, isCronBearer } from "@/lib/cron-route";

/**
 * The daily customer reminder run (ADR-0038 decision 9, AB#130), called by the
 * platform's cron with `Authorization: Bearer <CRON_SECRET>`. Off unless
 * `PROOF_REMINDERS=enabled`; answers counts only, never addresses or links.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Keep this literal in sync with PROOF_REMINDER_MAX_DURATION_SECONDS in proof-reminder-access.ts. */
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  const noStore = { "Cache-Control": "no-store" };
  const config = readProofReminderConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404, headers: noStore });
  if (config.state === "misconfigured") return Response.json({ status: "failed" }, { status: 503, headers: noStore });
  if (!isCronBearer(request.headers.get("authorization"), config.cronSecret)) return new Response(null, { status: 401, headers: noStore });
  try {
    const counts = await runConfiguredProofReminders({ token: config.token, secret: config.secret, environment: process.env });
    return Response.json({ status: "ok", ...counts }, { headers: noStore });
  } catch {
    return Response.json({ status: "failed" }, { status: 503, headers: noStore });
  }
}

// Next otherwise implements HEAD by invoking GET, which would run the job (AB#420).
export const HEAD = cronMethodNotAllowed;
export const POST = cronMethodNotAllowed;
export const PUT = cronMethodNotAllowed;
export const PATCH = cronMethodNotAllowed;
export const DELETE = cronMethodNotAllowed;
export const OPTIONS = cronMethodNotAllowed;

import { timingSafeEqual } from "node:crypto";
import { readProofReminderConfig } from "@/lib/proof-reminder-config";
import { runConfiguredProofReminders } from "@/lib/proof-reminder-access";

/**
 * The daily customer reminder run (ADR-0038 decision 9, AB#130), called by the
 * platform's cron with `Authorization: Bearer <CRON_SECRET>`. Off unless
 * `PROOF_REMINDERS=enabled`; answers counts only, never addresses or links.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`), presented = Buffer.from(header ?? "");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function GET(request: Request): Promise<Response> {
  const noStore = { "Cache-Control": "no-store" };
  const config = readProofReminderConfig(process.env);
  if (config.state === "disabled") return new Response(null, { status: 404, headers: noStore });
  if (config.state === "misconfigured") return Response.json({ status: "failed" }, { status: 503, headers: noStore });
  if (!authorized(request.headers.get("authorization"), config.cronSecret)) return new Response(null, { status: 401, headers: noStore });
  try {
    const counts = await runConfiguredProofReminders({ token: config.token, secret: config.secret, environment: process.env });
    return Response.json({ status: "ok", ...counts }, { headers: noStore });
  } catch {
    return Response.json({ status: "failed" }, { status: 503, headers: noStore });
  }
}

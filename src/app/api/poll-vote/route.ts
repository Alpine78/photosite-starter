import { NextResponse } from "next/server";
import { checkContactRequestHeaders, jsonNoStore, readBoundedBody, CONTACT_REJECTION_STATUS } from "@/lib/contact-request";
import { createContactRateLimiter, deriveClientKey } from "@/lib/contact-rate-limit";
import { createCorrelationId, logPollVoteEvent } from "@/lib/contact-log";
import { attemptPollVote, readPublicPoll, generatePollVisitorToken, isCanonicalPollVisitorToken, pollVoterCookieName } from "@/lib/poll-vote-access";
import { isPollIdentity } from "@/lib/poll";

export const runtime = "nodejs";
const voteLimiter = createContactRateLimiter();
const readLimiter = createContactRateLimiter({ maxAttempts: 60 });
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readVisitorToken(request: Request, pollId: string): string | undefined {
  const name = pollVoterCookieName(pollId);
  const values: string[] = [];
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    values.push(value);
  }
  return values.length === 1 && isCanonicalPollVisitorToken(values[0]) ? values[0] : undefined;
}
function withVoterCookie(response: NextResponse, pollId: string, token: string): NextResponse {
  response.cookies.set(pollVoterCookieName(pollId), token, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/poll-vote", maxAge: COOKIE_MAX_AGE });
  return response;
}

/** Fresh public results. Preparation creates a poll-scoped token only when the visitor submits. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pollId = url.searchParams.get("pollId");
  const prepare = url.searchParams.get("prepare") === "1";
  if (!isPollIdentity(pollId) || url.searchParams.getAll("pollId").length !== 1 ||
      url.searchParams.getAll("prepare").length > 1 ||
      (url.searchParams.has("prepare") && !prepare) ||
      [...url.searchParams.keys()].some((key) => key !== "pollId" && key !== "prepare")) {
    return jsonNoStore({ status: "rejected", reason: "malformed-request" }, 400);
  }
  // A non-simple header makes cross-origin cookie preparation require a CORS
  // preflight, which this endpoint never grants. Plain result reads set no cookie.
  if (prepare && (request.headers.get("x-poll-prepare") !== "1" ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))) {
    return jsonNoStore({ status: "rejected", reason: "cross-origin" }, 403);
  }
  if (!readLimiter.tryConsume(deriveClientKey(request), Date.now()).allowed) return jsonNoStore({ status: "rejected", reason: "rate-limited" }, 429);
  const token = readVisitorToken(request, pollId);
  try {
    const poll = await readPublicPoll(pollId, token);
    if (!poll) return jsonNoStore({ status: "rejected", reason: "unknown-poll" }, 404);
    const response = NextResponse.json(poll, { headers: { "Cache-Control": "no-store" } });
    if (prepare && !poll.closed && token === undefined) withVoterCookie(response, pollId, generatePollVisitorToken());
    return response;
  } catch {
    return jsonNoStore({ status: "failed", retryable: true }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  const headerRejection = checkContactRequestHeaders(request);
  if (headerRejection) return jsonNoStore({ status: "rejected", reason: headerRejection }, CONTACT_REJECTION_STATUS[headerRejection]);
  const correlationId = createCorrelationId();
  if (!voteLimiter.tryConsume(deriveClientKey(request), Date.now()).allowed) return jsonNoStore({ status: "rejected", reason: "rate-limited", correlationId }, 429);
  const body = await readBoundedBody(request, 1024);
  let parsed: unknown;
  try { parsed = body === undefined ? undefined : JSON.parse(body); } catch { /* malformed below */ }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 || Object.keys(parsed).some((key) => key !== "pollId" && key !== "optionId") ||
      !isPollIdentity((parsed as { pollId?: unknown }).pollId) || !isPollIdentity((parsed as { optionId?: unknown }).optionId)) {
    logPollVoteEvent({ correlationId, state: "rejected", errorClass: "malformed-request" });
    return jsonNoStore({ status: "rejected", reason: "malformed-request", correlationId }, 400);
  }
  const vote = parsed as { pollId: string; optionId: string };
  const visitorToken = readVisitorToken(request, vote.pollId);
  // No write before a browser has received a stable token. Retries after a
  // lost POST response therefore reuse the same receipt, even on the first vote.
  if (!visitorToken) return jsonNoStore({ status: "rejected", reason: "voter-not-ready", correlationId }, 409);
  try {
    const result = await attemptPollVote(vote, visitorToken);
    if (result.outcome === "rejected") {
      logPollVoteEvent({ correlationId, state: "rejected", errorClass: result.reason });
      return jsonNoStore({ status: "rejected", reason: result.reason, correlationId }, result.reason === "closed" ? 409 : result.reason === "malformed-request" ? 400 : 404);
    }
    logPollVoteEvent({ correlationId, state: result.outcome });
    return withVoterCookie(NextResponse.json({ status: result.outcome, correlationId }, { headers: { "Cache-Control": "no-store" } }), vote.pollId, visitorToken);
  } catch {
    logPollVoteEvent({ correlationId, state: "failed", errorClass: "store-unavailable" });
    return jsonNoStore({ status: "failed", retryable: true, correlationId }, 503);
  }
}

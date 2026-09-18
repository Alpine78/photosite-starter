/** Sanity's poll read projection and the single receipt+tally transaction (ADR-0018). */
import "server-only";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import { isRecord } from "@/lib/sanity-values";
import { pollTallyDocumentId, pollVoteReceiptDocumentId } from "@/lib/poll-identity";
import { buildPollDisplayState, isPollDefinition, isPollIdentity, MAX_POLL_OPTIONS, type PollDefinition, type PollDisplayState } from "@/lib/poll";
import type { PollSnapshot } from "@/lib/poll-vote";

export type PollVoteWriteOptions = {
  readonly config?: SanityConfig;
  readonly token?: string;
  readonly fetchImplementation?: typeof fetch;
};
export class PollVoteSanityError extends Error {
  constructor(message: string) {
    super(`[poll-vote-sanity] ${message}`);
    this.name = "PollVoteSanityError";
  }
}
function readPollVoteToken(): string {
  if (process.env.NEXT_PUBLIC_SANITY_POLL_VOTE_TOKEN?.trim()) {
    throw new PollVoteSanityError("Remove NEXT_PUBLIC_SANITY_POLL_VOTE_TOKEN: the voting credential must be server-only.");
  }
  const token = process.env.SANITY_POLL_VOTE_TOKEN?.trim();
  if (!token) throw new PollVoteSanityError("SANITY_POLL_VOTE_TOKEN is required to accept a poll vote.");
  return token;
}

const POLL_PROJECTION = `{pollId, question, closeDate, "options": options[0...${MAX_POLL_OPTIONS + 1}]{optionId, label}}`;
function projectPoll(raw: unknown, pollId: string): PollDefinition | undefined {
  if (!Array.isArray(raw) || !raw.every(isRecord)) throw new PollVoteSanityError("Unexpected poll query shape");
  if (raw.length === 0) return undefined;
  if (raw.length > 1) throw new PollVoteSanityError("two published poll documents claim the same identity");
  const poll = raw[0];
  if (!isPollDefinition(poll) || poll.pollId !== pollId) throw new PollVoteSanityError("Malformed poll definition");
  return { pollId: poll.pollId, question: poll.question, closeDate: poll.closeDate, options: poll.options.map(({ optionId, label }) => ({ optionId, label })) };
}

export async function readPollSnapshot(pollId: string, options?: { readonly client?: SanityClient }): Promise<PollSnapshot | undefined> {
  if (!isPollIdentity(pollId)) throw new TypeError("Invalid poll identity");
  const client = options?.client ?? getSanityClient();
  // These unregistered tags intentionally use the client's no-store default.
  return projectPoll(await client.query({
    query: `*[_type == "poll" && pollId == $pollId][0...2]${POLL_PROJECTION}`,
    params: { pollId }, tag: "poll.vote.snapshot",
  }), pollId);
}

export async function readPollDisplayState(pollId: string, visitorToken: string | undefined, now = new Date(), options?: { readonly client?: SanityClient }): Promise<PollDisplayState | undefined> {
  const client = options?.client ?? getSanityClient();
  const raw = await client.query({
    query: `{
      "poll": *[_type == "poll" && pollId == $pollId][0...2]${POLL_PROJECTION},
      "tally": *[_id == $tallyId][0]{_type, pollId, counts},
      "voted": defined(*[_id == $receiptId][0]._id)
    }`,
    params: { pollId, tallyId: pollTallyDocumentId(pollId), receiptId: visitorToken === undefined ? "" : pollVoteReceiptDocumentId(pollId, visitorToken) },
    tag: "poll.vote.display",
  });
  if (!isRecord(raw)) throw new PollVoteSanityError("Unexpected poll display query shape");
  const poll = projectPoll(raw.poll, pollId);
  if (!poll) return undefined;
  const counts: Record<string, number> = Object.create(null);
  if (raw.tally !== null) {
    if (!isRecord(raw.tally) || raw.tally._type !== "pollTally" || raw.tally.pollId !== pollId || !isRecord(raw.tally.counts)) {
      throw new PollVoteSanityError("Malformed poll tally");
    }
    if (Object.keys(raw.tally.counts).length > MAX_POLL_OPTIONS) throw new PollVoteSanityError("Too many poll tally buckets");
    for (const [id, count] of Object.entries(raw.tally.counts)) {
      if (!isPollIdentity(id) || !poll.options.some((option) => option.optionId === id) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new PollVoteSanityError("Malformed poll count");
      counts[id] = count;
    }
  }
  if (typeof raw.voted !== "boolean") throw new PollVoteSanityError("Malformed receipt existence result");
  return buildPollDisplayState(poll, counts, visitorToken !== undefined && raw.voted, now);
}

/** A receipt conflict rolls back the entire increment; a failed increment rolls back the receipt. */
export async function recordPollVote(params: { readonly pollId: string; readonly optionId: string; readonly visitorToken: string; readonly votedAt: string }, options?: PollVoteWriteOptions): Promise<boolean> {
  if (!isPollIdentity(params.optionId)) throw new TypeError("Invalid poll option");
  const receiptId = pollVoteReceiptDocumentId(params.pollId, params.visitorToken);
  const tallyId = pollTallyDocumentId(params.pollId);
  // Bracket notation also handles option IDs beginning with a digit or containing a hyphen.
  // Verified against https://www.sanity.io/docs/content-lake/http-patches#field-name-restrictions
  const countPath = `counts['${params.optionId}']`;
  const config = options?.config ?? getSanityConfig();
  const send = options?.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await send(`https://${config.projectId}.api.sanity.io/${config.apiVersion}/data/mutate/${config.dataset}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options?.token ?? readPollVoteToken()}` },
      body: JSON.stringify({ mutations: [
        { create: { _id: receiptId, _type: "pollVoteReceipt", pollId: params.pollId } },
        { createIfNotExists: { _id: tallyId, _type: "pollTally", pollId: params.pollId, counts: {} } },
        { patch: { id: tallyId, setIfMissing: { [countPath]: 0 }, inc: { [countPath]: 1 } } },
      ] }),
    });
  } catch {
    throw new PollVoteSanityError("Vote transaction unavailable");
  }
  if (response.status === 409) return false;
  if (!response.ok) throw new PollVoteSanityError(`Vote transaction failed with HTTP ${response.status}`);
  return true;
}

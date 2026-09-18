/** The route-facing poll facade; eligibility always precedes the atomic write. */
import "server-only";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { decidePollVoteRequest, type PollVoteErrorClass, type PollVoteRejectionReason } from "@/lib/poll-vote";
import { recordPollVote, PollVoteSanityError, readPollSnapshot, readPollDisplayState } from "@/lib/poll-vote-sanity";
import { generatePollVisitorToken, isCanonicalPollVisitorToken, pollVoterCookieName, pollVoteReceiptDocumentId } from "@/lib/poll-identity";
import { isPollIdentity } from "@/lib/poll";
import { readMockPoll, readMockPollDisplay, recordMockPollVote } from "@/lib/mock-polls";

export { generatePollVisitorToken, isCanonicalPollVisitorToken, pollVoterCookieName, PollVoteSanityError };
export type { PollVoteErrorClass, PollVoteRejectionReason };

export async function readPublicPoll(pollId: string, visitorToken: string | undefined, now = new Date()) {
  if (!isPollIdentity(pollId)) throw new TypeError("Invalid poll identity");
  if (getDeploymentConfig().contentSource === "mock") return readMockPollDisplay(pollId, visitorToken === undefined ? undefined : pollVoteReceiptDocumentId(pollId, visitorToken), now);
  return readPollDisplayState(pollId, visitorToken, now);
}

export async function attemptPollVote(request: { readonly pollId: unknown; readonly optionId: unknown }, visitorToken: string, now?: Date) {
  // Reject malformed identities before issuing any query or reading a write credential.
  if (!isPollIdentity(request.pollId) || !isPollIdentity(request.optionId)) return { outcome: "rejected" as const, reason: "malformed-request" as const };
  const mock = getDeploymentConfig().contentSource === "mock";
  const snapshot = mock ? readMockPoll(request.pollId) : await readPollSnapshot(request.pollId);
  const instant = now ?? new Date();
  const decision = decidePollVoteRequest(request, snapshot, instant);
  if (decision.outcome === "reject") return { outcome: "rejected" as const, reason: decision.reason };
  const created = mock
    ? recordMockPollVote(decision.pollId, decision.optionId, pollVoteReceiptDocumentId(decision.pollId, visitorToken))
    : await recordPollVote({ pollId: decision.pollId, optionId: decision.optionId, visitorToken, votedAt: instant.toISOString() });
  return { outcome: created ? "recorded" as const : "already-voted" as const };
}

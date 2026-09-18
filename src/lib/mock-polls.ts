/** Public, synthetic development fixtures; selected only by SITE_CONTENT_SOURCE=mock. */
import { buildPollDisplayState, type PollDefinition } from "./poll";

export const mockPolls: readonly PollDefinition[] = [
  { pollId: "demo-poll-open", question: "Which light do you prefer?", closeDate: "2099-01-01T00:00:00Z", options: [{ optionId: "morning-light", label: "Morning light" }, { optionId: "evening-light", label: "Evening light" }] },
  { pollId: "demo-poll-closed", question: "Which season do you photograph most?", closeDate: "2000-01-01T00:00:00Z", options: [{ optionId: "summer", label: "Summer" }, { optionId: "winter", label: "Winter" }] },
  { pollId: "demo-poll-empty", question: "An unanswered historical question", closeDate: "2000-01-01T00:00:00Z", options: [{ optionId: "yes", label: "Yes" }, { optionId: "no", label: "No" }] },
];
const tallies = new Map<string, Record<string, number>>([["demo-poll-closed", { summer: 3, winter: 1 }]]);
const receipts = new Set<string>();
export function readMockPoll(pollId: string) { return mockPolls.find((poll) => poll.pollId === pollId); }
export function readMockPollDisplay(pollId: string, receiptId: string | undefined, now: Date) {
  const poll = readMockPoll(pollId);
  return poll === undefined ? undefined : buildPollDisplayState(poll, tallies.get(pollId) ?? {}, receiptId !== undefined && receipts.has(receiptId), now);
}
export function recordMockPollVote(pollId: string, optionId: string, receiptId: string): boolean {
  if (receipts.has(receiptId)) return false;
  receipts.add(receiptId);
  const counts = tallies.get(pollId) ?? {};
  counts[optionId] = (counts[optionId] ?? 0) + 1;
  tallies.set(pollId, counts);
  return true;
}

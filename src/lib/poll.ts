import { isPublicIdentity } from "./public-identity";

// Leaves room for the tally namespace within Sanity's 128-character ID limit.
export const MAX_POLL_ID_LENGTH = 64;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_TEXT_LENGTH = 500;

export interface PollDefinition {
  readonly pollId: string;
  readonly question: string;
  readonly closeDate: string;
  readonly options: readonly { readonly optionId: string; readonly label: string }[];
}

export interface PollDisplayState extends Omit<PollDefinition, "options"> {
  readonly closed: boolean;
  readonly alreadyVoted: boolean;
  readonly options: readonly { readonly optionId: string; readonly label: string; readonly votes: number; readonly percentage: number }[];
  readonly totalVotes: number;
}

export function isPollIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_POLL_ID_LENGTH && isPublicIdentity(value);
}

export function isPollCloseDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

export function isPollDefinition(value: unknown): value is PollDefinition {
  if (typeof value !== "object" || value === null) return false;
  const poll = value as PollDefinition;
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_POLL_TEXT_LENGTH;
  return isPollIdentity(poll.pollId) && text(poll.question) && isPollCloseDate(poll.closeDate) &&
    Array.isArray(poll.options) && poll.options.length >= MIN_POLL_OPTIONS && poll.options.length <= MAX_POLL_OPTIONS &&
    poll.options.every((option) => option !== null && typeof option === "object" && isPollIdentity(option.optionId) && text(option.label)) &&
    new Set(poll.options.map((option) => option.optionId)).size === poll.options.length;
}

export function buildPollDisplayState(poll: PollDefinition, counts: Readonly<Record<string, number>>, alreadyVoted: boolean, now: Date): PollDisplayState {
  const totalVotes = poll.options.reduce((sum, option) => sum + (counts[option.optionId] ?? 0), 0);
  if (!Number.isSafeInteger(totalVotes)) throw new TypeError("Poll total exceeds the safe integer range");
  return {
    ...poll, closed: now.getTime() >= Date.parse(poll.closeDate), alreadyVoted, totalVotes,
    options: poll.options.map((option) => {
      const votes = counts[option.optionId] ?? 0;
      return { ...option, votes, percentage: totalVotes === 0 ? 0 : (votes / totalVotes) * 100 };
    }),
  };
}

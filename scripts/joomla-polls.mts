/** Pure historical poll conversion. No owner questions/options/counts ship in the repository. */
import { isRealCalendarDateTime } from "./sanity-document-checks.mts";
export type HistoricalPollDocument = Readonly<Record<string, unknown>> & { readonly _id: string; readonly _type: "poll" | "pollTally"; readonly pollId: string };
export type ResolvedHistoricalPoll = { readonly poll: HistoricalPollDocument; readonly tally: HistoricalPollDocument };
const HEADER = "poll_id\tquestion\ttotal_votes\tlanguage\toption_title\toption_votes";
// A sentinel for "already closed on import", not a claim about the source's closing time.
export const HISTORICAL_POLL_CLOSE_DATE = "1970-01-01T00:00:00Z";

export function parseLegacyPollResults(text: string): ReadonlyMap<string, ResolvedHistoricalPoll> {
  const lines = text.trimEnd().split(/\r?\n/u);
  if (lines.shift() !== HEADER) throw new TypeError("Unexpected historical poll TSV header");
  const rows = new Map<string, { question: string; total: number; language: string; options: { _key: string; optionId: string; label: string }[]; counts: Record<string, number> }>();
  for (const [index, line] of lines.entries()) {
    const fields = line.split("\t");
    if (fields.length !== 6) throw new TypeError(`Historical poll row ${index + 2}: expected six fields`);
    const [id, question, totalText, languageText, label, votesText] = fields as [string, string, string, string, string, string];
    if (!/^[1-9]\d{0,8}$/.test(id) || !question.trim() || question.length > 500 || !label.trim() || label.length > 500 || !/^\d+$/.test(totalText) || !/^\d+$/.test(votesText)) throw new TypeError(`Malformed historical poll row ${index + 2}`);
    const language = languageText === "*" ? "und" : languageText.split("-")[0]!;
    if (!/^[a-z]{2,3}$/.test(language)) throw new TypeError(`Invalid historical poll language at row ${index + 2}`);
    const total = Number(totalText), votes = Number(votesText);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(votes)) throw new TypeError("Historical poll counts must be safe integers");
    const row = rows.get(id) ?? { question, total, language, options: [], counts: {} };
    if (row.question !== question || row.total !== total || row.language !== language) throw new TypeError(`Inconsistent historical poll ${id}`);
    const optionId = `option-${row.options.length + 1}`;
    row.options.push({ _key: optionId, optionId, label }); row.counts[optionId] = votes; rows.set(id, row);
  }
  const result = new Map<string, ResolvedHistoricalPoll>();
  for (const [id, row] of rows) {
    if (row.options.length < 2 || row.options.length > 10 || Object.values(row.counts).reduce((a, b) => a + b, 0) !== row.total) throw new TypeError(`Historical poll ${id}: invalid option count or vote total`);
    const pollId = `migrated-poll-${id}`;
    result.set(id, {
      poll: { _id: `migrated--poll--${id}`, _type: "poll", pollId, language: row.language, question: row.question, options: row.options, closeDate: HISTORICAL_POLL_CLOSE_DATE },
      tally: { _id: `pollTally-${pollId}`, _type: "pollTally", pollId, counts: row.counts },
    });
  }
  return result;
}

/** The writer admits only matching, closed historical pairs; it can never import a live tally. */
export function validateHistoricalPollDocuments(documents: readonly Readonly<Record<string, unknown>>[]): string[] {
  const problems: string[] = [];
  const polls = documents.filter((d) => d._type === "poll");
  for (const poll of polls) {
    if (typeof poll.pollId !== "string" || !/^migrated-poll-[1-9]\d{0,8}$/.test(poll.pollId) || poll._id !== `migrated--poll--${poll.pollId.slice("migrated-poll-".length)}` ||
        !isRealCalendarDateTime(poll.closeDate) || poll.closeDate !== HISTORICAL_POLL_CLOSE_DATE ||
        typeof poll.language !== "string" || !/^[a-z]{2,3}$/.test(poll.language) ||
        typeof poll.question !== "string" || !poll.question.trim() || poll.question.length > 500 ||
        !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10) {
      problems.push("Malformed or non-historical poll document"); continue;
    }
    const options = poll.options as Record<string, unknown>[];
    options.forEach((option, i) => {
      if (option === null || typeof option !== "object" || option.optionId !== `option-${i + 1}` || option._key !== option.optionId || typeof option.label !== "string" || !option.label.trim() || option.label.length > 500) problems.push("Malformed historical poll option");
    });
    const tally = documents.find((d) => d._type === "pollTally" && d.pollId === poll.pollId);
    if (!tally) problems.push("Historical poll has no seeded tally");
  }
  for (const tally of documents.filter((d) => d._type === "pollTally")) {
    const poll = polls.find((d) => d.pollId === tally.pollId);
    if (!poll || tally._id !== `pollTally-${String(tally.pollId)}` || typeof tally.counts !== "object" || tally.counts === null || Array.isArray(tally.counts)) {
      problems.push("Historical tally has no matching poll or counts"); continue;
    }
    const counts = tally.counts as Record<string, unknown>;
    const options = Array.isArray(poll.options) ? poll.options as Record<string, unknown>[] : [];
    if (Object.keys(counts).length !== options.length || options.some((o) => o === null || typeof o !== "object" || typeof o.optionId !== "string" || typeof counts[o.optionId] !== "number" || !Number.isSafeInteger(counts[o.optionId]) || Number(counts[o.optionId]) < 0)) problems.push("Historical tally buckets do not match poll options");
    if (!Number.isSafeInteger(Object.values(counts).reduce<number>((sum, count) => sum + Number(count), 0))) problems.push("Historical tally total exceeds the safe integer range");
  }
  return problems;
}

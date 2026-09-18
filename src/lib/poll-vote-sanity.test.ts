import { describe, expect, it, vi } from "vitest";
import { recordPollVote, PollVoteSanityError, readPollSnapshot, readPollDisplayState } from "./poll-vote-sanity";
import { generatePollVisitorToken, pollVoteReceiptDocumentId } from "./poll-identity";
import { isPollCloseDate } from "./poll";
import type { SanityClient } from "./sanity-client";
import type { SanityConfig } from "./sanity-config";

const config: SanityConfig = { projectId: "test1234", dataset: "test", datasetVisibility: "public", apiVersion: "v2026-06-24" };
const poll = { pollId: "camera-preference", question: "A test question?", closeDate: "2099-01-01T00:00:00Z", options: [{ optionId: "24-mp", label: "24 MP" }, { optionId: "more", label: "More" }] };
function client(raw: unknown): SanityClient { return { query: vi.fn().mockResolvedValue(raw) }; }

describe("fresh poll projection", () => {
  it("reads a bounded unique definition and omits provider fields", async () => {
    const c = client([{ ...poll, _id: "provider", extra: "internal" }]);
    expect(await readPollSnapshot(poll.pollId, { client: c })).toEqual(poll);
    expect(c.query).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining("[0...2]"), tag: "poll.vote.snapshot" }));
  });
  it("returns undefined for an unknown poll", async () => {
    expect(await readPollSnapshot(poll.pollId, { client: client([]) })).toBeUndefined();
  });
  it.each([
    [poll, poll], [{ ...poll, closeDate: "invalid" }], [{ ...poll, closeDate: "2099-02-31T00:00:00Z" }],
    [{ ...poll, options: [{ optionId: "x", label: "X" }, { optionId: "x", label: "Y" }] }],
    [{ ...poll, options: [{ optionId: "Bad.Path", label: "X" }, poll.options[1]] }],
    [{ ...poll, options: [] }], [{ ...poll, pollId: "other" }], ["not a document"],
  ])("fails closed on ambiguous or malformed CMS data (%j)", async (...rows) => {
    await expect(readPollSnapshot(poll.pollId, { client: client(rows) })).rejects.toThrow(PollVoteSanityError);
  });
  it("accepts real ISO instants but rejects date rollovers", () => {
    expect(isPollCloseDate("2026-09-18T09:00:00+02:00")).toBe(true);
    expect(isPollCloseDate("2026-02-31T00:00:00Z")).toBe(false);
  });
  it("returns fresh results with counts, percentages and receipt state in one query", async () => {
    const c = client({ poll: [poll], tally: { _type: "pollTally", pollId: poll.pollId, counts: { "24-mp": 3, more: 1 } }, voted: true });
    const result = await readPollDisplayState(poll.pollId, generatePollVisitorToken(), new Date("2026-09-18T00:00:00Z"), { client: c });
    expect(result).toMatchObject({ totalVotes: 4, alreadyVoted: true, closed: false, options: [{ votes: 3, percentage: 75 }, { votes: 1, percentage: 25 }] });
    expect(c.query).toHaveBeenCalledTimes(1);
  });
  it("represents an empty closed poll without NaN percentages", async () => {
    const result = await readPollDisplayState(poll.pollId, undefined, new Date("2100-01-01T00:00:00Z"), { client: client({ poll: [poll], tally: null, voted: false }) });
    expect(result).toMatchObject({ closed: true, totalVotes: 0, options: [{ percentage: 0 }, { percentage: 0 }] });
  });
  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 1, "3"])("rejects invalid count %s", async (count) => {
    await expect(readPollDisplayState(poll.pollId, undefined, new Date(), { client: client({ poll: [poll], tally: { _type: "pollTally", pollId: poll.pollId, counts: { more: count } }, voted: false }) })).rejects.toThrow();
  });
});

describe("receipt and counter transaction", () => {
  const params = { pollId: poll.pollId, optionId: "24-mp", visitorToken: generatePollVisitorToken(), votedAt: "2026-09-18T00:00:00Z" };
  it("initializes the selected bucket and increments atomically with a plain-create receipt", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await recordPollVote(params, { config, token: "fixture-token", fetchImplementation: send })).toBe(true);
    const body = JSON.parse(send.mock.calls[0][1].body);
    expect(body.mutations).toEqual([
      { create: { _id: pollVoteReceiptDocumentId(params.pollId, params.visitorToken), _type: "pollVoteReceipt", pollId: params.pollId } },
      { createIfNotExists: { _id: `pollTally-${params.pollId}`, _type: "pollTally", pollId: params.pollId, counts: {} } },
      { patch: { id: `pollTally-${params.pollId}`, setIfMissing: { "counts['24-mp']": 0 }, inc: { "counts['24-mp']": 1 } } },
    ]);
    expect(JSON.stringify(body)).not.toContain(params.visitorToken);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("treats only a 409 as already voted, without issuing a second increment", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));
    expect(await recordPollVote(params, { config, token: "t", fetchImplementation: send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 500])("fails instead of claiming a recorded vote on HTTP %s", async (status) => {
    await expect(recordPollVote(params, { config, token: "t", fetchImplementation: vi.fn().mockResolvedValue(new Response(null, { status })) })).rejects.toThrow(PollVoteSanityError);
  });
  it("submits both concurrent requests with the same receipt so the provider arbitrates once", async () => {
    const receipts = new Set<string>();
    let increments = 0;
    const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      const receipt = body.mutations[0].create._id;
      if (receipts.has(receipt)) return new Response(null, { status: 409 });
      receipts.add(receipt); increments += 1;
      return new Response(null, { status: 200 });
    });
    const opts = { config, token: "t", fetchImplementation: send as typeof fetch };
    expect(await Promise.all([recordPollVote(params, opts), recordPollVote(params, opts)])).toEqual([true, false]);
    expect(increments).toBe(1);
  });
  it("refuses publicly mirrored runtime credentials before any transport", async () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_POLL_VOTE_TOKEN", "never-public");
    const send = vi.fn();
    try { await expect(recordPollVote(params, { config, fetchImplementation: send })).rejects.toThrow(PollVoteSanityError); expect(send).not.toHaveBeenCalled(); }
    finally { vi.unstubAllEnvs(); }
  });
});

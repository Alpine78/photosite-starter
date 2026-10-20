import { beforeEach, describe, expect, it, vi } from "vitest";

// The route-facing facade: which content source it consults, and that a
// malformed request is refused before any read or write is attempted.
const deploymentConfig = vi.hoisted(() => ({ contentSource: "mock" as "mock" | "sanity" }));
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => deploymentConfig }));
const sanity = vi.hoisted(() => ({
  readPollSnapshot: vi.fn(),
  readPollDisplayState: vi.fn(),
  recordPollVote: vi.fn(),
}));
vi.mock("@/lib/poll-vote-sanity", () => ({
  ...sanity,
  PollVoteSanityError: class PollVoteSanityError extends Error {},
}));

import { attemptPollVote, generatePollVisitorToken, readPublicPoll } from "./poll-vote-access";

const OPEN = "demo-poll-open", CLOSED = "demo-poll-closed";

beforeEach(() => {
  deploymentConfig.contentSource = "mock";
  for (const fn of Object.values(sanity)) fn.mockReset();
});

describe("attemptPollVote", () => {
  it("refuses a malformed identity before reading any poll, in either content source", async () => {
    for (const source of ["mock", "sanity"] as const) {
      deploymentConfig.contentSource = source;
      const token = generatePollVisitorToken();
      for (const request of [{ pollId: 1, optionId: "morning-light" }, { pollId: OPEN, optionId: null }, { pollId: "Not An Id!", optionId: "x" }]) {
        expect(await attemptPollVote(request, token)).toEqual({ outcome: "rejected", reason: "malformed-request" });
      }
    }
    expect(sanity.readPollSnapshot).not.toHaveBeenCalled();
    expect(sanity.recordPollVote).not.toHaveBeenCalled();
  });

  it("records one vote per visitor on an open mock poll and reports the repeat", async () => {
    const token = generatePollVisitorToken();
    expect(await attemptPollVote({ pollId: OPEN, optionId: "morning-light" }, token)).toEqual({ outcome: "recorded" });
    expect(await attemptPollVote({ pollId: OPEN, optionId: "evening-light" }, token)).toEqual({ outcome: "already-voted" });
    expect(sanity.recordPollVote).not.toHaveBeenCalled();
  });

  it("rejects closed polls, unknown polls and unknown options without writing", async () => {
    const token = generatePollVisitorToken();
    expect(await attemptPollVote({ pollId: CLOSED, optionId: "summer" }, token)).toEqual({ outcome: "rejected", reason: "closed" });
    expect(await attemptPollVote({ pollId: "no-such-poll", optionId: "summer" }, token)).toEqual({ outcome: "rejected", reason: "unknown-poll" });
    expect(await attemptPollVote({ pollId: OPEN, optionId: "noon-light" }, token)).toEqual({ outcome: "rejected", reason: "unknown-option" });
  });

  it("decides against the Sanity snapshot and writes through it for a configured CMS", async () => {
    deploymentConfig.contentSource = "sanity";
    sanity.readPollSnapshot.mockResolvedValue({ pollId: "cms-poll", question: "Q", closeDate: "2099-01-01T00:00:00Z", options: [{ optionId: "a", label: "A" }] });
    sanity.recordPollVote.mockResolvedValue(false);
    const token = generatePollVisitorToken();
    const now = new Date("2026-10-20T12:00:00Z");
    expect(await attemptPollVote({ pollId: "cms-poll", optionId: "a" }, token, now)).toEqual({ outcome: "already-voted" });
    expect(sanity.recordPollVote).toHaveBeenCalledWith({ pollId: "cms-poll", optionId: "a", visitorToken: token, votedAt: now.toISOString() });
  });
});

describe("readPublicPoll", () => {
  it("refuses an invalid identity and reads mock or CMS state by source", async () => {
    await expect(readPublicPoll("Not An Id!", undefined)).rejects.toThrow(TypeError);
    expect(await readPublicPoll(OPEN, undefined)).toBeDefined();
    deploymentConfig.contentSource = "sanity";
    sanity.readPollDisplayState.mockResolvedValue(undefined);
    expect(await readPublicPoll(OPEN, undefined)).toBeUndefined();
    expect(sanity.readPollDisplayState).toHaveBeenCalledTimes(1);
  });
});

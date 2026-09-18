import { describe, expect, it } from "vitest";
import { decidePollVoteRequest, type PollSnapshot } from "./poll-vote";

const OPEN_POLL: PollSnapshot = {
  pollId: "camera-preference",
  closeDate: "2099-01-01T00:00:00.000Z",
  options: [{ optionId: "mirrorless" }, { optionId: "dslr" }],
};

const CLOSED_POLL: PollSnapshot = {
  ...OPEN_POLL,
  closeDate: "2020-01-01T00:00:00.000Z",
};

const NOW = new Date("2026-09-18T00:00:00.000Z");

describe("decidePollVoteRequest", () => {
  it("accepts a well-formed vote for an open poll's real option", () => {
    const decision = decidePollVoteRequest({ pollId: "camera-preference", optionId: "mirrorless" }, OPEN_POLL, NOW);
    expect(decision).toEqual({ outcome: "eligible", pollId: "camera-preference", optionId: "mirrorless" });
  });

  it("rejects a non-string pollId or optionId as malformed", () => {
    expect(decidePollVoteRequest({ pollId: 42, optionId: "mirrorless" }, OPEN_POLL, NOW)).toEqual({
      outcome: "reject",
      reason: "malformed-request",
    });
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: null }, OPEN_POLL, NOW)).toEqual({
      outcome: "reject",
      reason: "malformed-request",
    });
  });

  it("rejects an identity-grammar-violating pollId or optionId as malformed", () => {
    expect(decidePollVoteRequest({ pollId: "Not Valid", optionId: "mirrorless" }, OPEN_POLL, NOW)).toEqual({
      outcome: "reject",
      reason: "malformed-request",
    });
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: "" }, OPEN_POLL, NOW)).toEqual({
      outcome: "reject",
      reason: "malformed-request",
    });
  });

  it("rejects when no poll snapshot was found", () => {
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: "mirrorless" }, undefined, NOW)).toEqual({
      outcome: "reject",
      reason: "unknown-poll",
    });
  });

  it("rejects when the supplied snapshot is for a different poll (caller bug guard)", () => {
    expect(
      decidePollVoteRequest({ pollId: "camera-preference", optionId: "mirrorless" }, { ...OPEN_POLL, pollId: "other-poll" }, NOW),
    ).toEqual({ outcome: "reject", reason: "unknown-poll" });
  });

  it("rejects a closed poll before checking the option", () => {
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: "does-not-exist" }, CLOSED_POLL, NOW)).toEqual({
      outcome: "reject",
      reason: "closed",
    });
  });

  it("treats now() exactly equal to closeDate as closed", () => {
    const boundary: PollSnapshot = { ...OPEN_POLL, closeDate: NOW.toISOString() };
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: "mirrorless" }, boundary, NOW)).toEqual({
      outcome: "reject",
      reason: "closed",
    });
  });

  it("accepts one millisecond before close", () => {
    const boundary: PollSnapshot = { ...OPEN_POLL, closeDate: new Date(NOW.getTime() + 1).toISOString() };
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: "mirrorless" }, boundary, NOW).outcome).toBe("eligible");
  });

  it("rejects an unknown option on an open poll", () => {
    expect(decidePollVoteRequest({ pollId: "camera-preference", optionId: "does-not-exist" }, OPEN_POLL, NOW)).toEqual({
      outcome: "reject",
      reason: "unknown-option",
    });
  });
});

it("fails closed when a malformed close date reaches the policy seam", () => {
  expect(() => decidePollVoteRequest({ pollId: OPEN_POLL.pollId, optionId: "mirrorless" }, { ...OPEN_POLL, closeDate: "invalid" }, NOW)).toThrow();
});

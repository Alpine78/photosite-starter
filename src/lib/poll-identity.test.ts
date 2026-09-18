import { describe, expect, it } from "vitest";
import {
  POLL_VISITOR_TOKEN_BYTES,
  generatePollVisitorToken,
  isCanonicalPollVisitorToken,
  pollTallyDocumentId,
  pollVoteReceiptDocumentId,
  pollVoterCookieName,
} from "./poll-identity";

describe("generatePollVisitorToken / isCanonicalPollVisitorToken", () => {
  it("generates a canonical token", () => {
    const token = generatePollVisitorToken();
    expect(isCanonicalPollVisitorToken(token)).toBe(true);
    expect(Buffer.from(token, "base64url").length).toBe(POLL_VISITOR_TOKEN_BYTES);
  });

  it("generates distinct tokens across calls", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generatePollVisitorToken()));
    expect(tokens.size).toBe(50);
  });

  it("rejects a non-canonical re-encoding of the same 32 bytes", () => {
    // A base64url string with padding-equivalent trailing bits altered still decodes
    // to different bytes than it re-encodes to for at least one such string; the real
    // regression this guards is a caller skipping the round-trip check entirely.
    const token = generatePollVisitorToken();
    const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    // Either it fails the round trip (still 43 chars, still valid alphabet) or it's outright rejected.
    const decoded = Buffer.from(tampered, "base64url");
    const roundTrips = decoded.length === POLL_VISITOR_TOKEN_BYTES && decoded.toString("base64url") === tampered;
    expect(isCanonicalPollVisitorToken(tampered)).toBe(roundTrips);
  });

  it("rejects wrong length", () => {
    expect(isCanonicalPollVisitorToken("abc")).toBe(false);
  });

  it("rejects a non-base64url character", () => {
    const token = generatePollVisitorToken();
    expect(isCanonicalPollVisitorToken(token.slice(0, -1) + "!")).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isCanonicalPollVisitorToken(42)).toBe(false);
    expect(isCanonicalPollVisitorToken(undefined)).toBe(false);
    expect(isCanonicalPollVisitorToken(null)).toBe(false);
  });
});

describe("pollTallyDocumentId", () => {
  it("builds the expected id", () => {
    expect(pollTallyDocumentId("camera-preference")).toBe("pollTally-camera-preference");
  });

  it("throws for a malformed pollId", () => {
    expect(() => pollTallyDocumentId("Not Valid")).toThrow(TypeError);
    expect(() => pollTallyDocumentId("")).toThrow(TypeError);
    expect(() => pollTallyDocumentId("-leading-hyphen")).toThrow(TypeError);
  });
});

describe("pollVoteReceiptDocumentId", () => {
  const token = generatePollVisitorToken();

  it("builds the expected id", () => {
    expect(pollVoteReceiptDocumentId("camera-preference", token)).toMatch(/^pollVote-[0-9a-f]{64}$/);
    expect(pollVoteReceiptDocumentId("camera-preference", token)).not.toContain(token);
  });

  it("is deterministic for the same inputs", () => {
    expect(pollVoteReceiptDocumentId("camera-preference", token)).toBe(pollVoteReceiptDocumentId("camera-preference", token));
  });

  it("differs for a different poll with the same token", () => {
    expect(pollVoteReceiptDocumentId("camera-preference", token)).not.toBe(pollVoteReceiptDocumentId("other-poll", token));
  });

  it("differs for a different token with the same poll", () => {
    const otherToken = generatePollVisitorToken();
    expect(pollVoteReceiptDocumentId("camera-preference", token)).not.toBe(
      pollVoteReceiptDocumentId("camera-preference", otherToken),
    );
  });

  it("throws for a malformed pollId", () => {
    expect(() => pollVoteReceiptDocumentId("Not Valid", token)).toThrow(TypeError);
  });

  it("throws for a non-canonical token", () => {
    expect(() => pollVoteReceiptDocumentId("camera-preference", "short")).toThrow(TypeError);
    expect(() => pollVoteReceiptDocumentId("camera-preference", token.slice(0, -1) + "!")).toThrow(TypeError);
  });
});

it("bounds document IDs and separates cookies per poll", () => {
  const token = generatePollVisitorToken();
  expect(pollVoteReceiptDocumentId("p".repeat(64), token).length).toBeLessThanOrEqual(128);
  expect(() => pollTallyDocumentId("p".repeat(65))).toThrow();
  expect(pollVoterCookieName("one")).not.toBe(pollVoterCookieName("two"));
});

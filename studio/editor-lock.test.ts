import { describe, expect, it } from "vitest";
import { transactionSyncLocked } from "./editor-lock";

describe("transaction sync lock state", () => {
  it("treats Sanity's idle state as unlocked", () => {
    expect(transactionSyncLocked({ enabled: false })).toBe(false);
    expect(transactionSyncLocked(null)).toBe(false);
    expect(transactionSyncLocked(undefined)).toBe(false);
  });
  it("blocks an active, unreadable or malformed lock", () => {
    for (const lock of [{ enabled: true }, {}, { enabled: "false" }, "locked", true, 1]) {
      expect(transactionSyncLocked(lock)).toBe(true);
    }
  });
});

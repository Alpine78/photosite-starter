import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  runPrivateGalleryRetention, RETENTION_LEASE_MS, RETENTION_FINISH_MARGIN_MS, RETENTION_PORT_TIMEOUT_MS, type RetentionRow,
  type RetentionMetadataPort, type RetentionObjectPort, type RetentionClaim,
} from "./private-gallery-retention-workflow.mts";
import * as state from "../src/lib/private-gallery-state.ts";
import * as domain from "../src/lib/private-gallery.ts";

const NOW = new Date("2027-03-01T12:00:00Z");
const token = "claim_token_1234567890";
const key = (id = "gallery-1", index = 0) => `private/g/${id}/proof/${String(index).padStart(22, "0")}`;
function row(id = "gallery-1", count = 2): RetentionRow {
  return { galleryId: id, revision: 0, state: "published", accessExpiresAt: new Date("2027-02-01T12:00:00Z"), objectKeys: Array.from({ length: count }, (_, index) => key(id, index)), nextIndex: 0 };
}
function harness(initial: RetentionRow[] = [row()]) {
  const rows = new Map(initial.map((entry) => [entry.galleryId, structuredClone(entry)]));
  const claims = new Map<string, RetentionClaim>();
  const lastAttempt = new Map<string, number>();
  const generations = new Map(initial.map((entry) => [entry.galleryId, 0]));
  const events: string[] = [];
  const absent = new Set<string>();
  const defects = new Set<string>();
  let time = new Date(NOW);
  const clock = () => new Date(time);
  const metadata: RetentionMetadataPort = {
    recordDefect: async () => {},
    readHealth: async () => ({ parked: 0, overdue: 0, defects: 0 }),
    reapExpiredSessions: vi.fn(async () => { events.push("reap"); return 3; }),
    listCandidates: vi.fn(async (_now, limit) => [...rows.values()]
      .filter((entry) => entry.state !== "deleted" && entry.deletionFailureAcknowledged !== true && entry.operatorAttentionRequired !== true)
      .sort((a, b) => (lastAttempt.get(a.galleryId) ?? -Infinity) - (lastAttempt.get(b.galleryId) ?? -Infinity) || a.galleryId.localeCompare(b.galleryId))
      .slice(0, limit).map((entry) => entry.galleryId)),
    read: vi.fn(async (id) => structuredClone(rows.get(id))),
    expire: vi.fn(async (input) => {
      const current = rows.get(input.galleryId)!;
      if (current.revision !== input.expectedRevision) return false;
      events.push("expire");
      rows.set(input.galleryId, { ...current, state: "expiring", revision: current.revision + 1, cleanupTriggeredAt: input.cleanupTriggeredAt });
      generations.set(input.galleryId, generations.get(input.galleryId)! + 1);
      return true;
    }),
    claim: vi.fn(async (input) => {
      const current = rows.get(input.galleryId)!;
      if (current.revision !== input.expectedRevision || current.deletionFailureAcknowledged === true || current.operatorAttentionRequired === true ||
          !["expiring", "deleting", "deletion-failed"].includes(current.state) ||
          current.nextIndex !== input.nextIndex ||
          createHash("sha256").update(JSON.stringify(current.objectKeys)).digest("hex") !== input.manifestDigest ||
          (claims.get(input.galleryId)?.expiresAt.getTime() ?? 0) > input.now.getTime()) return undefined;
      const claim = { token: token + current.revision, expiresAt: input.expiresAt };
      defects.delete(input.galleryId);
      events.push("claim"); claims.set(input.galleryId, claim); lastAttempt.set(input.galleryId, input.now.getTime());
      rows.set(input.galleryId, { ...current, state: "deleting", revision: current.revision + 1 });
      return structuredClone(claim);
    }),
    finish: vi.fn(async (input) => {
      const claim = claims.get(input.galleryId);
      if (claim === undefined || claim.token !== input.token || input.now >= claim.expiresAt) return false;
      const current = rows.get(input.galleryId)!;
      if (input.nextIndex < current.nextIndex || input.nextIndex > current.objectKeys.length ||
          (input.outcome === "deleted" && input.nextIndex !== current.objectKeys.length)) return false;
      events.push("finish:" + input.outcome);
      rows.set(input.galleryId, { ...current, revision: current.revision + 1, nextIndex: input.nextIndex,
        state: input.outcome === "deleted" ? "deleted" : input.outcome === "failed" ? "deletion-failed" : "deleting",
        operatorAttentionRequired: input.reason === "unexpected-object" });
      if (input.outcome === "deleted") defects.delete(input.galleryId);
      claims.delete(input.galleryId);
      return true;
    }),
  };
  metadata.recordDefect = vi.fn(async (id, at) => {
    if (!rows.has(id) || rows.get(id)?.state === "deleted") return;
    defects.add(id); lastAttempt.set(id, at.getTime());
  });
  metadata.readHealth = vi.fn(async () => ({
    parked: [...rows.values()].filter((entry) => entry.operatorAttentionRequired === true || entry.deletionFailureAcknowledged === true).length,
    overdue: [...rows.values()].filter((entry) => entry.state !== "deleted" && entry.cleanupTriggeredAt !== undefined && time.getTime() - entry.cleanupTriggeredAt.getTime() >= 30 * 86_400_000).length,
    defects: defects.size,
  }));
  const objects: RetentionObjectPort = {
    quiesceGalleryUploads: vi.fn(async () => { events.push("quiesce"); return true; }),
    removeAndVerify: vi.fn(async (objectKey: string) => { events.push("remove"); expect(generations.get(objectKey.split("/")[2])).toBeGreaterThan(0); absent.add(objectKey); return "absent" as const; }),
    verifyGalleryEmpty: vi.fn(async () => { events.push("verify"); return true; }),
    readBackstop: vi.fn(async () => { events.push("backstop"); return { enabled: true, objectAgeDays: 275, noncurrentDays: 30, multipartDays: 7 }; }),
  };
  const run = (extra = {}) => runPrivateGalleryRetention({ metadata, objects, clock, keyPrefix: "private", ...extra });
  return { rows, claims, metadata, objects, events, absent, generations, run, clock, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

describe("private-gallery retention worker", () => {
  it("revokes access before object IO and marks deleted only after whole-prefix verification", async () => {
    const h = harness(); const result = await h.run();
    expect(h.events).toEqual(["reap", "expire", "claim", "quiesce", "remove", "remove", "verify", "finish:deleted", "backstop"]);
    expect(result).toMatchObject({ deleted: 1, sessionsReaped: 3, objectOperations: 2, issues: [] });
    expect(h.rows.get("gallery-1")?.cleanupTriggeredAt).toEqual(new Date("2027-02-01T12:00:00Z"));
  });
  it.each(["preparing", "ready", "access-suspended"] as const)("retains the original %s abandonment deadline", async (state) => {
    const value = { ...row(), state, preparationStartedAt: new Date("2026-12-01T12:00:00Z"), accessSuspendedAt: new Date("2026-12-01T12:00:00Z") };
    const h = harness([value]); await h.run();
    expect(h.rows.get("gallery-1")?.cleanupTriggeredAt).toEqual(new Date("2026-12-31T12:00:00Z"));
  });
  it("preserves an earlier administrator cleanup trigger and reports overdue", async () => {
    const h = harness([{ ...row(), cleanupTriggeredAt: new Date("2026-12-01T12:00:00Z") }]);
    expect(await h.run()).toMatchObject({ deleted: 1, overdueCheckpoints: 1 });
    expect(h.rows.get("gallery-1")?.cleanupTriggeredAt).toEqual(new Date("2026-12-01T12:00:00Z"));
  });
  it("reaps expired sessions and checks backstop even with no due gallery", async () => {
    const h = harness([{ ...row(), accessExpiresAt: new Date("2028-01-01Z") }]);
    expect(await h.run()).toMatchObject({ notDue: 1, sessionsReaped: 3 });
    expect(h.objects.removeAndVerify).not.toHaveBeenCalled(); expect(h.objects.readBackstop).toHaveBeenCalledOnce();
  });
  it("persists one bounded slice and resumes idempotently on the next run", async () => {
    const h = harness(); expect(await h.run({ objectLimit: 1 })).toMatchObject({ progressed: 1, objectOperations: 1 });
    expect(h.rows.get("gallery-1")?.nextIndex).toBe(1);
    expect(await h.run({ objectLimit: 1 })).toMatchObject({ deleted: 1, objectOperations: 1 });
    expect(h.metadata.finish).toHaveBeenCalledTimes(2);
  });
  it("retries an interrupted delete without accepting stale completion", async () => {
    const h = harness(); vi.mocked(h.objects.removeAndVerify).mockImplementationOnce(async (objectKey) => {
      h.absent.add(objectKey); h.advance(RETENTION_LEASE_MS); return "absent";
    });
    expect(await h.run()).toMatchObject({ conflicts: 1, deleted: 0 });
    expect(h.metadata.finish).not.toHaveBeenCalled();
    expect(await h.run()).toMatchObject({ deleted: 1 });
    expect(h.objects.removeAndVerify).toHaveBeenCalledTimes(3);
  });
  it("fails without declaring deletion when an object remains, then retries", async () => {
    const h = harness(); vi.mocked(h.objects.removeAndVerify).mockResolvedValueOnce("remaining");
    expect(await h.run()).toMatchObject({ failed: 1, deleted: 0, issues: ["object-failed"] });
    expect(h.objects.verifyGalleryEmpty).not.toHaveBeenCalled();
    expect(await h.run()).toMatchObject({ deleted: 1 });
  });
  it("parks unknown prefix objects for attention and never deletes outside the manifest", async () => {
    const h = harness(); vi.mocked(h.objects.verifyGalleryEmpty).mockResolvedValue(false);
    expect(await h.run()).toMatchObject({ failed: 1, issues: ["unexpected-object", "operator-attention"] });
    expect(h.rows.get("gallery-1")).toMatchObject({ state: "deletion-failed", operatorAttentionRequired: true });
    await h.run(); expect(h.objects.removeAndVerify).toHaveBeenCalledTimes(2);
  });
  it("does not retry acknowledged failed rows even if discovery supplies one", async () => {
    const h = harness([{ ...row(), state: "deletion-failed", cleanupTriggeredAt: NOW, deletionFailureAcknowledged: true }]);
    vi.mocked(h.metadata.listCandidates).mockResolvedValue(["gallery-1"]);
    expect(await h.run()).toMatchObject({ notDue: 1 }); expect(h.metadata.claim).not.toHaveBeenCalled();
  });
  it.each([
    { objectKeys: [key("other-gallery")] }, { objectKeys: [key(), key()] },
    { nextIndex: 9 }, { revision: -1 }, { accessExpiresAt: undefined },
    { accessExpiresAt: new Date(NaN) }, { state: "deleting", cleanupTriggeredAt: undefined },
    { state: "deleting", cleanupTriggeredAt: new Date("2028-01-01Z") },
  ])("refuses malformed rows before mutation or object IO: %j", async (bad) => {
    const h = harness([{ ...row(), ...bad } as RetentionRow]);
    expect(await h.run()).toMatchObject({ failed: 1, issues: ["invalid-store-result"] });
    expect(h.metadata.expire).not.toHaveBeenCalled(); expect(h.objects.removeAndVerify).not.toHaveBeenCalled();
  });
  it.each([{ ids: ["gallery-1", "gallery-1"] }, { ids: ["../foreign"] }, { ids: Array.from({ length: 21 }, (_, i) => `gallery-${i}`) }])("rejects malformed discovery %j", async ({ ids }) => {
    const h = harness(); vi.mocked(h.metadata.listCandidates).mockResolvedValue(ids);
    expect(await h.run()).toMatchObject({ discovered: 0, issues: ["invalid-store-result"] }); expect(h.metadata.read).not.toHaveBeenCalled();
  });
  it("concurrent workers have one claim winner and no duplicate gallery completion", async () => {
    const h = harness(); const results = await Promise.all([h.run(), h.run()]);
    expect(results.reduce((n, result) => n + result.deleted, 0)).toBe(1);
    expect(h.objects.removeAndVerify).toHaveBeenCalledTimes(2);
  });
  it("the fake store independently enforces revision, manifest and lease fencing", async () => {
    const h = harness([{ ...row(), state: "expiring", cleanupTriggeredAt: NOW }]);
    const base = { galleryId: "gallery-1", expectedRevision: 0, manifestDigest: createHash("sha256").update(JSON.stringify(row().objectKeys)).digest("hex"), nextIndex: 0, now: NOW, expiresAt: new Date(NOW.getTime() + RETENTION_LEASE_MS) };
    expect(await h.metadata.claim({ ...base, expectedRevision: 1 }, AbortSignal.timeout(5_000))).toBeUndefined();
    expect(await h.metadata.claim({ ...base, manifestDigest: "wrong" }, AbortSignal.timeout(5_000))).toBeUndefined();
    const owned = await h.metadata.claim(base, AbortSignal.timeout(5_000)); expect(owned).toBeDefined(); expect(await h.metadata.claim({ ...base, expectedRevision: 1 }, AbortSignal.timeout(5_000))).toBeUndefined();
    expect(await h.metadata.finish({ galleryId: "gallery-1", token: "wrong", nextIndex: 0, now: NOW, outcome: "pending" }, AbortSignal.timeout(5_000))).toBe(false);
    expect(await h.metadata.finish({ galleryId: "gallery-1", token: owned!.token, nextIndex: 0, now: base.expiresAt, outcome: "pending" }, AbortSignal.timeout(5_000))).toBe(false);
  });
  it("attempt ordering prevents a failed gallery starving an unattempted one", async () => {
    const h = harness([row("gallery-1"), row("gallery-2")]);
    vi.mocked(h.objects.removeAndVerify).mockResolvedValueOnce("remaining");
    await h.run({ galleryLimit: 1 }); await h.run({ galleryLimit: 1 });
    expect(h.rows.get("gallery-1")?.state).toBe("deletion-failed"); expect(h.rows.get("gallery-2")?.state).toBe("deleted");
  });
  it("redacts arbitrary provider exceptions and still checks lifecycle policy", async () => {
    const h = harness(); vi.mocked(h.objects.removeAndVerify).mockRejectedValue(new Error("SECRET https://provider/private/customer.zip"));
    const result = await h.run(); expect(JSON.stringify(result)).not.toMatch(/SECRET|customer|provider/); expect(result.issues).toEqual(["object-failed"]);
    expect(h.objects.readBackstop).toHaveBeenCalledOnce();
  });
  it.each([{ enabled: false }, { objectAgeDays: 274 }, { objectAgeDays: 276 }, { noncurrentDays: 31 }, { multipartDays: 8 }])("detects unsafe lifecycle drift %j", async (change) => {
    const h = harness([]); vi.mocked(h.objects.readBackstop).mockResolvedValue({ enabled: true, objectAgeDays: 275, noncurrentDays: 30, multipartDays: 7, ...change });
    expect((await h.run()).issues).toEqual(["backstop-drift"]);
  });
  it("refuses a stale metadata transition before deleting anything", async () => {
    const h = harness(); vi.mocked(h.metadata.expire).mockResolvedValue(false);
    expect(await h.run()).toMatchObject({ conflicts: 1, objectOperations: 0 });
    expect(h.metadata.claim).not.toHaveBeenCalled();
  });
  it("refuses malformed claim responses before any object operation", async () => {
    const h = harness(); vi.mocked(h.metadata.claim).mockResolvedValue({ token: "invalid", expiresAt: NOW });
    expect(await h.run()).toMatchObject({ failed: 1, issues: ["metadata-failed"] });
    expect(h.objects.removeAndVerify).not.toHaveBeenCalled();
  });
  it("does not report completion when the lease CAS loses", async () => {
    const h = harness(); vi.mocked(h.metadata.finish).mockResolvedValue(false);
    expect(await h.run()).toMatchObject({ deleted: 0, conflicts: 1 });
    expect(h.rows.get("gallery-1")?.state).toBe("deleting");
  });
  it("caps total object work across galleries and leaves later candidates untouched", async () => {
    const h = harness([row("gallery-1", 101), row("gallery-2")]);
    expect(await h.run()).toMatchObject({ objectOperations: 100, progressed: 1, deleted: 0 });
    expect(h.rows.get("gallery-2")?.state).toBe("published");
  });
  it("rejects oversized manifests before an expire transition", async () => {
    const h = harness([row("gallery-1", 5_001)]);
    expect(await h.run()).toMatchObject({ failed: 1, issues: ["invalid-store-result"] });
    expect(h.metadata.expire).not.toHaveBeenCalled();
  });
  it("checks lifecycle policy even if session cleanup and discovery fail", async () => {
    const h = harness(); vi.mocked(h.metadata.reapExpiredSessions).mockRejectedValue(new Error("secret"));
    vi.mocked(h.metadata.listCandidates).mockRejectedValue(new Error("secret"));
    expect(await h.run()).toMatchObject({ issues: ["sessions-failed", "discovery-failed"] });
    expect(h.objects.readBackstop).toHaveBeenCalledOnce();
  });
  it("refuses invalid limits and clock before all IO", async () => {
    const h = harness(); await expect(h.run({ objectLimit: 101 })).rejects.toThrow("Invalid retention limits");
    await expect(h.run({ clock: () => new Date(NaN) })).rejects.toThrow("Invalid retention clock");
    await expect(h.run({ keyPrefix: "a".repeat(129) })).rejects.toThrow("Invalid retention key prefix");
    expect(h.metadata.reapExpiredSessions).not.toHaveBeenCalled();
  });
  it("records invalid attempts so malformed rows cannot starve healthy cleanup", async () => {
    const malformed = Array.from({ length: 20 }, (_, index) => ({ ...row(`bad-${index}`), revision: -1 }));
    const h = harness([...malformed, row("valid-gallery")]);
    expect((await h.run()).failed).toBe(20);
    expect(h.metadata.recordDefect).toHaveBeenCalledTimes(20);
    expect((await h.run()).deleted).toBe(1);
  });
  it("saves progress before the lease ends when a slow slice reaches its finish margin", async () => {
    const h = harness(); vi.mocked(h.objects.removeAndVerify).mockImplementationOnce(async () => {
      h.advance(RETENTION_LEASE_MS - RETENTION_FINISH_MARGIN_MS); return "absent";
    });
    expect(await h.run()).toMatchObject({ progressed: 1, objectOperations: 1, conflicts: 0 });
    expect(h.rows.get("gallery-1")?.nextIndex).toBe(1);
    expect(await h.run()).toMatchObject({ deleted: 1 });
  });
  it("keeps parked/overdue/defect alerts visible when discovery excludes those rows", async () => {
    const h = harness([{ ...row(), state: "deletion-failed", operatorAttentionRequired: true, cleanupTriggeredAt: new Date("2026-12-01Z") }]);
    expect(await h.run()).toMatchObject({ discovered: 0, parked: 1, outstandingOverdue: 1, issues: ["operator-attention", "retention-overdue"] });
    expect(await h.run()).toMatchObject({ parked: 1, outstandingOverdue: 1 });
  });
  it("refuses deletion when the upload protocol cannot prove quiescence", async () => {
    const h = harness(); vi.mocked(h.objects.quiesceGalleryUploads).mockResolvedValue(false);
    expect(await h.run()).toMatchObject({ deleted: 0, issues: ["uploads-active", "object-failed"] });
    expect(h.objects.removeAndVerify).not.toHaveBeenCalled(); expect(h.objects.verifyGalleryEmpty).not.toHaveBeenCalled();
  });
  it("bounds stalled metadata calls and still performs final policy checks", async () => {
    vi.useFakeTimers();
    try {
      const h = harness([]); vi.mocked(h.metadata.reapExpiredSessions).mockImplementation(async () => new Promise(() => {}));
      const pending = h.run(); await vi.advanceTimersByTimeAsync(RETENTION_PORT_TIMEOUT_MS + 1);
      expect(await pending).toMatchObject({ issues: ["sessions-failed"] }); expect(h.objects.readBackstop).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("uses a fresh token after lease takeover, refusing an earlier worker", async () => {
    const h = harness([{ ...row(), state: "expiring", cleanupTriggeredAt: NOW }]);
    const base = { galleryId: "gallery-1", expectedRevision: 0, manifestDigest: createHash("sha256").update(JSON.stringify(row().objectKeys)).digest("hex"), nextIndex: 0, now: NOW, expiresAt: new Date(NOW.getTime() + RETENTION_LEASE_MS) };
    const first = await h.metadata.claim(base, AbortSignal.timeout(5_000));
    h.advance(RETENTION_LEASE_MS);
    const second = await h.metadata.claim({ ...base, expectedRevision: 1, now: h.clock(), expiresAt: new Date(h.clock().getTime() + RETENTION_LEASE_MS) }, AbortSignal.timeout(5_000));
    expect(first!.token).not.toBe(second!.token);
    expect(await h.metadata.finish({ galleryId: "gallery-1", token: first!.token, now: h.clock(), nextIndex: 0, outcome: "pending" }, AbortSignal.timeout(5_000))).toBe(false);
  });
  it("reports transient metadata failures without marking healthy rows corrupt", async () => {
    const h = harness(); vi.mocked(h.metadata.read).mockRejectedValueOnce(new Error("transport details"));
    expect(await h.run()).toMatchObject({ failed: 1, defects: 0, issues: ["metadata-failed"] });
    expect(h.metadata.recordDefect).not.toHaveBeenCalled();
    expect(await h.run()).toMatchObject({ deleted: 1, defects: 0, issues: [] });
  });
  it("exposes the original state machine unchanged through the server facade", () => {
    for (const [name, value] of Object.entries(state)) expect(domain[name as keyof typeof domain]).toBe(value);
  });
  it("imports under plain pinned Node without server-only or alias resolution", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "import('./scripts/private-gallery-retention-workflow.mts').then(m=>console.log(typeof m.runPrivateGalleryRetention))"], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout.trim()).toBe("function");
  });
});

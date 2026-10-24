import { describe, expect, it } from "vitest";
import { memorySanityLake } from "../../test-support/sanity-lake";
import { cleanupControlId, cleanupPolicyFromGallery, type CleanupControl } from "@/lib/client-gallery-cleanup-contract";
import { CleanupSnapshotBuilder } from "./client-gallery-cleanup-snapshot";
import { CLEANUP_CURSOR_ID, runClientGalleryCleanup, type CleanupRunDependencies } from "./client-gallery-cleanup-runner";
import { createClientGalleryCleanupTransport, type CleanupMutationResult } from "./client-gallery-cleanup-transport";

const at = "2026-10-24T10:00:00.000Z", now = Date.parse(at);
const image = `image-${"a".repeat(40)}-1600x1000-webp`;
const shared = `image-${"b".repeat(40)}-1000x1600-webp`;
const ref = (_ref: string, weak = false) => ({ _type: "reference", _ref, ...(weak ? { _weak: true } : {}) });
function gallery(id = "delivery") {
  return { _id: id, _type: "clientDeliveryGallery", handle: "c".repeat(32), available: true, availabilityMode: "until", expiryInstant: at,
    title: [{ _key: "en", _type: "localizedText", language: "en", value: "private-title-canary" }],
    items: [image, shared].map((asset, index) => ({ _key: `item-${index}`, _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: ref(asset) },
      alt: [{ _key: "en", _type: "localizedText", language: "en", value: "private-alt-canary" }] })) };
}
function asset(id: string) {
  const match = /^image-(.*)-(\d+)x(\d+)-(.*)$/u.exec(id)!;
  return { _id: id, _type: "sanity.imageAsset", sha1hash: match[1], extension: match[4], mimeType: "image/webp", metadata: { dimensions: { width: Number(match[2]), height: Number(match[3]) } } };
}
async function control(id = "delivery"): Promise<CleanupControl> {
  return { _id: await cleanupControlId(id), _type: "clientGalleryCleanup", version: 1, galleryId: id, policy: cleanupPolicyFromGallery(gallery(id))!,
    sourceDocumentId: `drafts.${id}`, sourceRevision: "reviewed-source", publicationId: `publication-${id}`, enrolledAt: "2026-04-24T10:00:00.000Z", state: "enrolled" };
}
async function setup(extra: Record<string, unknown>[] = [], controls?: CleanupControl[]) {
  const enrolled = controls ?? [await control()];
  const store = memorySanityLake([gallery(), asset(image), asset(shared), { _id: "portfolio", _type: "gallery", image: ref(shared) }, ...enrolled, ...extra]);
  const builder = new CleanupSnapshotBuilder({ maxSnapshotBytes: 64 * 1024 * 1024, maxLineBytes: 1024 * 1024, maxDocuments: 100_000, maxReferences: 500_000 });
  builder.append(new TextEncoder().encode([...store.docs.values()].map((doc) => JSON.stringify(doc)).join("\n") + "\n"));
  let sequence = 0, clock = 0;
  const writes: (readonly Record<string, unknown>[])[] = [];
  const settings = {
    beforeMutation: undefined as undefined | ((mutations: readonly Record<string, unknown>[]) => void),
    mutation: undefined as undefined | ((mutations: readonly Record<string, unknown>[]) => Promise<CleanupMutationResult>),
    beforeRead: undefined as undefined | ((ids: readonly string[]) => void),
  };
  const dependencies: CleanupRunDependencies = {
    snapshot: builder.finish(now), now: () => now, clock: () => clock, remainingMs: () => 185_000 - clock, operationId: () => `operation-${++sequence}`,
    read: async (ids, options) => {
      settings.beforeRead?.(ids);
      const result = await store.read(ids, options?.includeAllVersions ?? false);
      const raw = result as { documents: Record<string, unknown>[]; omitted: { id: string }[] };
      return { documents: new Map(raw.documents.map((doc) => [doc._id as string, doc])), omitted: new Set(raw.omitted.map((entry) => entry.id)) };
    },
    mutate: async (mutations) => {
      writes.push([...mutations]);
      settings.beforeMutation?.(mutations);
      if (settings.mutation) return settings.mutation(mutations);
      try { store.commit(mutations); return { kind: "committed", transactionId: `tx-${writes.length}` }; }
      catch { return { kind: "conflict" }; }
    },
  };
  return { store, dependencies, settings, writes, enrolled, setClock: (value: number) => { clock = value; } };
}
const deletesGallery = (mutations: readonly Record<string, unknown>[]) => mutations.some((entry) => (entry.delete as { id?: string } | undefined)?.id === "delivery");

describe("bounded delivery cleanup against an atomic Content Lake", () => {
  it("runs the actual HTTP snapshot/Doc/mutation adapters through the real parser and planner", async () => {
    const run = await setup(); const requests: string[] = [];
    const transport = createClientGalleryCleanupTransport({ projectId: "example123", dataset: "production", apiVersion: "v2026-06-24", token: "synthetic-token" }, {
      now: () => now,
      fetch: async (input, options) => {
        const url = new URL(String(input)); requests.push(url.pathname);
        expect(url.origin).toBe("https://example123.api.sanity.io");
        expect(new Headers(options?.headers).get("authorization")).toBe("Bearer synthetic-token");
        const headers = { date: new Date(now).toUTCString() };
        if (url.pathname.includes("/export/")) return new Response([...run.store.docs.values()].map((doc) => JSON.stringify(doc)).join("\n") + "\n", { headers });
        if (url.pathname.includes("/doc/")) {
          const ids = decodeURIComponent(url.pathname.split("/").at(-1)!).split(",");
          return Response.json(await run.store.read(ids, url.searchParams.get("includeAllVersions") === "true"), { headers });
        }
        const body = JSON.parse(options?.body as string) as { mutations: Record<string, unknown>[] };
        try {
          run.store.commit(body.mutations);
          const ids = new Set(body.mutations.map((mutation) => {
            const kind = Object.keys(mutation)[0], value = mutation[kind] as { _id?: string; id?: string };
            return value._id ?? value.id;
          }));
          return Response.json({ transactionId: "synthetic-transaction", results: [...ids].map((id) => ({ id, operation: run.store.docs.has(id!) ? "update" : "delete" })) }, { headers });
        } catch { return new Response(null, { status: 409 }); }
      },
    });
    const snapshot = await transport.snapshot();
    const counts = await runClientGalleryCleanup({ ...run.dependencies, snapshot, read: transport.read, mutate: transport.mutate });
    expect(counts).toMatchObject({ completed: 1, deletedAssets: 1, sharedAssets: 1 });
    expect(requests.filter((path) => path.includes("/mutate/"))).toHaveLength(3);
    expect(run.store.docs.has("delivery")).toBe(false);
    expect(run.store.docs.get(run.enrolled[0]._id)?.state).toBe("complete");
  });
  it("deletes only the expired gallery and unshared image, preserving shared bytes and exact receipt", async () => {
    const run = await setup();
    const counts = await runClientGalleryCleanup(run.dependencies);
    expect(counts).toMatchObject({ examined: 1, attempts: 1, completed: 1, deletedAssets: 1, sharedAssets: 1, cursorWritten: true });
    expect(run.store.docs.has("delivery")).toBe(false); expect(run.store.docs.has(image)).toBe(false); expect(run.store.docs.has(shared)).toBe(true);
    const completed = run.store.docs.get(run.enrolled[0]._id)!;
    expect(completed).toMatchObject({ state: "complete", publicationId: "publication-delivery", sourceRevision: "reviewed-source", receipt: { operationId: "operation-1", deletedCount: 1, sharedCount: 1 } });
    expect(completed.attempt).toBeUndefined();
    expect(JSON.stringify(completed)).not.toMatch(/private-title|private-alt|https:/u);
    expect((await runClientGalleryCleanup(run.dependencies)).attempts).toBe(0);
  });
  it("keeps every observed weak use and private media use", async () => {
    for (const extra of [ { _id: "weak-use", _type: "article", asset: ref(image, true) }, { _id: "private-media", _type: "media", privateOnly: true, image: { asset: ref(image) } } ]) {
      const run = await setup([extra]);
      expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1, deletedAssets: 0, sharedAssets: 2 });
      expect(run.store.docs.has(image)).toBe(true);
    }
  });
  it.each(["drafts.delivery", "versions.release.delivery"])("refuses observed %s", async (id) => {
    const run = await setup([{ ...gallery(), _id: id }]);
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ blocked: 1, attempts: 0 });
    expect(run.store.docs.get(run.enrolled[0]._id)?.lastResult).toMatchObject({ reason: "gallery_variants" });
    expect(run.store.docs.has(image)).toBe(true);
  });
  it("blocks incoming gallery references, stale policy, missing sources and malformed metadata visibly", async () => {
    for (const reason of ["incoming_reference", "policy_changed", "missing_gallery", "invalid_assets"] as const) {
      const run = await setup(reason === "incoming_reference" ? [{ _id: "old-proof", _type: "clientProofGallery", replacedBy: ref("delivery", true) }] : []);
      if (reason === "policy_changed") run.store.put({ ...run.store.docs.get("delivery")!, expiryInstant: "2026-10-23T10:00:00.000Z" });
      if (reason === "missing_gallery") run.store.docs.delete("delivery");
      if (reason === "invalid_assets") run.store.put({ ...run.store.docs.get(image)!, mimeType: "image/jpeg" });
      expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ blocked: 1, attempts: 0 });
      expect(run.store.docs.get(run.enrolled[0]._id)?.lastResult).toMatchObject({ reason });
    }
  });
  it("replans at the latest source revision for text-only edits without dropping consent", async () => {
    const run = await setup();
    run.store.put({ ...run.store.docs.get("delivery")!, title: [{ _key: "en", _type: "localizedText", language: "en", value: "new title" }] });
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1 });
  });
  it.each(["source", "draft", "strong-reference", "control"])("rolls back the whole deletion on a late %s write", async (race) => {
    const run = await setup(); let raced = false;
    run.settings.beforeMutation = (mutations) => {
      if (!deletesGallery(mutations) || raced) return;
      raced = true;
      if (race === "source") run.store.put({ ...run.store.docs.get("delivery")!, available: false });
      if (race === "draft") run.store.put({ ...gallery(), _id: "drafts.delivery" });
      if (race === "strong-reference") run.store.put({ _id: "late-use", _type: "article", asset: ref(image) });
      if (race === "control") run.store.put({ ...run.store.docs.get(run.enrolled[0]._id)!, state: "disabled", attempt: undefined });
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 0, conflict: 1 });
    expect(run.store.docs.has("delivery")).toBe(true); expect(run.store.docs.has(image)).toBe(true);
    expect(run.store.docs.get(run.enrolled[0]._id)?.receipt).toBeUndefined();
  });
  it("reconciles a committed deletion whose response was lost", async () => {
    const run = await setup();
    run.settings.mutation = async (mutations) => { run.store.commit(mutations); return deletesGallery(mutations) ? { kind: "uncertain" } : { kind: "committed", transactionId: "tx" }; };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1, uncertain: 0, deletedAssets: 1 });
    expect(run.writes.filter(deletesGallery)).toHaveLength(1);
  });
  it("a late destructive request loses its fence after an uncertain response; no blind replay", async () => {
    const run = await setup(); let delayed: readonly Record<string, unknown>[] | undefined;
    run.settings.mutation = async (mutations) => {
      if (deletesGallery(mutations)) { delayed = mutations; return { kind: "uncertain" }; }
      run.store.commit(mutations); return { kind: "committed", transactionId: "tx" };
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ uncertain: 1, completed: 0 });
    expect(run.store.docs.get(run.enrolled[0]._id)?.state).toBe("enrolled");
    expect(() => run.store.commit(delayed!)).toThrow("revision");
    expect(run.store.docs.has(image)).toBe(true); expect(run.writes.filter(deletesGallery)).toHaveLength(1);
  });
  it("fences a prior pending attempt before inventory and a fresh claim", async () => {
    const current = await control();
    const run = await setup([], [{ ...current, state: "pending", attempt: { operationId: "old-attempt", at } }]);
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1 });
    const changes = run.writes.map((mutations) => ((mutations[0]?.patch as { set?: { state?: string } })?.set?.state));
    expect(changes.slice(0, 3)).toEqual(["enrolled", "pending", "complete"]);
  });
  it("an uncertain claim that was not observed never triggers deletion", async () => {
    const run = await setup();
    run.settings.mutation = async (mutations) => {
      const state = (mutations[0]?.patch as { set?: { state?: string } })?.set?.state;
      if (state === "pending") return { kind: "uncertain" };
      run.store.commit(mutations); return { kind: "committed", transactionId: "tx" };
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ uncertain: 1, completed: 0 });
    expect(run.writes.filter(deletesGallery)).toHaveLength(0);
    expect(run.store.docs.get(run.enrolled[0]._id)?.lastResult).toMatchObject({ reason: "uncertain" });
  });
  it("can finish a single claim whose lost response is confirmed as its exact pending operation", async () => {
    const run = await setup();
    run.settings.mutation = async (mutations) => {
      run.store.commit(mutations);
      const state = (mutations[0]?.patch as { set?: { state?: string } })?.set?.state;
      return state === "pending" ? { kind: "uncertain" } : { kind: "committed", transactionId: "tx" };
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1, attempts: 1 });
    expect(run.writes.filter(deletesGallery)).toHaveLength(1);
  });
  it("a late old deletion winning before the pending fence is recognized by its exact receipt", async () => {
    const run = await setup(); let delayed: readonly Record<string, unknown>[] | undefined;
    run.settings.mutation = async (mutations) => {
      const state = (mutations[0]?.patch as { set?: { state?: string } })?.set?.state;
      if (deletesGallery(mutations)) { delayed = mutations; return { kind: "uncertain" }; }
      if (state === "enrolled") return { kind: "uncertain" }; // A second lost request has not committed either.
      run.store.commit(mutations); return { kind: "committed", transactionId: "tx" };
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ uncertain: 1 });
    expect(run.store.docs.get(run.enrolled[0]._id)?.state).toBe("pending");
    run.settings.mutation = undefined;
    let completedLate = false;
    run.settings.beforeMutation = (mutations) => {
      const state = (mutations[0]?.patch as { set?: { state?: string } })?.set?.state;
      if (state === "enrolled" && !completedLate) { completedLate = true; run.store.commit(delayed!); }
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1, attempts: 0 });
    expect(run.store.docs.has("delivery")).toBe(false);
    expect(run.writes.filter(deletesGallery)).toHaveLength(1);
  });
  it("duplicate concurrent cron invocations cannot delete twice", async () => {
    const run = await setup();
    const results = await Promise.all([runClientGalleryCleanup(run.dependencies), runClientGalleryCleanup(run.dependencies)]);
    expect(results.reduce((sum, counts) => sum + counts.completed, 0)).toBe(1);
    expect(run.store.docs.has(image)).toBe(false);
  });
  it.each(["conflict", "refused", "uncertain", "throws"] as const)("reports an unconfirmed cursor write (%s) without hiding completed work", async (kind) => {
    const run = await setup();
    run.settings.mutation = async (mutations) => {
      const row = mutations[0];
      const target = (row.create as { _id?: string } | undefined)?._id ?? (row.patch as { id?: string } | undefined)?.id;
      if (target === CLEANUP_CURSOR_ID) {
        if (kind === "throws") throw new Error("provider-sensitive-canary");
        return { kind };
      }
      run.store.commit(mutations); return { kind: "committed", transactionId: "tx" };
    };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ completed: 1, cursorWritten: false });
    expect(run.store.docs.has(CLEANUP_CURSOR_ID)).toBe(false);
    expect(run.store.docs.has("delivery")).toBe(false);
  });
  it("advances past poisoned controls, bounds work, and wraps beyond a deleted cursor ID", async () => {
    const controls = await Promise.all(Array.from({ length: 52 }, (_, index) => control(`delivery-${index}`)));
    const future = controls.map((entry) => ({ ...entry, policy: { ...entry.policy, expiryInstant: "2027-01-01T00:00:00.000Z" } }));
    const run = await setup([], future);
    const ordered = [...future].sort((a, b) => a._id.localeCompare(b._id));
    run.settings.beforeRead = (ids) => { if (ids.includes(ordered[2]._id)) throw new Error("unexpected-private-canary"); };
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ examined: 50, blocked: 1, completedPass: false });
    expect(run.store.docs.get(CLEANUP_CURSOR_ID)?.after).toBe(ordered[49]._id);
    run.store.docs.delete(ordered[49]._id);
    run.setClock(0);
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ examined: 50 });
  });
  it.each(["clientGalleryCleanup.bad-", "wrong-type-id-"])("a malformed control at the cursor cannot poison the next run: %s", async (prefix) => {
    const malformed = Array.from({ length: 51 }, (_, index) => ({ _id: `${prefix}${String(index).padStart(3, "0")}`, _type: "clientGalleryCleanup", galleryId: "delivery" }));
    const run = await setup(malformed, []);
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ examined: 50, blocked: 50, completedPass: false });
    expect(run.store.docs.get(CLEANUP_CURSOR_ID)?.after).toBe(`${prefix}049`);
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ examined: 50, blocked: 50 });
    expect(run.store.docs.has(image)).toBe(true);
  });
  it("does not start new work after the start budget or without claim reserve", async () => {
    const run = await setup();
    const dependencies = { ...run.dependencies, remainingMs: () => 34_999 };
    expect(await runClientGalleryCleanup(dependencies)).toMatchObject({ examined: 0, attempts: 0 });
    expect(run.writes.filter(deletesGallery)).toHaveLength(0);
  });
  it("does not cross the exclusive expiry boundary early or enroll proof/legacy/ZIP content", async () => {
    const initial = await control();
    const futureControl = { ...initial, policy: { ...initial.policy, expiryInstant: "2026-10-24T10:00:00.001Z" } };
    const future = await setup([], [futureControl]);
    expect(await runClientGalleryCleanup(future.dependencies)).toMatchObject({ skipped: 1, attempts: 0 });
    for (const patch of [{ _type: "clientProofGallery" }, { _type: "legacyDeliveryGallery" }, { deliveryZip: { _type: "file", asset: ref(`file-${"d".repeat(40)}-zip`) } }]) {
      const run = await setup();
      run.store.put({ ...run.store.docs.get("delivery")!, ...patch });
      expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ blocked: 1, attempts: 0 });
      expect(run.store.docs.has(image)).toBe(true);
    }
  });
  it("caps destructive attempts at five and retains assets shared with an unprocessed gallery", async () => {
    const controls = await Promise.all(Array.from({ length: 6 }, (_, index) => control(`batch-${index}`)));
    const run = await setup(controls.map((entry) => gallery(entry.galleryId)), controls);
    expect(await runClientGalleryCleanup(run.dependencies)).toMatchObject({ attempts: 5, completed: 5, completedPass: false });
    expect(controls.filter((entry) => run.store.docs.has(entry.galleryId))).toHaveLength(1);
    expect(run.store.docs.has(image)).toBe(true);
  });
});

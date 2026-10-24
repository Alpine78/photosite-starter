import "server-only";
import { randomUUID } from "node:crypto";
import type { ClientGalleryCleanupConfig } from "@/lib/client-gallery-cleanup-config";
import { CLEANUP_HARD_DEADLINE_MS, CleanupRunError, runClientGalleryCleanup, type CleanupRunCounts } from "@/lib/client-gallery-cleanup-runner";
import { createClientGalleryCleanupTransport, CleanupTransportError } from "@/lib/client-gallery-cleanup-transport";

type Enabled = Extract<ClientGalleryCleanupConfig, { state: "enabled" }>;
export async function runConfiguredClientGalleryCleanup(config: Enabled): Promise<CleanupRunCounts> {
  const controller = new AbortController(), started = performance.now();
  const timer = setTimeout(() => controller.abort(), CLEANUP_HARD_DEADLINE_MS);
  const correlationId = randomUUID();
  try {
    const transport = createClientGalleryCleanupTransport({ ...config.sanity, token: config.token }, { limits: {
      maxSnapshotBytes: config.limits.maxExportBytes, maxDocuments: config.limits.maxDocuments, exportTimeoutMs: config.limits.exportTimeoutMs,
    } });
    // An eventually consistent query can defer work; it can never authorize it.
    if (!await transport.due(new Date().toISOString(), controller.signal)) {
      const counts: CleanupRunCounts = { examined: 0, attempts: 0, completed: 0, skipped: 0, blocked: 0, conflict: 0, refused: 0, uncertain: 0, deletedAssets: 0, sharedAssets: 0, completedPass: false, cursorWritten: false };
      console.info(JSON.stringify({ event: "client_gallery_cleanup", correlationId, status: "idle", ...counts }));
      return counts;
    }
    const snapshot = await transport.snapshot(controller.signal);
    const counts = await runClientGalleryCleanup({ snapshot,
      read: (ids, options) => transport.read(ids, { ...options, signal: controller.signal }),
      mutate: (mutations) => transport.mutate(mutations, controller.signal),
      // A local clock slightly ahead of the provider must never cause early expiry.
      now: Date.now, expiryNow: () => Math.min(Date.now(), snapshot.providerTime), clock: () => performance.now(), operationId: randomUUID,
      remainingMs: () => Math.max(0, CLEANUP_HARD_DEADLINE_MS - (performance.now() - started)),
    });
    console.info(JSON.stringify({ event: "client_gallery_cleanup", correlationId, status: "finished", ...counts }));
    return counts;
  } catch (error) {
    const code = error instanceof CleanupTransportError ? error.code : error instanceof CleanupRunError ? error.reason : "internal_error";
    console.error(JSON.stringify({ event: "client_gallery_cleanup", correlationId, status: "failed", code }));
    throw new Error("Client gallery cleanup failed");
  } finally { clearTimeout(timer); controller.abort(); }
}

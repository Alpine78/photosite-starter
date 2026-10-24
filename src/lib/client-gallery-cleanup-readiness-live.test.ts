/** Explicit owner-run only; excluded from default tests and CI. See cleanup runbook. */
import { test } from "vitest";
import { readPrivateBytes } from "../../scripts/private-operation-files.mts";
import {
  CLEANUP_READINESS_MANIFEST_BYTES, CleanupReadinessError, cleanupReadinessError,
  cleanupReadinessSettings, parseCleanupReadinessManifest, createCleanupReadinessReader, verifyCleanupReadiness,
} from "./client-gallery-cleanup-readiness";

test("owner-authorized cleanup read evidence (never enables deletion)", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const { filename, token } = cleanupReadinessSettings(process.env);
    let bytes: Uint8Array;
    try { bytes = await readPrivateBytes(filename, CLEANUP_READINESS_MANIFEST_BYTES); }
    catch { throw new CleanupReadinessError("manifest_unreadable"); }
    const config = parseCleanupReadinessManifest(bytes, token);
    const report = await verifyCleanupReadiness(config, createCleanupReadinessReader(config), { signal: controller.signal });
    console.log(JSON.stringify(report));
  } catch (error) { throw cleanupReadinessError(error); }
  finally { clearTimeout(timer); }
});

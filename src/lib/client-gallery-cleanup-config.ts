import "server-only";
import { readClientGalleryDeployment } from "@/lib/client-gallery-deployment";
import { readDeploymentStage } from "@/lib/deployment-stage";
import { loadSanityConfig, type SanityConfig } from "@/lib/sanity-config";

export type CleanupLimits = Readonly<{ maxExportBytes: number; maxDocuments: number; exportTimeoutMs: number }>;
export type ClientGalleryCleanupConfig =
  | Readonly<{ state: "disabled" | "misconfigured" }>
  | Readonly<{ state: "enabled"; sanity: SanityConfig; token: string; cronSecret: string; limits: CleanupLimits }>;

function bounded(environment: Readonly<Record<string, string | undefined>>, name: string, fallback: number, min: number, max: number): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw)) throw new Error("Invalid cleanup limit");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid cleanup limit");
  return value;
}

/** Merely adding the cron never enables deletion. Preview cannot opt in. */
export function readClientGalleryCleanupConfig(environment: Readonly<Record<string, string | undefined>>, now = new Date()): ClientGalleryCleanupConfig {
  const flag = environment.CLIENT_GALLERY_CLEANUP?.trim();
  if (!flag || flag === "off") return { state: "disabled" };
  if (flag !== "enabled") return { state: "misconfigured" };
  try {
    if (readClientGalleryDeployment(environment) !== "sanity" || readDeploymentStage(environment) !== "production" ||
      (environment.VERCEL_ENV && environment.VERCEL_ENV !== "production")) throw new Error("Invalid cleanup deployment");
    const token = environment.SANITY_CLIENT_GALLERY_CLEANUP_TOKEN?.trim() ?? "";
    const cronSecret = environment.CRON_SECRET?.trim() ?? "";
    if (!token || /\s/u.test(token) || cronSecret.length < 16 || /[\r\n]/u.test(cronSecret) ||
      environment.NEXT_PUBLIC_SANITY_CLIENT_GALLERY_CLEANUP_TOKEN?.trim() || environment.NEXT_PUBLIC_CRON_SECRET?.trim()) throw new Error("Invalid cleanup credential");
    const sanity = loadSanityConfig(environment, { now });
    if (sanity.apiVersion < "v2025-02-19") throw new Error("All-version reads require a newer pinned API");
    return { state: "enabled", sanity, token, cronSecret, limits: {
      maxExportBytes: bounded(environment, "CLIENT_GALLERY_CLEANUP_MAX_EXPORT_BYTES", 64 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024),
      maxDocuments: bounded(environment, "CLIENT_GALLERY_CLEANUP_MAX_DOCUMENTS", 100_000, 100, 200_000),
      exportTimeoutMs: bounded(environment, "CLIENT_GALLERY_CLEANUP_EXPORT_TIMEOUT_MS", 30_000, 5_000, 60_000),
    } };
  } catch { return { state: "misconfigured" }; }
}

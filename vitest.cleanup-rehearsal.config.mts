import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Explicit owner-run discovery only; never load local .env files or run in parallel. */
export default defineConfig({ envDir: false, resolve: { tsconfigPaths: true, alias: {
  "server-only": fileURLToPath(new URL("./test-support/server-only.ts", import.meta.url)),
} }, test: { environment: "node", include: ["scripts/client-gallery-cleanup-rehearsal.live.test.mts"],
  // Nine sequential real-provider scenarios share the IO port's ten-minute hard budget.
  testTimeout: 660_000, fileParallelism: false, retry: 0 } });

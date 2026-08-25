import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * AB#84's live Sanity integration suite, kept out of `vitest.config.mts`'s
 * default include so `npm test` never reaches the network. Run explicitly:
 * `npm run verify:sanity-live`. See the suite's own module comment
 * (src/lib/sanity-live-verification.test.ts) and docs/sanity-seeding.md's
 * "Production handoff" section.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./test-support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/lib/sanity-live-verification.test.ts"],
    // The full archive-gallery walk alone issues ~34 sequential live HTTP
    // requests (17 pages × 2 round trips each, per readSanityCuratedGalleryPage's
    // own module comment) and already runs a few seconds under normal
    // network conditions. Vitest's 5s default per-test timeout leaves too
    // little margin against ordinary latency variance for a suite whose
    // whole point is reaching a real, uncached Content Lake; each individual
    // request already has its own 10s bound (SANITY_QUERY_TIMEOUT_MS).
    testTimeout: 60_000,
  },
});

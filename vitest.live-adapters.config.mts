import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * AB#137's content-agnostic adapter smoke verification, kept out of
 * `vitest.config.mts`'s default include so `npm test` never reaches the
 * network — the same isolation `vitest.live.config.mts` already gives its
 * own (fixture-specific) sibling suite. Run explicitly:
 * `npm run verify:sanity-adapters`. See the suite's own module comment
 * (src/lib/sanity-adapter-smoke-verification.test.ts) and
 * docs/sanity-seeding.md's "Adapter smoke verification (AB#137)" section.
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
    include: ["src/lib/sanity-adapter-smoke-verification.test.ts"],
    // Walks a real gallery's cursor chain to completion per configured
    // locale — see vitest.live.config.mts's own comment on why the 5s
    // Vitest default is too tight for a suite whose whole point is
    // reaching a real, uncached Content Lake.
    testTimeout: 60_000,
  },
});

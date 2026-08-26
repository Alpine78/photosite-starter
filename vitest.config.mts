import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Server-only modules carry the `server-only` marker, which throws on
      // import outside a React Server Component build. See the stub for why
      // standing it in costs the suite nothing.
      "server-only": fileURLToPath(
        new URL("./test-support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Application and domain tests live beside the code in src. The
    // deployment scripts and the Studio schemas are not part of the
    // application bundle, so they sit outside it and bring their own tests
    // with them.
    include: [
      "src/**/*.test.ts",
      "sanity/**/*.test.ts",
      "scripts/**/*.test.mts",
    ],
    // AB#84's live integration suite, and AB#137's content-agnostic adapter
    // smoke suite, each reach a real Sanity Content Lake over the network —
    // every other test here is required not to. They run only through their
    // own dedicated `vitest.live*.config.mts` and `npm run verify:sanity-*`
    // scripts, never as part of this default suite.
    exclude: [
      ...configDefaults.exclude,
      "src/lib/sanity-live-verification.test.ts",
      "src/lib/sanity-adapter-smoke-verification.test.ts",
    ],
  },
});

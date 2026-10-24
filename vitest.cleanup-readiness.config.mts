import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Separate owner-run discovery; never inherits the default suite's excludes. */
export default defineConfig({
  // Vite otherwise reads local env files before Vitest constructs worker env.
  envDir: false,
  resolve: { tsconfigPaths: true, alias: {
    "server-only": fileURLToPath(new URL("./test-support/server-only.ts", import.meta.url)),
  } },
  test: {
    environment: "node",
    include: ["src/lib/client-gallery-cleanup-readiness-live.test.ts"],
    // Real export + strict Doc read have a shared 75-second abort budget.
    testTimeout: 90_000,
  },
});

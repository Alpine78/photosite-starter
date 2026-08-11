import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    // deployment scripts are not part of the application bundle, so they
    // sit outside it and bring their own tests with them.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mts"],
  },
});

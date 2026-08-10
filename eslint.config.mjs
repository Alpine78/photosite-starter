import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts. Both are gitignored, so CI never sees them, but a
    // failing local run leaves a bundled trace viewer behind and the next
    // `npm run lint` reports thousands of problems in minified vendor code.
    "playwright-report/**",
    "test-results/**",
  ]),
  // The CMS boundary, enforced rather than documented (AB#39, ADR-0006).
  // Sanity's HTTP surface and its read token live in two modules; adapters in
  // src/lib compose queries and project results into the project's own types.
  // A route or component that reached past them would put provider knowledge —
  // and eventually a credential — into the render tree, and replacing the CMS
  // would stop being a change to src/lib.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/sanity-client", "@/lib/sanity-config"],
              message:
                "Read content through an adapter in src/lib instead. Sanity clients, queries, and credentials stay behind that boundary (ADR-0006).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

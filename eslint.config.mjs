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
  //
  // The gallery cursor signing key is kept out of the same places for the same
  // reason (AB#72): a route transports an opaque token and never mints or
  // inspects one, so only the adapter behind `@/lib/gallery` holds the key.
  //
  // The private client-gallery boundary (AB#29, ADR-0014 §2) is the same shape:
  // the request-time credential loader and the private domain model stay behind
  // a server adapter, so a route or component cannot put the private store's
  // shape — or its credentials — into the render tree. Like the rules above it
  // matches `@/lib/...` alias imports only, not a relative path or an indirect
  // re-export; `import "server-only"` covers the indirect case.
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
            {
              group: ["@/lib/gallery-cursor"],
              message:
                "Read a gallery page through `@/lib/gallery` instead. The cursor signing key stays behind that adapter; a route only transports the opaque token (ADR-0003 decision 8).",
            },
            {
              group: [
                "@/lib/private-gallery",
                "@/lib/private-gallery-config",
                "@/lib/private-gallery-capability",
                "@/lib/private-gallery-session",
                "@/lib/private-gallery-exchange",
              ],
              message:
                "Reach private client galleries through `@/lib/private-gallery-access`. The private-store credentials, domain model, capability crypto, session model, and exchange stay behind that facade, which owns the ordering a route must not reassemble — including the capability comparison (ADR-0014 §2, §3).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

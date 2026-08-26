import { defineConfig, devices } from "@playwright/test";
import {
  appUnderTestEnvironment,
  HARNESS_BASE_URL,
  HARNESS_HOSTNAME,
  HARNESS_PORT,
} from "./e2e/support/harness-environment";

/**
 * Public-journey test harness.
 *
 * These tests run against a **production build**, never the dev server: static
 * generation, image optimization, and metadata composition all behave
 * differently there, and those differences are exactly what a public journey
 * has to survive. `webServer` therefore builds and then serves, with the
 * harness's own environment (see `e2e/support/harness-environment.ts`) applied
 * to both halves.
 *
 * Browser-free domain, adapter, and validation tests belong in Vitest
 * (`src/**\/*.test.ts`). This layer is for what only a browser can prove.
 *
 * Every knob below is set explicitly. A hidden default that differs between a
 * laptop and a pipeline agent turns a red build into an argument about the
 * environment instead of about the change.
 */

/** Azure Pipelines sets TF_BUILD; CI is the cross-provider convention. */
const isContinuousIntegration = Boolean(process.env.CI || process.env.TF_BUILD);

/**
 * A handful of spec files (`services.spec.ts`, `sitemap-robots.spec.ts`) call
 * a `src/lib` seam function (`getServices`) directly, in the test runner's
 * own process, to derive the fixture data a journey asserts against — not
 * through a request to the running app. `getServices` reads
 * `getDeploymentConfig()`, so this process needs the same settings the
 * harness gives the app under test, or that direct call fails before any
 * assertion runs. Applying the harness environment here, not only to
 * `webServer.env` below, is what keeps a spec's own "expected" data and the
 * app's actual rendered output reading from one identical configuration.
 */
Object.assign(process.env, appUnderTestEnvironment);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",

  // Tests share no state, so they may run in any order and in parallel.
  fullyParallel: true,
  // Two cores on a hosted agent, and the server under test shares them; four
  // locally, where the machine is bigger and iteration speed is the point.
  workers: isContinuousIntegration ? 2 : 4,
  // One retry in CI surfaces flake as a "flaky" result instead of a red build,
  // while still reporting it. Locally a failure should just fail, immediately.
  retries: isContinuousIntegration ? 1 : 0,
  // A `test.only` left in a commit would silently shrink the gate.
  forbidOnly: isContinuousIntegration,
  // Bounds a hung pipeline job. Unset locally, where a debugging session is
  // allowed to take as long as it takes.
  globalTimeout: isContinuousIntegration ? 15 * 60 * 1000 : undefined,

  // A hosted agent is slower than a laptop, and the first request to a freshly
  // started server pays for whatever it has not warmed up yet.
  timeout: isContinuousIntegration ? 60_000 : 30_000,
  expect: { timeout: 5_000 },

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    // Consumed by the pipeline's PublishTestResults task.
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],

  use: {
    baseURL: HARNESS_BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // Failure diagnostics: the trace already carries the DOM snapshots,
    // console output, and network log, so no video is recorded on top of it.
    // Everything they capture is the project's own mock content served by a
    // harness environment that holds no credentials.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  // Two engines, two viewport classes, two browser downloads. Blink and WebKit
  // are what a photography site's visitors actually run, and WebKit is the only
  // engine on iOS; the mobile project also exercises the compact header, which
  // is a different navigation path rather than the same one made narrower.
  // Firefox is left out deliberately: it shares no rendering behaviour that the
  // other two would miss here, and it would cost install time on every run.
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 15"] },
    },
  ],

  webServer: {
    // Build first, then serve: `next start` refuses to run without a build, so
    // the suite can never silently test a stale one.
    command: `npm run build && npm run start -- --hostname ${HARNESS_HOSTNAME} --port ${HARNESS_PORT}`,
    url: HARNESS_BASE_URL,
    env: appUnderTestEnvironment,
    // Covers a cold build on a hosted agent, not just an incremental one. The
    // build fetches the Geist fonts through next/font before self-hosting them,
    // so it is network-dependent and occasionally slow.
    timeout: 360_000,
    // Never adopt whatever happens to hold the port: a reused server would skip
    // the build and could be running different settings, or a dev server.
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    // Build and server output belong in the run log, where a failed pipeline
    // job keeps it.
    stdout: "pipe",
    stderr: "pipe",
  },
});

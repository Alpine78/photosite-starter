import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

/** Owner-operated, separate browser profile; never exported to CI artifacts. */
const address = process.argv[2];
if (!address || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/open-studio-test-browser.mts <Studio URL>");
}
const url = new URL(address);
if (url.username || url.password || url.hash ||
  (url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
  throw new Error("Use an HTTPS Studio or a local HTTP Studio, without credentials or fragments.");
}
process.umask(0o077);
const profile = resolve("temp/studio-browser/profile");
await mkdir(profile, { recursive: true, mode: 0o700 });
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222"],
});
const close = () => { void context.close(); };
process.once("SIGINT", close);
process.once("SIGTERM", close);
try {
  await (context.pages()[0] ?? await context.newPage()).goto(url.href);
  console.log("Test browser opened. Sign in yourself; close its window when finished.");
  await new Promise<void>((done) => context.once("close", done));
} finally {
  process.removeListener("SIGINT", close);
  process.removeListener("SIGTERM", close);
  await context.close();
}

import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * Per-request script nonce on public HTML (ADR-0011 amendment 2026-10-22,
 * AB#390). The fixture-level guard fails any journey whose page reports a CSP
 * violation; this spec proves the policy itself on every public page family:
 * a nonce in `script-src` with no `'unsafe-inline'`, the same nonce on every
 * executable script in the HTML, and a fresh nonce for every response.
 */
const locale = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const tree = buildContentTree(mockContentTreeInputs[locale]);
function pathOf(id: string) {
  const path = getCanonicalContentPath(tree, id);
  if (!path) throw new Error("[e2e] The CSP journey needs a canonical fixture route.");
  return `/${DEFAULT_STORY_NAMESPACE}/${path.join("/")}`;
}

const PAGES: ReadonlyArray<readonly [string, string, number]> = [
  ["home", "/", 200],
  ["prefixed-locale home", "/fi", 200],
  ["story listing", `/${DEFAULT_STORY_NAMESPACE}`, 200],
  ["article", pathOf("content-choosing-a-telephoto-lens"), 200],
  ["gallery", pathOf("content-polar-night-sessions"), 200],
  ["services", "/services", 200],
  ["service detail", "/services/portrait-sessions", 200],
  ["contact", "/contact", 200],
  ["retained unlisted gallery", "/client-gallery/11111111111111111111111111111111", 200],
  ["unknown page", `/${DEFAULT_STORY_NAMESPACE}/no-such-page-for-csp`, 404],
  ["missing file-shaped path", "/gallery/missing-csp-check.1683eecb7e65.webp", 404],
];

function scriptSources(policy: string | undefined): string {
  return (policy ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src ")) ?? "";
}

/** Executable scripts only: a JSON-LD data block is never run, so CSP does not apply to it. */
function executableScriptNonces(html: string): (string | null)[] {
  return [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((match) => match[1])
    .filter((attributes) => !/\btype="application\/ld\+json"/.test(attributes))
    .map((attributes) => /\bnonce="([^"]*)"/.exec(attributes)?.[1] ?? null);
}

for (const [name, path, status] of PAGES) {
  test(`${name} renders under a per-request script nonce`, async ({ request, page }) => {
    const first = await request.get(path);
    expect(first.status()).toBe(status);
    const policy = first.headers()["content-security-policy"];
    const nonce = /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(scriptSources(policy))?.[1];
    expect(scriptSources(policy)).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    const html = await first.text();
    const nonces = executableScriptNonces(html);
    expect(nonces.length).toBeGreaterThan(0);
    expect(nonces.every((value) => value === nonce)).toBe(true);

    const second = await request.get(path);
    expect(scriptSources(second.headers()["content-security-policy"])).not.toBe(scriptSources(policy));

    // A real browser load: the fixture fails the test on any reported violation.
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  });
}

test("a page rendered for a form POST is tagged as well", async ({ request }) => {
  // Next.js renders the page for a plain form POST; it must not fall back to 'unsafe-inline'.
  const response = await request.post("/contact", { form: { csp: "check" } });
  expect(response.headers()["content-type"]).toContain("text/html");
  const policy = response.headers()["content-security-policy"];
  const nonce = /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(scriptSources(policy))?.[1];
  expect(scriptSources(policy)).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  expect(executableScriptNonces(await response.text()).every((value) => value === nonce)).toBe(true);
});

test("Next.js's prerendered 404 page keeps the static fallback and runs its scripts", async ({ request, page }) => {
  const response = await request.get("/404");
  expect(response.status()).toBe(404);
  expect(scriptSources(response.headers()["content-security-policy"])).toBe("script-src 'self' 'unsafe-inline'");
  // The fixture fails the test if the browser blocked any of its scripts.
  await page.goto("/404");
  await page.waitForLoadState("networkidle");
});

test("redirects, API responses and the inactive private namespace keep the static fallback", async ({ request }) => {
  const api = await request.get("/api/contact");
  expect(scriptSources(api.headers()["content-security-policy"])).toBe("script-src 'self' 'unsafe-inline'");
  const redirect = await request.get("/contact/", { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(scriptSources(redirect.headers()["content-security-policy"])).toBe("script-src 'self' 'unsafe-inline'");
});

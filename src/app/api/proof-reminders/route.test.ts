import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const run = vi.hoisted(() => ({ runConfiguredProofReminders: vi.fn() }));
vi.mock("@/lib/proof-reminder-access", () => run);
import { GET } from "./route";

const cron = "c".repeat(32);
const enabled = { PROOF_REMINDERS: "enabled", PROOF_SELECTION: "enabled", PROOF_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "public",
  SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production", SANITY_PROOF_SELECTION_TOKEN: "t".repeat(40),
  PROOF_SELECTION_KEY_SECRET: Buffer.alloc(32, 3).toString("base64url"), CRON_SECRET: cron };
const request = (authorization?: string) => new Request("https://site.example/api/proof-reminders", { headers: authorization ? { authorization } : {} });
beforeEach(() => { for (const [name, value] of Object.entries(enabled)) vi.stubEnv(name, value); run.runConfiguredProofReminders.mockReset().mockResolvedValue({ examined: 1, sent: 1 }); });
afterEach(() => vi.unstubAllEnvs());

describe("reminder cron route", () => {
  it("does not exist while off and is unavailable while incomplete, never running", async () => {
    vi.stubEnv("PROOF_REMINDERS", "");
    expect((await GET(request(`Bearer ${cron}`))).status).toBe(404);
    vi.stubEnv("PROOF_REMINDERS", "enabled");
    for (const [name, value] of [["CRON_SECRET", "short"], ["PROOF_SELECTION_KEY_SECRET", ""], ["PROOF_SELECTION", ""], ["NEXT_PUBLIC_CRON_SECRET", "x"]]) {
      vi.stubEnv(name, value);
      expect((await GET(request(`Bearer ${cron}`))).status, name).toBe(503);
      vi.stubEnv(name, (enabled as Record<string, string>)[name] ?? "");
    }
    expect(run.runConfiguredProofReminders).not.toHaveBeenCalled();
  });

  it("accepts only the exact platform bearer token", async () => {
    for (const header of [undefined, cron, `Bearer ${cron}x`, `Bearer ${"d".repeat(32)}`, `bearer ${cron}`]) {
      expect((await GET(request(header))).status, String(header)).toBe(401);
    }
    expect(run.runConfiguredProofReminders).not.toHaveBeenCalled();
    const response = await GET(request(`Bearer ${cron}`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", examined: 1, sent: 1 });
  });

  it("answers a failed run without detail", async () => {
    run.runConfiguredProofReminders.mockRejectedValue(new Error("c@example.fi"));
    const response = await GET(request(`Bearer ${cron}`));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("@");
  });
});

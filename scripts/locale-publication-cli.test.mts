import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { planLocaleAdditions } from "./locale-publication-plan.mts";
const category = { _id: "category", _rev: "r", _type: "category", categoryId: "blog", label: [], slug: [] };
const packet = { category: { sourceDocument: category, englishAdditions: { label: { _key: "en", _type: "localizedText", language: "en", value: "Blog" }, slug: { _key: "en", _type: "localizedSlug", language: "en", value: "blog" }, description: { _key: "en", _type: "categoryDescription", language: "en", blocks: [{ _key: "p", _type: "categoryDescriptionParagraph", spans: [{ _key: "s", _type: "categoryDescriptionInlineSpan", text: "Reviewed." }] }] } } }, services: [] };
describe("owner publication CLI refusal before HTTP", () => {
  for (const problem of ["changed-mutation", "wrong-recovery", "wrong-approval"] as const) it(`refuses ${problem} without creating output or leaking credentials`, async () => {
    const folder = await mkdtemp(join(tmpdir(), "locale-publication-"));
    try {
      const snapshot = Buffer.from(JSON.stringify(category) + "\n");
      const plan = planLocaleAdditions(snapshot, packet, { projectId: "fixture", dataset: "production", apiVersion: "v2026-03-01" });
      const recovery = { snapshotSha256: plan.snapshotSha256, documentCount: 1, assetCount: 0, assets: [], localBytesRecoveredAndReadBack: true };
      if (problem === "changed-mutation") plan.transactions[0].mutations.push({ delete: { id: "unapproved" } });
      if (problem === "wrong-recovery") recovery.snapshotSha256 = "0".repeat(64);
      for (const [name, bytes] of Object.entries({ "snapshot.ndjson": snapshot, "packet.json": JSON.stringify(packet), "plan.json": JSON.stringify(plan), "recovery.json": JSON.stringify(recovery) })) await writeFile(join(folder, name), bytes, { mode: 0o600 });
      const result = spawnSync(process.execPath, [join(import.meta.dirname, "write-locale-publication.mts"), "--plan", join(folder, "plan.json"), "--kind", "category-services", "--snapshot", join(folder, "snapshot.ndjson"), "--review-packet", join(folder, "packet.json"), "--recovery-receipt", join(folder, "recovery.json"), "--out", join(folder, "output"), "--apply", "--approved-digest", "0".repeat(64)], { encoding: "utf8", timeout: 10_000, env: { ...process.env, SANITY_LOCALIZATION_TOKEN: "synthetic-private-token" } });
      expect(result.status).toBe(1); expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Publication stopped"); expect(result.stderr).not.toContain("synthetic-private-token");
      await expect(access(join(folder, "output"))).rejects.toThrow();
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});

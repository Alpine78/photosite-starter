/**
 * The CLI is thin orchestration; what is worth testing here is its one input
 * contract — the source export — because a malformed line must be reported
 * rather than silently skipped, which would shorten a migration without anyone
 * noticing. The conversion, approval, and planning logic has its own suites.
 *
 * Importing this module runs no command: `main()` is invoked at the bottom of
 * the CLI only under Node, and this suite imports the parser alone.
 */

import { describe, expect, it } from "vitest";

import { mkdtemp, rm, writeFile as writeFileNode, readFile as readFileNode, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const run = promisify(execFile);

import {
  parseSourceArticles,
  sourceRecordDigest,
  verifyApprovedGalleryFiles,
} from "./convert-joomla-content.mts";

describe("verifyApprovedGalleryFiles (round-4 review finding: content, not just count)", () => {
  async function withTempGallery<T>(
    files: Readonly<Record<string, string>>,
    run: (imageRoot: string) => Promise<T>,
  ): Promise<T> {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-gallery-"));
    try {
      await Promise.all(
        Object.entries(files).map(([name, content]) => writeFileNode(path.join(root, name), content)),
      );
      return await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  function sha256Of(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  it("accepts a gallery whose files exactly match the approved names and content", async () => {
    await withTempGallery({ "a.jpg": "AAA", "b.jpg": "BBB" }, async (root) => {
      const locators = await verifyApprovedGalleryFiles(root, ".", [
        { filename: "a.jpg", sha256: sha256Of("AAA") },
        { filename: "b.jpg", sha256: sha256Of("BBB") },
      ]);
      expect(locators).toEqual([path.posix.join(".", "a.jpg"), path.posix.join(".", "b.jpg")]);
    });
  });

  it("refuses a same-name file whose content was substituted — the count alone would have passed", async () => {
    await withTempGallery({ "a.jpg": "SUBSTITUTED", "b.jpg": "BBB" }, async (root) => {
      const locators = await verifyApprovedGalleryFiles(root, ".", [
        { filename: "a.jpg", sha256: sha256Of("AAA") },
        { filename: "b.jpg", sha256: sha256Of("BBB") },
      ]);
      expect(locators).toBeUndefined();
    });
  });

  it("refuses a directory with an extra file even if every approved file matches", async () => {
    await withTempGallery({ "a.jpg": "AAA", "unapproved.jpg": "X" }, async (root) => {
      const locators = await verifyApprovedGalleryFiles(root, ".", [
        { filename: "a.jpg", sha256: sha256Of("AAA") },
      ]);
      expect(locators).toBeUndefined();
    });
  });

  it("refuses a missing approved file", async () => {
    await withTempGallery({ "a.jpg": "AAA" }, async (root) => {
      const locators = await verifyApprovedGalleryFiles(root, ".", [
        { filename: "a.jpg", sha256: sha256Of("AAA") },
        { filename: "missing.jpg", sha256: sha256Of("X") },
      ]);
      expect(locators).toBeUndefined();
    });
  });

  it("preserves the approved order, not the directory listing order", async () => {
    await withTempGallery({ "a.jpg": "AAA", "b.jpg": "BBB" }, async (root) => {
      const locators = await verifyApprovedGalleryFiles(root, ".", [
        { filename: "b.jpg", sha256: sha256Of("BBB") },
        { filename: "a.jpg", sha256: sha256Of("AAA") },
      ]);
      expect(locators?.map((locator) => path.basename(locator))).toEqual(["b.jpg", "a.jpg"]);
    });
  });
});

describe("CLI end-to-end: round-5 finding — a shared gallery gets each article's own language of alt text", () => {
  it("attributes fi and en alt text separately for an fi/en pair sharing one gallery folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-lang-"));
    try {
      const imageRoot = path.join(root, "images");
      const galleryDir = path.join(imageRoot, "stories", "shared");
      await writeFileNode(path.join(imageRoot, ".keep"), "", { flag: "w" }).catch(() => undefined);
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "AAA");
      await writeFileNode(path.join(galleryDir, "b.jpg"), "BBB");
      const sha = (content: string) => createHash("sha256").update(content).digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        [
          JSON.stringify({ joomlaId: "372", language: "fi-FI", title: "Chamonix 2006", body: "{gallery}stories/shared{/gallery}" }),
          JSON.stringify({ joomlaId: "401", language: "en-GB", title: "Chamonix 2006", body: "{gallery}stories/shared{/gallery}" }),
        ].join("\n"),
      );

      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: {
            "stories/shared/a.jpg": { fi: "Vuori aamulla", en: "Mountain in the morning" },
            "stories/shared/b.jpg": { fi: "Laakso", en: "Valley" },
          },
          galleryFiles: {
            "stories/shared": [
              { filename: "a.jpg", sha256: sha("AAA") },
              { filename: "b.jpg", sha256: sha("BBB") },
            ],
          },
        }),
      );

      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", imageRoot,
        "--out", outDir,
      ]);

      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8")) as readonly {
        readonly language: string;
        readonly convertible: boolean;
        readonly blocks: readonly { readonly _type: string; readonly images?: readonly { readonly media: string }[] }[];
        readonly resolvedImageAltText: readonly { readonly mediaId: string; readonly language: string; readonly value: string }[];
      }[];
      const fi = findings.find((entry) => entry.language === "fi");
      const en = findings.find((entry) => entry.language === "en");
      expect(fi?.convertible).toBe(true);
      expect(en?.convertible).toBe(true);

      // Both articles reference the same two photographs (one shared gallery),
      // so their media ids must be identical …
      const fiMediaIds = fi?.blocks[0]?.images?.map((image) => image.media) ?? [];
      const enMediaIds = en?.blocks[0]?.images?.map((image) => image.media) ?? [];
      expect(fiMediaIds).toEqual(enMediaIds);
      expect(fiMediaIds).toHaveLength(2);

      // … but each article's own alt text must be in its *own* language, not
      // the other one's string relabelled — the actual round-5 defect.
      const fiAlt = fi?.resolvedImageAltText.map((entry) => entry.value).sort();
      const enAlt = en?.resolvedImageAltText.map((entry) => entry.value).sort();
      expect(fiAlt).toEqual(["Laakso", "Vuori aamulla"]);
      expect(enAlt).toEqual(["Mountain in the morning", "Valley"]);
      expect(fi?.resolvedImageAltText.every((entry) => entry.language === "fi")).toBe(true);
      expect(en?.resolvedImageAltText.every((entry) => entry.language === "en")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-6 finding — a loose image never falls back to raw Joomla alt text", () => {
  it("refuses an image whose language-specific alt text is missing, rather than trusting the source <img alt>", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-altfallback-"));
    try {
      const imageRoot = path.join(root, "images");
      await run("mkdir", ["-p", imageRoot]);
      await writeFileNode(path.join(imageRoot, "x.jpg"), "XXX");
      const sha256 = createHash("sha256").update("XXX").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({
          joomlaId: "1",
          language: "fi",
          title: "T",
          body: '<p><img src="images/x.jpg" alt="Raakateksti Joomlasta"></p>',
        }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          // The image is approved and verifies (real, correctly-hashed bytes) —
          // only its language-specific alt text is missing, which is the one
          // condition this test means to exercise.
          images: { "images/x.jpg": { locator: "x.jpg", sha256 } },
          altText: {}, // no fi entry for x.jpg at all
        }),
      );
      const outDir = path.join(root, "out");
      // Non-zero-exit-tolerant: a fully refused article is a normal --review
      // outcome, not a crash.
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", imageRoot,
        "--out", outDir,
      ]).catch(() => undefined);

      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8")) as readonly {
        readonly convertible: boolean;
        readonly blocks: readonly unknown[];
        readonly findings: readonly { readonly code: string }[];
      }[];
      expect(findings[0]?.convertible).toBe(false);
      expect(findings[0]?.findings.map((entry) => entry.code)).toContain("image-missing-alt");
      // The raw Joomla alt text must never reach the output.
      expect(JSON.stringify(findings)).not.toContain("Raakateksti Joomlasta");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-6 finding — findings.json reports the resolved digest an owner approves against", () => {
  it("prints resolvedDigest and it changes when resolution.json changes, source text unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-resolveddigest-"));
    try {
      const imageRoot = path.join(root, "images");
      await run("mkdir", ["-p", imageRoot]);
      await writeFileNode(path.join(imageRoot, "x.jpg"), "XXX");
      const sha256 = createHash("sha256").update("XXX").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: '<p><img src="images/x.jpg"></p>' }),
      );
      async function convertWith(alt: string): Promise<string> {
        const resolutionPath = path.join(root, "resolution.json");
        await writeFileNode(
          resolutionPath,
          JSON.stringify({
            images: { "images/x.jpg": { locator: "x.jpg", sha256 } },
            altText: { "x.jpg": { fi: alt } },
          }),
        );
        const outDir = path.join(root, `out-${alt}`);
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--image-root", imageRoot,
          "--out", outDir,
        ]);
        const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
        return findings[0].resolvedDigest;
      }

      const digestA = await convertWith("Alt A");
      const digestB = await convertWith("Alt B");
      expect(digestA).toMatch(/^[0-9a-f]{64}$/u);
      // Same source article both times — only resolution.json's alt text
      // differs — so only the resolved digest may differ; sourceDigest would
      // still be identical (proven in the unit suite).
      expect(digestA).not.toBe(digestB);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-7 finding — a substituted photograph invalidates a stale approval even when the identity, structure, and alt text all stay the same", () => {
  it("changes resolvedDigest when a gallery file's bytes and its recorded hash are swapped together", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-substitution-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );

      async function convertWithContent(content: string): Promise<string> {
        await writeFileNode(path.join(galleryDir, "a.jpg"), content);
        const sha256 = createHash("sha256").update(content).digest("hex");
        const resolutionPath = path.join(root, "resolution.json");
        await writeFileNode(
          resolutionPath,
          JSON.stringify({
            altText: { "stories/g/a.jpg": { fi: "Sama teksti" } },
            galleryFiles: { "stories/g": [{ filename: "a.jpg", sha256 }] },
          }),
        );
        const outDir = path.join(root, `out-${content}`);
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--image-root", path.join(root, "images"),
          "--out", outDir,
        ]);
        const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
        return findings[0].resolvedDigest;
      }

      // Same locator, same alt text, same declared filename — only the bytes
      // (and the hash recorded alongside them) differ. Before round 7,
      // nothing in the resolved digest would have moved.
      const digestOriginal = await convertWithContent("original photograph bytes");
      const digestSubstituted = await convertWithContent("different photograph bytes");
      expect(digestOriginal).not.toBe(digestSubstituted);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-7 finding — photograph identity survives a rename via content-hash correlation", () => {
  it("keeps the same mediaId across a locator change when the bytes are unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-rename-"));
    try {
      const imageRoot = path.join(root, "images");
      const originalDir = path.join(imageRoot, "stories", "old-name");
      await run("mkdir", ["-p", originalDir]);
      await writeFileNode(path.join(originalDir, "a.jpg"), "SAME BYTES");
      const sha256 = createHash("sha256").update("SAME BYTES").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/old-name{/gallery}" }),
      );
      const resolutionPath1 = path.join(root, "resolution1.json");
      await writeFileNode(
        resolutionPath1,
        JSON.stringify({
          altText: { "stories/old-name/a.jpg": { fi: "Teksti" } },
          galleryFiles: { "stories/old-name": [{ filename: "a.jpg", sha256 }] },
        }),
      );
      const outDir1 = path.join(root, "out1");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath1,
        "--image-root", imageRoot,
        "--out", outDir1,
      ]);
      const identitiesAfterFirstRun = JSON.parse(
        await readFileNode(path.join(outDir1, "photograph-identities.json"), "utf8"),
      );
      const originalMediaId = identitiesAfterFirstRun.byLocator["stories/old-name/a.jpg"];
      expect(originalMediaId).toBeDefined();

      // The file is renamed/moved in the source tree — same bytes, new path —
      // and the manifest's declared folder changes to match. The persisted
      // identities from the first run are passed back, as the runbook
      // documents, but note the *old* locator is not in `byLocator` for the
      // *new* path: only `byContentHash` can recognize this is the same photo.
      const renamedDir = path.join(imageRoot, "stories", "new-name");
      await run("mkdir", ["-p", renamedDir]);
      await writeFileNode(path.join(renamedDir, "a.jpg"), "SAME BYTES");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/new-name{/gallery}" }),
      );
      const resolutionPath2 = path.join(root, "resolution2.json");
      await writeFileNode(
        resolutionPath2,
        JSON.stringify({
          altText: { "stories/new-name/a.jpg": { fi: "Teksti" } },
          galleryFiles: { "stories/new-name": [{ filename: "a.jpg", sha256 }] },
          photographIdentities: identitiesAfterFirstRun,
        }),
      );
      const outDir2 = path.join(root, "out2");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath2,
        "--image-root", imageRoot,
        "--out", outDir2,
      ]);
      const findings2 = JSON.parse(await readFileNode(path.join(outDir2, "findings.json"), "utf8"));
      const renamedMediaId = findings2[0].resolvedImageAltText[0]?.mediaId;
      expect(renamedMediaId).toBe(originalMediaId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("still mints a fresh identity when neither the locator nor the content hash is known", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-newphoto-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "genuinely new photograph");
      const sha256 = createHash("sha256").update("genuinely new photograph").digest("hex");
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/g/a.jpg": { fi: "Teksti" } },
          galleryFiles: { "stories/g": [{ filename: "a.jpg", sha256 }] },
          photographIdentities: { byLocator: { "stories/other/unrelated.jpg": "photo-unrelated" }, byContentHash: {} },
        }),
      );
      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", path.join(root, "images"),
        "--out", outDir,
      ]);
      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
      expect(findings[0].resolvedImageAltText[0]?.mediaId).not.toBe("photo-unrelated");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-8 finding — two locators sharing one identity with different bytes is refused, not resolved by traversal order", () => {
  it("fails the whole run rather than silently picking whichever locator was processed last", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-identity-conflict-"));
    try {
      const dirA = path.join(root, "images", "stories", "a");
      const dirB = path.join(root, "images", "stories", "b");
      await run("mkdir", ["-p", dirA]);
      await run("mkdir", ["-p", dirB]);
      await writeFileNode(path.join(dirA, "x.jpg"), "photo A bytes");
      await writeFileNode(path.join(dirB, "y.jpg"), "photo B different bytes");
      const shaA = createHash("sha256").update("photo A bytes").digest("hex");
      const shaB = createHash("sha256").update("photo B different bytes").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        [
          JSON.stringify({ joomlaId: "1", language: "fi", title: "T1", body: "{gallery}stories/a{/gallery}" }),
          JSON.stringify({ joomlaId: "2", language: "fi", title: "T2", body: "{gallery}stories/b{/gallery}" }),
        ].join("\n"),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/a/x.jpg": { fi: "Teksti A" }, "stories/b/y.jpg": { fi: "Teksti B" } },
          galleryFiles: {
            "stories/a": [{ filename: "x.jpg", sha256: shaA }],
            "stories/b": [{ filename: "y.jpg", sha256: shaB }],
          },
          // The owner's own persisted map claims these two, genuinely
          // different, files are "the same photograph" — an ambiguity this
          // run cannot resolve on its own.
          photographIdentities: {
            byLocator: { "stories/a/x.jpg": "photo-shared", "stories/b/y.jpg": "photo-shared" },
            byContentHash: {},
          },
        }),
      );
      const outDir = path.join(root, "out");
      let failed = false;
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--image-root", path.join(root, "images"),
          "--out", outDir,
        ]);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      // Nothing — including a `photograph-identities.json` that would bake in
      // the ambiguous, order-dependent choice — is written.
      await expect(readFileNode(path.join(outDir, "findings.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not flag the legitimate case: the same bytes genuinely shared across two locators", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-identity-legit-"));
    try {
      const dirA = path.join(root, "images", "stories", "a");
      const dirB = path.join(root, "images", "stories", "b");
      await run("mkdir", ["-p", dirA]);
      await run("mkdir", ["-p", dirB]);
      await writeFileNode(path.join(dirA, "x.jpg"), "identical bytes");
      await writeFileNode(path.join(dirB, "y.jpg"), "identical bytes");
      const sha256 = createHash("sha256").update("identical bytes").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        [
          JSON.stringify({ joomlaId: "1", language: "fi", title: "T1", body: "{gallery}stories/a{/gallery}" }),
          JSON.stringify({ joomlaId: "2", language: "fi", title: "T2", body: "{gallery}stories/b{/gallery}" }),
        ].join("\n"),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/a/x.jpg": { fi: "Teksti" }, "stories/b/y.jpg": { fi: "Teksti" } },
          galleryFiles: {
            "stories/a": [{ filename: "x.jpg", sha256 }],
            "stories/b": [{ filename: "y.jpg", sha256 }],
          },
        }),
      );
      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", path.join(root, "images"),
        "--out", outDir,
      ]);
      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
      expect(findings[0].convertible).toBe(true);
      expect(findings[1].convertible).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-12 finding — an approved row missing from the source export goes into a private report file, never to the console", () => {
  it("prints only a count and writes the private source/content ids to a mode-0600 report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-missing-export-"));
    try {
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(sourcePath, JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "<p>x</p>" }));
      const manifestPath = path.join(root, "manifest.csv");
      await writeFileNode(
        manifestPath,
        [
          "joomla_id;language;content_id;slug;canonical_category;secondary_categories;phase;published_at;event_date;source_digest;resolved_digest;conversion_policy;acknowledged_findings;public_launch_decision;eligible_for_import;approved_by;approved_at",
          [
            "999", "fi", "super-secret-ghost-article", "s", "blogi", "", "launch", "2015-06-01T00:00:00Z", "",
            "a".repeat(64), "b".repeat(64), "joomla-conversion-v1", "", "INCLUDE", "YES", "Ilkka", "2026-09-17",
          ].join(";"),
        ].join("\n"),
      );
      const outDir = path.join(root, "out");
      let stdout = "";
      let stderr = "";
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--manifest", manifestPath,
          "--categories", "blogi",
          "--out", outDir,
          "--plan",
        ]);
      } catch (error) {
        stdout = String((error as { stdout?: unknown }).stdout ?? "");
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
      }
      for (const console of [stdout, stderr]) {
        expect(console).not.toContain("super-secret-ghost-article");
        expect(console).not.toContain("999/fi");
      }
      expect(stderr).toContain("1 approved manifest row(s) have no matching article");

      const reportPath = path.join(outDir, "missing-from-export.json");
      const report = JSON.parse(await readFileNode(reportPath, "utf8"));
      expect(JSON.stringify(report)).toContain("super-secret-ghost-article");

      const stats = await stat(reportPath);
      expect(stats.mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-12 finding — a malformed persisted photograph identity fails with a diagnosable private report, not an uncaught exception", () => {
  it("fails cleanly on a byLocator entry with invalid characters, rather than crashing deep inside buildImportPlan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-malformed-identity-"));
    try {
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(sourcePath, JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "<p>x</p>" }));
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          photographIdentities: {
            byLocator: { "stories/very-private-folder/a.jpg": "PHOTO WITH SPACES AND CAPS" },
            byContentHash: {},
          },
        }),
      );
      const outDir = path.join(root, "out");
      let stdout = "";
      let stderr = "";
      let failed = false;
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--out", outDir,
        ]);
      } catch (error) {
        failed = true;
        stdout = String((error as { stdout?: unknown }).stdout ?? "");
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
      }
      expect(failed).toBe(true);
      // A clean, expected failure — never a Node stack trace from an
      // uncaught TypeError, and never the private locator on the console.
      for (const console of [stdout, stderr]) {
        expect(console).not.toContain("stories/very-private-folder");
        expect(console).not.toContain("TypeError");
        expect(console).not.toContain("at ");
      }
      expect(stderr).toContain("malformed entr");

      const reportPath = path.join(outDir, "malformed-identities.json");
      const report = JSON.parse(await readFileNode(reportPath, "utf8"));
      expect(JSON.stringify(report)).toContain("PHOTO WITH SPACES AND CAPS");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not flag a well-formed persisted identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-wellformed-identity-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "photo bytes");
      const sha256 = createHash("sha256").update("photo bytes").digest("hex");
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/g/a.jpg": { fi: "Teksti" } },
          galleryFiles: { "stories/g": [{ filename: "a.jpg", sha256 }] },
          photographIdentities: { byLocator: { "stories/g/a.jpg": "photo-well-formed" }, byContentHash: {} },
        }),
      );
      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", path.join(root, "images"),
        "--out", outDir,
      ]);
      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
      expect(findings[0].convertible).toBe(true);
      expect(findings[0].resolvedImageAltText[0]?.mediaId).toBe("photo-well-formed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-11 finding — a malformed manifest's row errors go into a private report file, never to the console", () => {
  it("prints only a count and writes the private route/slug detail to a mode-0600 manifest-errors.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-manifest-privacy-"));
    try {
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        [
          JSON.stringify({ joomlaId: "1", language: "fi", title: "T1", body: "<p>x</p>" }),
          JSON.stringify({ joomlaId: "2", language: "fi", title: "T2", body: "<p>y</p>" }),
        ].join("\n"),
      );
      const digest = "a".repeat(64);
      const resolvedDigest = "b".repeat(64);
      const cells = (contentId: string, slug: string, sourceId: string) =>
        [
          sourceId, "fi", contentId, slug, "blogi", "", "launch", "2015-06-01T00:00:00Z", "",
          digest, resolvedDigest, "joomla-conversion-v1", "", "INCLUDE", "YES", "Ilkka", "2026-09-17",
        ].join(";");
      const manifestPath = path.join(root, "manifest.csv");
      await writeFileNode(
        manifestPath,
        [
          "joomla_id;language;content_id;slug;canonical_category;secondary_categories;phase;published_at;event_date;source_digest;resolved_digest;conversion_policy;acknowledged_findings;public_launch_decision;eligible_for_import;approved_by;approved_at",
          cells("very-secret-project-name", "very-secret-slug", "1"),
          // A colliding route: two source articles claiming the same slug —
          // the private detail the error message names.
          cells("a-different-secret-id", "very-secret-slug", "2"),
        ].join("\n"),
      );
      const outDir = path.join(root, "out");
      let stdout = "";
      let stderr = "";
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--manifest", manifestPath,
          "--categories", "blogi",
          "--out", outDir,
          "--plan",
        ]);
      } catch (error) {
        stdout = String((error as { stdout?: unknown }).stdout ?? "");
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
      }
      for (const console of [stdout, stderr]) {
        expect(console).not.toContain("very-secret-slug");
        expect(console).not.toContain("very-secret-project-name");
      }
      expect(stderr).toContain("The manifest is not usable: 1 error");

      const errorsPath = path.join(outDir, "manifest-errors.json");
      const errors = JSON.parse(await readFileNode(errorsPath, "utf8"));
      expect(JSON.stringify(errors)).toContain("very-secret-slug");

      const stats = await stat(errorsPath);
      expect(stats.mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-10 finding — conflict details go into a private report file, never to the console", () => {
  it("prints only counts on stdout/stderr and writes the full detail to a mode-0600 conflicts.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-conflict-privacy-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "very-private-folder-name");
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "PHOTO BYTES");
      const sha256 = createHash("sha256").update("PHOTO BYTES").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/very-private-folder-name{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/very-private-folder-name/a.jpg": { fi: "Erittäin yksityinen kuvateksti" } },
          galleryFiles: { "stories/very-private-folder-name": [{ filename: "a.jpg", sha256 }] },
          photographIdentities: {
            byLocator: { "stories/very-private-folder-name/a.jpg": "photo-by-locator" },
            byContentHash: { [sha256]: "photo-by-hash-different" },
          },
        }),
      );
      const outDir = path.join(root, "out");
      let stdout = "";
      let stderr = "";
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--image-root", path.join(root, "images"),
          "--out", outDir,
        ]);
      } catch (error) {
        stdout = String((error as { stdout?: unknown }).stdout ?? "");
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
      }

      // The private locator (which names a folder — "very-private-folder-name"
      // — and the sha256 hash and the localized alt text must not reach the
      // console at all.
      for (const console of [stdout, stderr]) {
        expect(console).not.toContain("very-private-folder-name");
        expect(console).not.toContain(sha256);
        expect(console).not.toContain("Erittäin yksityinen kuvateksti");
        expect(console).not.toContain("photo-by-locator");
      }
      expect(stderr).toContain("1 photograph identity conflict");

      const conflictsPath = path.join(outDir, "conflicts.json");
      const conflicts = JSON.parse(await readFileNode(conflictsPath, "utf8"));
      expect(JSON.stringify(conflicts)).toContain("very-private-folder-name");
      expect(JSON.stringify(conflicts)).toContain("photo-by-locator");

      const stats = await stat(conflictsPath);
      expect(stats.mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-10 finding — disagreeing persisted identity indexes are refused, not resolved by silently preferring the locator", () => {
  it("fails the run when byLocator and byContentHash name different identities for the same file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-index-disagree-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "PHOTO BYTES");
      const sha256 = createHash("sha256").update("PHOTO BYTES").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/g/a.jpg": { fi: "Teksti" } },
          galleryFiles: { "stories/g": [{ filename: "a.jpg", sha256 }] },
          // A hand-edited or merged photograph-identities.json whose two
          // indexes disagree about this exact file.
          photographIdentities: {
            byLocator: { "stories/g/a.jpg": "photo-by-locator" },
            byContentHash: { [sha256]: "photo-by-hash-different" },
          },
        }),
      );
      const outDir = path.join(root, "out");
      let failed = false;
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--image-root", path.join(root, "images"),
          "--out", outDir,
        ]);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      await expect(readFileNode(path.join(outDir, "findings.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not flag the identities when both indexes agree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-index-agree-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "PHOTO BYTES");
      const sha256 = createHash("sha256").update("PHOTO BYTES").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/g/a.jpg": { fi: "Teksti" } },
          galleryFiles: { "stories/g": [{ filename: "a.jpg", sha256 }] },
          photographIdentities: {
            byLocator: { "stories/g/a.jpg": "photo-agreed" },
            byContentHash: { [sha256]: "photo-agreed" },
          },
        }),
      );
      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", path.join(root, "images"),
        "--out", outDir,
      ]);
      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
      expect(findings[0].convertible).toBe(true);
      expect(findings[0].resolvedImageAltText[0]?.mediaId).toBe("photo-agreed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("CLI end-to-end: round-9 finding — the same photograph appearing twice in one gallery with conflicting approved alt text is refused, not silently collapsed", () => {
  it("fails the run rather than letting Object.fromEntries keep only the last occurrence's alt text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-alt-conflict-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      // Two files, same bytes — one photograph, two occurrences in one gallery.
      await writeFileNode(path.join(galleryDir, "a.jpg"), "SAME BYTES");
      await writeFileNode(path.join(galleryDir, "b.jpg"), "SAME BYTES");
      const sha256 = createHash("sha256").update("SAME BYTES").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          // The owner authored different alt text for the two occurrences of
          // what content-hash correlation recognizes as one photograph.
          altText: { "stories/g/a.jpg": { fi: "Teksti A" }, "stories/g/b.jpg": { fi: "Teksti B eri" } },
          galleryFiles: {
            "stories/g": [
              { filename: "a.jpg", sha256 },
              { filename: "b.jpg", sha256 },
            ],
          },
        }),
      );
      const outDir = path.join(root, "out");
      let failed = false;
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--resolution", resolutionPath,
          "--image-root", path.join(root, "images"),
          "--out", outDir,
        ]);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      // Nothing is written — the old collapsed-alt-text output must not
      // silently exist for an operator to unknowingly approve.
      await expect(readFileNode(path.join(outDir, "findings.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not flag the legitimate case: the same bytes with matching alt text at both occurrences", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-alt-match-"));
    try {
      const galleryDir = path.join(root, "images", "stories", "g");
      await run("mkdir", ["-p", galleryDir]);
      await writeFileNode(path.join(galleryDir, "a.jpg"), "SAME BYTES");
      await writeFileNode(path.join(galleryDir, "b.jpg"), "SAME BYTES");
      const sha256 = createHash("sha256").update("SAME BYTES").digest("hex");

      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(
        sourcePath,
        JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "{gallery}stories/g{/gallery}" }),
      );
      const resolutionPath = path.join(root, "resolution.json");
      await writeFileNode(
        resolutionPath,
        JSON.stringify({
          altText: { "stories/g/a.jpg": { fi: "Sama teksti" }, "stories/g/b.jpg": { fi: "Sama teksti" } },
          galleryFiles: {
            "stories/g": [
              { filename: "a.jpg", sha256 },
              { filename: "b.jpg", sha256 },
            ],
          },
        }),
      );
      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--resolution", resolutionPath,
        "--image-root", path.join(root, "images"),
        "--out", outDir,
      ]);
      const findings = JSON.parse(await readFileNode(path.join(outDir, "findings.json"), "utf8"));
      expect(findings[0].convertible).toBe(true);
      expect(findings[0].resolvedImageAltText.every((entry: { value: string }) => entry.value === "Sama teksti")).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("verifyApprovedGalleryFiles: round-5 duplicate-filename finding", () => {
  it("refuses an approved inventory with a duplicate filename, even if directory size matches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-gallery-dup-"));
    try {
      await writeFileNode(path.join(root, "a.jpg"), "AAA");
      await writeFileNode(path.join(root, "b.jpg"), "BBB");
      const locators = await verifyApprovedGalleryFiles(root, ".", [
        { filename: "a.jpg", sha256: createHash("sha256").update("AAA").digest("hex") },
        { filename: "a.jpg", sha256: createHash("sha256").update("AAA").digest("hex") },
      ]);
      // 2 approved entries (one duplicated name) vs. 2 real files — a
      // size-only comparison would have passed this.
      expect(locators).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("sourceRecordDigest", () => {
  it("changes when any imported field changes, not only the body — found in Codex review round 4", () => {
    const base = { joomlaId: "1", language: "fi", title: "T", body: "<p>x</p>" };
    const baseline = sourceRecordDigest(base);
    expect(sourceRecordDigest({ ...base, title: "Different title" })).not.toBe(baseline);
    expect(sourceRecordDigest({ ...base, summary: "S" })).not.toBe(baseline);
    expect(sourceRecordDigest({ ...base, author: "A" })).not.toBe(baseline);
    expect(sourceRecordDigest({ ...base, tags: ["a"] })).not.toBe(baseline);
    // Unchanged input reproduces the same digest.
    expect(sourceRecordDigest({ ...base })).toBe(baseline);
  });
});

describe("CLI end-to-end: round-10 finding — an unknown or mistyped option fails, rather than being silently ignored", () => {
  it("rejects a mistyped option instead of silently keeping the default phase", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-typo-"));
    try {
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(sourcePath, JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "<p>x</p>" }));
      let failed = false;
      let stderr = "";
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--phaze", "later", // typo for --phase
          "--out", path.join(root, "out"),
        ]);
      } catch (error) {
        failed = true;
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
      }
      expect(failed).toBe(true);
      expect(stderr).toContain("unknown option");
      expect(stderr).toContain("--phaze");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects a stray positional argument", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-positional-"));
    try {
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(sourcePath, JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "<p>x</p>" }));
      let failed = false;
      try {
        await run("node", [
          path.join(import.meta.dirname, "convert-joomla-content.mts"),
          "--source", sourcePath,
          "--out", path.join(root, "out"),
          "stray-positional-argument",
        ]);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("still accepts every real option unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-cli-known-options-"));
    try {
      const sourcePath = path.join(root, "articles.ndjson");
      await writeFileNode(sourcePath, JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "<p>x</p>" }));
      const outDir = path.join(root, "out");
      await run("node", [
        path.join(import.meta.dirname, "convert-joomla-content.mts"),
        "--source", sourcePath,
        "--out", outDir,
        "--review",
      ]);
      await expect(readFileNode(path.join(outDir, "findings.json"), "utf8")).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("parseSourceArticles", () => {
  it("reads one article per line and keeps the optional fields it recognizes", () => {
    const text = [
      JSON.stringify({ joomlaId: "347", language: "fi-FI", title: "T", body: "<p>x</p>", summary: "S", tags: ["a", "b"] }),
      "",
      JSON.stringify({ joomlaId: "394", language: "en-GB", title: "T2", body: "<p>y</p>" }),
    ].join("\n");
    const { articles, errors } = parseSourceArticles(text);
    expect(errors).toEqual([]);
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({ joomlaId: "347", summary: "S", tags: ["a", "b"] });
    expect(articles[1]).not.toHaveProperty("summary");
  });

  it("reports a malformed line rather than skipping it", () => {
    const { articles, errors } = parseSourceArticles('{"joomlaId":"1"\nnot json\n');
    expect(articles).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("line 1");
  });

  it("reports a record missing a required field", () => {
    const { errors } = parseSourceArticles(JSON.stringify({ joomlaId: "1", language: "fi", title: "T" }));
    expect(errors[0]).toContain("required strings");
  });

  it("rejects, rather than silently drops, a malformed optional field", () => {
    // A dropped `author` or a `tags` entry of the wrong type would let
    // approved metadata quietly vanish from the eventual import.
    expect(
      parseSourceArticles(JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "b", summary: 7 }))
        .errors[0],
    ).toContain("summary must be a string");
    expect(
      parseSourceArticles(JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "b", author: 7 }))
        .errors[0],
    ).toContain("author must be a string");
    expect(
      parseSourceArticles(JSON.stringify({ joomlaId: "1", language: "fi", title: "T", body: "b", tags: ["a", 7] }))
        .errors[0],
    ).toContain("tags must be an array of strings");
  });
});

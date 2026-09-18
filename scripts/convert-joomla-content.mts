#!/usr/bin/env node
/**
 * AB#137's owner-run conversion command: reads an exported Joomla article set
 * and the owner's approval manifest, converts each body into this project's
 * shared content blocks, and reports exactly what would and would not migrate.
 *
 *   npm run convert:joomla -- --source <articles.ndjson> --out <report-dir> [options]
 *
 * It is **read-only against the source and offline**: no network request, no
 * Sanity credential, no write anywhere but the report directory the operator
 * names. It does not import anything; the write step is a separate command that
 * does not exist yet (see `docs/sanity-seeding.md`).
 *
 * Two modes, because of a real ordering problem. Every row in the owner's
 * worksheet starts out not yet eligible for import, and what makes a row
 * eligible is knowing what its conversion would lose or refuse. An
 * approval-gated tool alone could therefore never produce the findings needed to
 * grant the approval it demands:
 *
 * - `--review` (default) converts every article in the export and reports the
 *   findings, whatever any manifest says about it — the export is already the
 *   owner's selection, and this is the pass that resolves the exception rows.
 *   A manifest is optional here; when given, its own approval state is reported
 *   alongside, but it does not narrow what is converted.
 * - `--plan` is strictly approval-gated: it builds the import plan from fully
 *   approved rows in one phase only.
 *
 * ## Privacy
 *
 * A finding carries a bounded excerpt of the source, a dropped link target, or a
 * converted body. That is private migration material. It is written only into
 * the operator's report directory, never to the console and never into anything
 * shared: what this command prints, and what belongs on the work item, is counts
 * and digests.
 */

import { readdir, readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { parseLegacyPollResults } from "./joomla-polls.mts";
import { convertJoomlaBody, CONVERSION_POLICY_VERSION, resolvedConversionDigest, type ConversionResult, type ResolvedGallery } from "./joomla-html-conversion.mts";
import {
  IDENTITY_PATTERN,
  normalizeLanguage,
  reviewImportManifest,
  type ApprovedArticle,
} from "./joomla-import-manifest.mts";
import { buildImportPlan, mintPhotographIdentity } from "./joomla-import-plan.mts";

const MAX_INLINE_GALLERY_ITEMS = 12;

/** Image extensions a public derivative can be made from. Anything else in a gallery folder is not an image. */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tif", ".tiff"]);

/**
 * Writes a private-migration-material file `0600`, not the umask-dependent
 * default `writeFile` would give it. `writeFile` truncates in place rather
 * than replacing the inode, so an existing file's permissions would otherwise
 * survive an earlier, looser run; this always re-asserts the mode.
 */
async function writePrivateFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

function fail(message: string): never {
  console.error(`Joomla conversion failed: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The source export contract
// ---------------------------------------------------------------------------

/**
 * One line of the export: one Joomla article in one language. A deliberately
 * small, explicit contract rather than a general Joomla SQL or archive reader —
 * the owner produces this file once from the backup, and this command never has
 * to understand Joomla's storage.
 */
export type SourceArticle = {
  readonly joomlaId: string;
  readonly language: string;
  readonly title: string;
  readonly body: string;
  readonly summary?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
};

/**
 * SHA-256 over the *whole* imported source record — title, summary, author,
 * tags, and body — never the body alone. An earlier draft digested only the
 * body, so an edited title or author with an unchanged body would silently
 * keep an approval that no longer covers what would actually be published
 * (found in Codex review round 4). Field order is fixed and `tags` is not
 * re-sorted, so a genuine reordering of authored tags is also caught — this
 * is meant to detect *any* change, not just a semantic one.
 */
export function sourceRecordDigest(article: SourceArticle): string {
  const canonical = JSON.stringify({
    title: article.title,
    summary: article.summary ?? null,
    author: article.author ?? null,
    tags: article.tags ?? null,
    body: article.body,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function parseSourceArticles(text: string): { articles: readonly SourceArticle[]; errors: readonly string[] } {
  const articles: SourceArticle[] = [];
  const errors: string[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      errors.push(`line ${index + 1}: not valid JSON`);
      continue;
    }
    const value = record as Partial<SourceArticle>;
    if (
      typeof value.joomlaId !== "string" ||
      typeof value.language !== "string" ||
      typeof value.title !== "string" ||
      typeof value.body !== "string"
    ) {
      errors.push(`line ${index + 1}: joomlaId, language, title, and body are all required strings`);
      continue;
    }
    // Optional fields present with the wrong type are a reported error, not a
    // silent filter: dropping a malformed `author` or `tags` entry would let
    // approved metadata quietly vanish from the eventual import (found in
    // Codex review round 2).
    if (value.summary !== undefined && typeof value.summary !== "string") {
      errors.push(`line ${index + 1}: summary must be a string when present`);
      continue;
    }
    if (value.author !== undefined && typeof value.author !== "string") {
      errors.push(`line ${index + 1}: author must be a string when present`);
      continue;
    }
    if (value.tags !== undefined) {
      if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
        errors.push(`line ${index + 1}: tags must be an array of strings when present`);
        continue;
      }
    }
    articles.push({
      joomlaId: value.joomlaId,
      language: value.language,
      title: value.title,
      body: value.body,
      ...(value.summary === undefined ? {} : { summary: value.summary }),
      ...(value.author === undefined ? {} : { author: value.author }),
      ...(value.tags === undefined ? {} : { tags: value.tags as readonly string[] }),
    });
  }
  return { articles, errors };
}

// ---------------------------------------------------------------------------
// Resolution inputs
// ---------------------------------------------------------------------------

/**
 * Maps a source image reference and a gallery folder onto approved photograph
 * identities. Supplied as one JSON file the owner controls, so this command
 * never has to parse the private worksheets' own evolving column sets.
 */
/** One approved photograph in an approved gallery's exact, owner-decided order. */
export type ApprovedGalleryFile = {
  readonly filename: string;
  /** Lowercase 64-char hex SHA-256 of the file's bytes. Content identity, not just a name. */
  readonly sha256: string;
};

/** One approved loose body image: where it is, and the approved bytes' hash. */
export type ApprovedLooseImage = {
  readonly locator: string;
  /** Lowercase 64-char hex SHA-256 of the file's bytes, verified the same way a gallery file's is. */
  readonly sha256: string;
};

type ResolutionFile = {
  /**
   * Source `src` (as written in the body) → its approved locator and content
   * hash. A gallery's file inventory has carried a hash since round 4; a loose
   * image never did, which meant an in-place substitution here — same `src`,
   * same locator, different bytes — was invisible to every check this tool
   * has, including the resolved-output digest (found in Codex review round 7).
   */
  readonly images?: Readonly<Record<string, ApprovedLooseImage>>;
  /**
   * Locator → language subtag → alternative text. Language-keyed, not a bare
   * string, because a translated article pair commonly shares one gallery
   * folder (this migration's own "Chamonix 2006" fi/en pair does) — a single
   * string per locator would attribute one language's alt text to the other
   * article's language, publishing mislabeled text (found in Codex review
   * round 5). ADR-0008's own fallback is not reproduced here: a locator
   * missing the requested language is an `image-missing-alt` refusal, not a
   * silent fallback, because alt text is invented nowhere in this tool.
   */
  readonly altText?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Gallery folder path → the owner-approved ordered file inventory, from the
   * decision sheet. A file *count* alone cannot prove the approved images are
   * these images — replacing one approved photograph with another file of the
   * same name, or a differently-named file that merely brings the count back
   * to the approved total, would pass a count check silently. Comparing the
   * exact filename **and** content hash of every approved entry is what makes
   * "not approved" mean "not this exact photograph," not just "not this many
   * files" (found in Codex review round 4).
   */
  readonly galleryFiles?: Readonly<Record<string, readonly ApprovedGalleryFile[]>>;
  /** YouTube video id → the accessible title the owner supplies for its load button. */
  readonly youtubeTitles?: Readonly<Record<string, string>>;
  /**
   * Photograph identities carried over from an earlier run or phase — the
   * exact shape `photograph-identities.json` is written in. `byLocator` is
   * the primary index; `byContentHash` is what lets `identityFor` recognize
   * a renamed file's bytes as an already-known photograph instead of minting
   * a second identity for it.
   */
  readonly photographIdentities?: PersistedPhotographIdentities;
};

/** The persisted identity map's own shape — see `identityFor`'s doc comment for why it is two-part. */
export type PersistedPhotographIdentities = {
  readonly byLocator: Readonly<Record<string, string>>;
  readonly byContentHash: Readonly<Record<string, string>>;
};

/**
 * Verifies a gallery folder against its owner-approved file inventory: the
 * exact same files, by name and content, in the approved order. Any missing,
 * extra, renamed, or content-changed file refuses the whole gallery — a
 * partial match cannot tell which photograph the owner actually approved.
 *
 * Reads every approved file's bytes to hash them (a filename-only or
 * count-only check cannot detect a substituted file), which is why this tool
 * is no longer only a directory listing for a gallery — the private image
 * tree's bytes are read here, though still never uploaded or transmitted.
 */
export async function verifyApprovedGalleryFiles(
  imageRoot: string,
  relativeDir: string,
  approved: readonly ApprovedGalleryFile[],
): Promise<readonly string[] | undefined> {
  let actualNames: Set<string>;
  try {
    const entries = await readdir(path.join(imageRoot, relativeDir), { withFileTypes: true });
    actualNames = new Set(
      entries
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => entry.name),
    );
  } catch {
    return undefined;
  }

  const approvedNames = new Set(approved.map((entry) => entry.filename));
  // A duplicate filename in the approved list must refuse, not silently
  // collapse via the Set: a directory with N distinct files and an approved
  // list of N entries where one filename repeats (M < N unique names) would
  // otherwise pass a size-only comparison, and the loop below would still
  // walk the duplicate, changing both order and count (found in Codex review
  // round 5 — the exact ordered-inventory guarantee this function exists for).
  if (approvedNames.size !== approved.length) return undefined;
  if (actualNames.size !== approvedNames.size) return undefined;
  for (const name of actualNames) {
    if (!approvedNames.has(name)) return undefined;
  }

  const orderedLocators: string[] = [];
  for (const file of approved) {
    const filePath = path.join(imageRoot, relativeDir, file.filename);
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch {
      return undefined;
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== file.sha256.toLowerCase()) return undefined;
    orderedLocators.push(path.posix.join(relativeDir, file.filename));
  }
  return orderedLocators;
}

/**
 * Verifies one loose body image's real bytes against its approved hash — the
 * single-file counterpart to `verifyApprovedGalleryFiles`, for the same
 * reason: a locator alone does not prove the bytes behind it are still the
 * approved ones. Returns the verified lowercase hash, or `undefined` if the
 * file is missing or the bytes do not match.
 */
export async function verifyApprovedImageFile(
  imageRoot: string,
  locator: string,
): Promise<string | undefined> {
  try {
    const bytes = await readFile(path.join(imageRoot, locator));
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Options = {
  readonly source: string;
  readonly out: string;
  readonly manifest?: string;
  readonly resolution?: string;
  readonly pollResults?: string;
  readonly imageRoot?: string;
  readonly phase: string;
  readonly mode: "review" | "plan";
  readonly categories: readonly string[];
};

/**
 * Every recognized valued option. An earlier version accepted any
 * `--<name>` unconditionally, so a typo — `--phaze later` instead of
 * `--phase later` — was silently absorbed into an ignored map entry, leaving
 * `phase` at its default (`launch`) with no error at all. Since the phase
 * decides which approved rows a `--plan` write belongs to, a silently wrong
 * phase is not a cosmetic mistake (found in Codex review round 10).
 */
const KNOWN_OPTIONS = new Set(["source", "out", "manifest", "resolution", "poll-results", "image-root", "phase", "categories"]);

function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let mode: "review" | "plan" = "review";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--plan") { mode = "plan"; continue; }
    if (argument === "--review") { mode = "review"; continue; }
    if (!argument.startsWith("--")) {
      fail(`unexpected argument "${argument}" — every option is spelled --<name> <value>`);
    }
    const name = argument.slice(2);
    if (!KNOWN_OPTIONS.has(name)) {
      fail(
        `unknown option "${argument}" — known options are ${[...KNOWN_OPTIONS].map((known) => `--${known}`).join(", ")}, --plan, --review`,
      );
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`${argument} needs a value`);
    values.set(name, next);
    index += 1;
  }
  const source = values.get("source");
  const out = values.get("out");
  if (source === undefined) fail("--source <articles.ndjson> is required");
  if (out === undefined) fail("--out <report-dir> is required");
  if (mode === "plan" && values.get("manifest") === undefined) {
    fail("--plan needs --manifest <approved-manifest.csv>");
  }
  return {
    source,
    out,
    ...(values.has("poll-results") ? { pollResults: values.get("poll-results")! } : {}),
    ...(values.get("manifest") === undefined ? {} : { manifest: values.get("manifest") as string }),
    ...(values.get("resolution") === undefined ? {} : { resolution: values.get("resolution") as string }),
    ...(values.get("image-root") === undefined ? {} : { imageRoot: values.get("image-root") as string }),
    phase: values.get("phase") ?? "launch",
    mode,
    categories: (values.get("categories") ?? "").split(/[\s,]+/u).filter((entry) => entry.length > 0),
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  const sourceText = await readFile(options.source, "utf8").catch(() => fail(`could not read ${options.source}`));
  const sourceExportDigest = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const { articles, errors: sourceErrors } = parseSourceArticles(sourceText);
  if (sourceErrors.length > 0) fail(`the source export has ${sourceErrors.length} bad line(s): ${sourceErrors[0]}`);
  if (articles.length === 0) fail("the source export holds no articles");

  const legacyPolls = options.pollResults === undefined ? new Map() : parseLegacyPollResults(await readFile(options.pollResults, "utf8"));
  const resolution: ResolutionFile =
    options.resolution === undefined
      ? {}
      : JSON.parse(await readFile(options.resolution, "utf8").catch(() => fail(`could not read ${options.resolution}`)));

  const manifestText =
    options.manifest === undefined
      ? undefined
      : await readFile(options.manifest, "utf8").catch(() => fail(`could not read ${options.manifest}`));
  const review = manifestText === undefined ? undefined : reviewImportManifest(manifestText, { phase: options.phase });

  if (options.mode === "plan") {
    if (review === undefined) fail("--plan needs a manifest");
    if (review.errors.length > 0) {
      // A malformed-row error can name a private source id, a planned route,
      // or a category identity (`joomla-import-manifest.mts`'s own row
      // messages quote them directly) — this project's own runbook is
      // explicit that console output is counts and digests only, private
      // detail belongs in the report directory (found leaking here in Codex
      // review round 11, the same class of gap round 10 already closed for
      // the identity/alt-text conflicts).
      await mkdir(options.out, { recursive: true, mode: 0o700 });
      await writePrivateFile(
        path.join(options.out, "manifest-errors.json"),
        `${JSON.stringify(review.errors, null, 2)}\n`,
      );
      console.error(
        `The manifest is not usable: ${review.errors.length} error(s). See ${path.join(options.out, "manifest-errors.json")} — private migration material; keep it out of Git and out of shared evidence.`,
      );
      process.exit(1);
    }
  }

  // Which source articles this run converts. In review mode the manifest is
  // optional: without one, every exported article is reviewed.
  const approvalBySource = new Map<string, ApprovedArticle>(
    (review?.approved ?? []).map((entry) => [`${entry.sourceId}:${entry.language}`, entry]),
  );

  const identities: Record<string, string> = { ...(resolution.photographIdentities?.byLocator ?? {}) };
  // A locator alone cannot survive a rename or move in the source tree — the
  // very case ADR-0002 §1 requires identity to survive — because a new path
  // simply has no entry in `identities` and would mint a fresh id (found in
  // Codex review round 7). Content hash closes that gap as a *lookup*
  // correlation only, never as the id's own derivation (ADR-0002 §1 forbids
  // deriving `mediaId` from a content hash, since a legitimate re-export can
  // change bytes for the *same* photograph): if a hash is already known under
  // any locator, a new locator with that same hash reuses the existing id
  // instead of minting a second one for what is provably the same file.
  const contentHashIndex: Record<string, string> = { ...(resolution.photographIdentities?.byContentHash ?? {}) };
  const locators: Record<string, string> = {};

  // `resolution.photographIdentities` is a JSON file the owner passes back —
  // sometimes by hand, per the documented carry-over workflow — so a
  // malformed entry is a real possibility, not a defensive formality. Without
  // this check, a bad value would flow all the way through conversion and
  // only surface as an uncaught `migratedId` exception deep inside
  // `buildImportPlan`, aborting the run with a stack trace instead of the
  // diagnosable, private report every other failure mode here produces
  // (found in Codex review round 12).
  const malformedPersistedIdentities: string[] = [];
  for (const [locator, mediaId] of Object.entries(identities)) {
    if (!IDENTITY_PATTERN.test(mediaId)) {
      malformedPersistedIdentities.push(`photographIdentities.byLocator["${locator}"] = "${mediaId}" is not a valid identity`);
    }
  }
  for (const [hash, mediaId] of Object.entries(contentHashIndex)) {
    if (!IDENTITY_PATTERN.test(mediaId)) {
      malformedPersistedIdentities.push(`photographIdentities.byContentHash["${hash}"] = "${mediaId}" is not a valid identity`);
    }
  }
  if (malformedPersistedIdentities.length > 0) {
    // Detected — and exited on — before conversion even starts: nothing
    // downstream has read a malformed value yet, so failing here is what
    // keeps this a diagnosable, private report instead of the exact
    // uncaught-exception crash this check exists to prevent.
    await mkdir(options.out, { recursive: true, mode: 0o700 });
    await writePrivateFile(
      path.join(options.out, "malformed-identities.json"),
      `${JSON.stringify(malformedPersistedIdentities, null, 2)}\n`,
    );
    console.error(
      `${malformedPersistedIdentities.length} malformed entr(ies) in the persisted photograph-identities.json. See ${path.join(options.out, "malformed-identities.json")} — private migration material; keep it out of Git and out of shared evidence.`,
    );
    process.exit(1);
  }
  // One identity must resolve to one physical asset: `buildImportPlan` later
  // picks exactly one `sourceLocators[mediaId]` to become that identity's
  // uploaded derivative. If the owner's own persisted `byLocator` map ever
  // binds two *currently referenced* locators to the same identity — a
  // legitimate state after manually carrying identity across a genuine
  // re-export — and those two locators verify to *different* bytes, this run
  // cannot know which one the owner means as canonical; picking "whichever
  // was processed last" would make the plan silently order-dependent, and an
  // article referencing the other locator would end up planned against pixels
  // its own approval never covered (found in Codex review round 8). Recorded
  // here and checked once every reference is known, rather than resolved
  // silently.
  const verifiedHashByMediaId: Record<string, string> = {};
  const identityConflicts: string[] = [];
  // Same shape as `identityConflicts`, for a different question: a gallery
  // can legitimately place the same photograph (by content hash) at two
  // occurrences, but if the owner authored *different* approved alt text for
  // each, `resolveGalleryForLanguage`'s per-mediaId map used to be built with
  // `Object.fromEntries`, which silently keeps only the last entry — every
  // occurrence of that photograph then reports the *other* occurrence's text,
  // and the earlier one is gone with no trace (found in Codex review round 9).
  const altTextConflicts: string[] = [];
  const identityFor = (locator: string, contentHash?: string): string => {
    const existingByLocator = identities[locator];
    const existingByHash = contentHash === undefined ? undefined : contentHashIndex[contentHash];

    // The two persisted indexes are supposed to name the *same* identity for
    // the same file — `byLocator[locator]` and `byContentHash[hash]` are two
    // ways to look up one fact. An earlier draft picked `existingByLocator`
    // whenever both existed, silently overwriting `byContentHash` with it and
    // discarding whatever identity the hash had previously been recorded
    // under — so the same photograph could end up with a different id
    // depending on which locator happened to be processed, exactly the
    // instability the two-index design exists to prevent (found in Codex
    // review round 10). A genuine disagreement here means the persisted
    // `photograph-identities.json` itself is inconsistent (hand-edited, or
    // merged from two runs), and has to be reconciled by a human, not
    // resolved by an arbitrary preference order.
    if (existingByLocator !== undefined && existingByHash !== undefined && existingByLocator !== existingByHash) {
      identityConflicts.push(
        `the persisted identity indexes disagree for locator "${locator}": byLocator names "${existingByLocator}", but its verified content hash is already bound to "${existingByHash}" under a different locator. Reconcile photograph-identities.json before re-running.`,
      );
    }

    const resolved = existingByLocator ?? existingByHash ?? mintPhotographIdentity();

    if (contentHash !== undefined) {
      const previousHash = verifiedHashByMediaId[resolved];
      if (previousHash !== undefined && previousHash !== contentHash) {
        identityConflicts.push(
          `photograph "${resolved}" is ambiguous: locator "${locators[resolved] ?? "?"}" verified to hash ${previousHash}, but locator "${locator}" verifies to a different hash ${contentHash} for the same identity. Give the reprocessed file its own identity, or confirm which locator is canonical.`,
        );
      } else {
        verifiedHashByMediaId[resolved] = contentHash;
      }
      contentHashIndex[contentHash] = resolved;
    }
    identities[locator] = resolved;
    locators[resolved] = locator;
    return resolved;
  };

  // Galleries need file reads to verify content, which is async, so the whole
  // inventory is resolved before converting rather than from inside the
  // synchronous converter. Kept language-independent here — a photograph's
  // identity does not depend on which article calls it — with alt text
  // resolved per calling article's language below, not baked in here: a
  // translated article pair commonly shares one gallery folder (this
  // migration's own "Chamonix 2006" fi/en pair does), so a language-neutral
  // inventory with a language-*applied* lookup is what keeps fi text from
  // being published as en (found in Codex review round 5).
  const galleryInventory = new Map<
    string,
    {
      readonly kind: "mini" | "end";
      readonly mediaIds: readonly string[];
      readonly locators: readonly string[];
      readonly contentHashes: readonly string[];
    } | undefined
  >();
  if (options.imageRoot !== undefined) {
    for (const [galleryPath, approvedFiles] of Object.entries(resolution.galleryFiles ?? {})) {
      const fileLocators = await verifyApprovedGalleryFiles(options.imageRoot, galleryPath, approvedFiles);
      if (fileLocators === undefined || fileLocators.length === 0) {
        galleryInventory.set(galleryPath, undefined);
        continue;
      }
      // The approved order is the owner's own decision (matching the source
      // site's authored order), not the filesystem's alphabetical listing —
      // preserved through `fileLocators`, which walks `approvedFiles` in the
      // same order `verifyApprovedGalleryFiles` did, so `approvedFiles[i]`'s
      // already-verified hash is `fileLocators[i]`'s real content hash.
      const contentHashes = approvedFiles.map((file) => file.sha256.toLowerCase());
      const mediaIds = fileLocators.map((locator, index) => identityFor(locator, contentHashes[index]));
      galleryInventory.set(galleryPath, {
        kind: mediaIds.length > MAX_INLINE_GALLERY_ITEMS ? "end" : "mini",
        mediaIds,
        locators: fileLocators,
        contentHashes,
      });
    }
  }

  // Every declared loose image is verified against real bytes the same way a
  // gallery file already is — an unverified `src` used to resolve on trust
  // alone, which meant an in-place substitution was invisible everywhere,
  // including the resolved-output digest (found in Codex review round 7).
  // Pre-verified here (before the synchronous converter runs) rather than
  // inside `resolveImage` because reading a file is async and the converter's
  // own callbacks are not.
  const verifiedImageHashes = new Map<string, string>();
  if (options.imageRoot !== undefined) {
    for (const [src, declared] of Object.entries(resolution.images ?? {})) {
      const actualHash = await verifyApprovedImageFile(options.imageRoot, declared.locator);
      if (actualHash !== undefined && actualHash === declared.sha256.toLowerCase()) {
        verifiedImageHashes.set(src, actualHash);
      }
    }
  }

  function resolveGalleryForLanguage(galleryPath: string, language: string): ResolvedGallery | undefined {
    const entry = galleryInventory.get(galleryPath);
    if (entry === undefined) return undefined;

    const altTextByMediaId: Record<string, string> = {};
    for (const [index, mediaId] of entry.mediaIds.entries()) {
      const value = resolution.altText?.[entry.locators[index] ?? ""]?.[language] ?? "";
      const existing = altTextByMediaId[mediaId];
      if (existing !== undefined && existing !== value) {
        altTextConflicts.push(
          `photograph "${mediaId}" has two different ${language} alt texts within the gallery "${galleryPath}": "${existing}" (from an earlier occurrence) vs "${value}" (from locator "${entry.locators[index] ?? "?"}"). The photograph's alt text is authored once on the shared media document; give the two occurrences matching text, or confirm which one is correct.`,
        );
        continue; // keep the first-seen value; the run fails before it is used.
      }
      altTextByMediaId[mediaId] = value;
    }

    return {
      kind: entry.kind,
      mediaIds: entry.mediaIds,
      altTextByMediaId,
      contentHashByMediaId: Object.fromEntries(
        entry.mediaIds.map((mediaId, index) => [mediaId, entry.contentHashes[index]]),
      ),
    };
  }

  const finalConversions: {
    article: SourceArticle;
    result: ConversionResult;
    sourceDigest: string;
  }[] = [];

  // An approved manifest row this export does not contain is an error, never a
  // silent skip: the plan must not claim zero errors while omitting
  // owner-approved launch content (AGENTS.md's "no unapproved demo, … or
  // abandoned content remains" cuts both ways — nothing approved may go
  // missing either). Checked before conversion so it surfaces regardless of
  // whether anything else in the run succeeds.
  if (options.mode === "plan") {
    const exportedKeys = new Set(
      articles.map((article) => `${article.joomlaId}:${normalizeLanguage(article.language)}`),
    );
    const missingFromExport: string[] = [];
    for (const approval of review?.approved ?? []) {
      if (!exportedKeys.has(`${approval.sourceId}:${approval.language}`)) {
        missingFromExport.push(
          `Approved manifest row ${approval.sourceId}/${approval.language} (content "${approval.contentId}") has no matching article in the source export.`,
        );
      }
    }
    if (missingFromExport.length > 0) {
      // Source and content ids are private pre-launch identifiers — the same
      // console-privacy rule already applied to the manifest's own row errors
      // and the identity/alt-text conflicts applies here too, and had been
      // missed on this one, older check (found in Codex review round 12).
      await mkdir(options.out, { recursive: true, mode: 0o700 });
      await writePrivateFile(
        path.join(options.out, "missing-from-export.json"),
        `${JSON.stringify(missingFromExport, null, 2)}\n`,
      );
      console.error(
        `${missingFromExport.length} approved manifest row(s) have no matching article in the source export. See ${path.join(options.out, "missing-from-export.json")} — private migration material; keep it out of Git and out of shared evidence.`,
      );
      process.exit(1);
    }
  }

  for (const article of articles) {
    const language = normalizeLanguage(article.language);
    if (options.mode === "plan" && !approvalBySource.has(`${article.joomlaId}:${language}`)) continue;

    const result = convertJoomlaBody(article.body, {
      language,
      resolveImage: (src) => {
        const declared = resolution.images?.[src];
        if (declared === undefined) return undefined;
        // Not verified (`--image-root` was not given, the file is missing, or
        // its bytes do not match the approved hash) → unresolved, the same
        // "not approved" refusal a gallery folder that fails verification
        // gets, rather than resolving on trust alone (found in Codex review
        // round 7).
        const contentHash = verifiedImageHashes.get(src);
        if (contentHash === undefined) return undefined;
        const { locator } = declared;
        const alt = resolution.altText?.[locator]?.[language];
        const mediaId = identityFor(locator, contentHash);
        // Deliberately does *not* fall back to `{ mediaId }` when the
        // language-specific alt text is missing: `convertJoomlaBody`'s own
        // `visitImage` then falls back to the raw source `<img alt="…">`
        // attribute, which is unreviewed Joomla content — exactly what "alt
        // text is never invented here" forbids. Passing `alt: ""` forces the
        // same `image-missing-alt` refusal the converter already gives a
        // genuinely undescribed image, instead of silently reintroducing
        // unapproved text (found in Codex review round 6).
        return { mediaId, alt: alt ?? "", contentHash };
      },
      resolveGallery: (galleryPath) => resolveGalleryForLanguage(galleryPath, language),
      // A source `<iframe>` carries no accessible name; the owner supplies one
      // per video id in the resolution file. Without an entry, the article is
      // refused rather than given an invented label.
      resolvePoll: (id) => legacyPolls.get(id),
      resolveYoutubeTitle: (videoId) => resolution.youtubeTitles?.[videoId],
    });
    finalConversions.push({
      article,
      result,
      sourceDigest: sourceRecordDigest(article),
    });
  }

  // Checked before the rest of the report is written: a conflict here means
  // `photograph-identities.json` would otherwise persist an arbitrary,
  // order-dependent choice between two different files for one identity — and
  // once written, a later run would inherit it as though it were settled
  // (found in Codex review round 8).
  //
  // The conflict *details* — private source locators, content hashes, and
  // full localized alt text — go into a mode-0600 report file, never to
  // stderr: this repo's own runbook is explicit that console output is
  // counts and digests only, private material stays in the report directory
  // (found leaking here in Codex review round 10). `options.out` is created
  // early, and only this one file is written before exiting — no
  // `findings.json`, no `photograph-identities.json`, so nothing else from
  // this run is mistaken for a usable result.
  if (identityConflicts.length > 0 || altTextConflicts.length > 0) {
    await mkdir(options.out, { recursive: true, mode: 0o700 });
    await writePrivateFile(
      path.join(options.out, "conflicts.json"),
      `${JSON.stringify({ identityConflicts, altTextConflicts }, null, 2)}\n`,
    );
    console.error(
      `${identityConflicts.length} photograph identity conflict(s) and ${altTextConflicts.length} alt-text conflict(s). See ${path.join(options.out, "conflicts.json")} — private migration material; keep it out of Git and out of shared evidence.`,
    );
    process.exit(1);
  }

  // Private migration material: source excerpts, dropped link targets, and now
  // the converted body itself, so an owner can review the actual transformed
  // article and gallery order before granting an approval (docs/sanity-seeding.md
  // says the reports carry this; the first cut of this tool only counted
  // blocks, found in Codex review round 2). Owner-only permissions, since a
  // typical umask would otherwise leave it world-readable.
  await mkdir(options.out, { recursive: true, mode: 0o700 });

  const findings = finalConversions.map((entry) => ({
    joomlaId: entry.article.joomlaId,
    language: normalizeLanguage(entry.article.language),
    title: entry.article.title,
    sourceDigest: entry.sourceDigest,
    // The value the owner copies into the manifest's `resolved_digest`
    // column: without printing it here, nothing could ever tell the owner
    // what to approve against. Recomputing it from `entry.result` — the same
    // way `buildImportPlan` will — rather than trusting a stored value is
    // what makes this report and the later plan check unable to drift apart.
    resolvedDigest: resolvedConversionDigest(entry.result),
    convertible: entry.result.convertible,
    blocks: entry.result.blocks,
    pollDocuments: entry.result.pollDocuments ?? [],
    endGallery: entry.result.endGallery,
    // Included so an owner reviewing a shared gallery across an fi/en pair
    // can see that each language actually got its own alt text, not one
    // string attributed to both (round-5 review finding).
    resolvedImageAltText: entry.result.resolvedImageAltText,
    findings: entry.result.findings,
  }));
  await writePrivateFile(path.join(options.out, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`);
  const persistedIdentities: PersistedPhotographIdentities = { byLocator: identities, byContentHash: contentHashIndex };
  await writePrivateFile(
    path.join(options.out, "photograph-identities.json"),
    `${JSON.stringify(persistedIdentities, null, 2)}\n`,
  );

  const refusalCounts = new Map<string, number>();
  const lossyCounts = new Map<string, number>();
  for (const entry of finalConversions) {
    for (const finding of entry.result.findings) {
      const target = finding.severity === "refusal" ? refusalCounts : lossyCounts;
      target.set(finding.code, (target.get(finding.code) ?? 0) + 1);
    }
  }

  const convertible = finalConversions.filter((entry) => entry.result.convertible).length;

  console.log(`Mode: ${options.mode}`);
  console.log(`Conversion policy: ${CONVERSION_POLICY_VERSION}`);
  console.log(`Source export digest: ${sourceExportDigest}`);
  if (review !== undefined) {
    console.log(`Manifest digest: ${review.digest}`);
    console.log(`Phase: ${review.phase} (known: ${review.knownPhases.join(", ") || "none"})`);
    console.log(`Manifest: ${review.approved.length} approved, ${review.deferred.length} deferred, ${review.errors.length} error(s)`);
  }
  console.log(`Articles converted: ${finalConversions.length}; convertible as-is: ${convertible}`);
  console.log("Refusals by reason:");
  for (const [code, count] of [...refusalCounts].sort()) console.log(`  ${code}: ${count}`);
  console.log("Lossy conversions by reason:");
  for (const [code, count] of [...lossyCounts].sort()) console.log(`  ${code}: ${count}`);
  console.log(`Photograph identities known: ${Object.keys(identities).length}`);

  if (options.mode === "plan" && review !== undefined) {
    const plan = buildImportPlan({
      phase: review.phase,
      manifestDigest: review.digest,
      sourceExportDigest,
      articles: finalConversions.flatMap((entry) => {
        const approval = approvalBySource.get(`${entry.article.joomlaId}:${normalizeLanguage(entry.article.language)}`);
        return approval === undefined
          ? []
          : [{
              approval,
              title: entry.article.title,
              ...(entry.article.summary === undefined ? {} : { summary: entry.article.summary }),
              ...(entry.article.author === undefined ? {} : { author: entry.article.author }),
              ...(entry.article.tags === undefined ? {} : { tags: entry.article.tags }),
              sourceDigest: entry.sourceDigest,
              conversion: entry.result,
            }];
      }),
      knownCategoryIds: options.categories,
      sourceLocators: locators,
      photographIdentities: identities,
    });
    await writePrivateFile(path.join(options.out, "import-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`Plan: ${plan.documents.length} document(s), ${plan.assetRequirements.length} asset requirement(s), ${plan.blocked.length} blocked, ${plan.errors.length} error(s)`);
    console.log(
      `Plan digest: ${plan.documentsDigest} — record this after reviewing the plan and pass it to write:joomla as --approved-digest to confirm this exact plan.`,
    );
    console.log("This plan is NOT writable:");
    for (const reason of plan.notWritableBecause) console.log(`  - ${reason}`);
    // The diagnostic artifact is still written above — an operator needs it to
    // see *why* — but a plan with a validation error or a blocked approved
    // article must not exit 0: automation (or an inattentive operator) reading
    // only the exit code would otherwise treat a failed launch plan as a
    // successful one (found in Codex review round 2).
    if (plan.errors.length > 0 || plan.blocked.length > 0) {
      console.error(
        `The plan is not clean: ${plan.errors.length} error(s), ${plan.blocked.length} blocked article(s). See ${path.join(options.out, "import-plan.json")}.`,
      );
      process.exitCode = 1;
    }
  }

  console.log(`\nReports written to ${options.out} — private migration material; keep it out of Git and out of shared evidence.`);
}

// Guarded so importing this module — a test covering the source-export
// contract does — does not execute the command. `import.meta.main` is Node's
// own entry-point signal (available on the pinned Node 24 major).
if (import.meta.main) {
  await main();
}

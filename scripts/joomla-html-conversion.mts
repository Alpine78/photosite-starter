/**
 * AB#137's Joomla body converter: one legacy article's HTML (plus Joomla's own
 * `{...}` plugin markers) into the Sanity content-block objects
 * `sanity/schemas/content-block.ts` declares.
 *
 * Pure and offline. No network, no filesystem, no credentials — the caller
 * supplies the source HTML and the three resolution callbacks below, so this
 * module can be exercised entirely from synthetic fixtures and never has to
 * see the owner's private migration material.
 *
 * ## Why an allow-list, and why refusals are first-class
 *
 * The legacy bodies are fifteen years of hand-written HTML, Joomla plugin
 * markers, and pasted Word markup. A converter that silently dropped what it
 * did not understand would publish quietly incomplete articles: the words that
 * survived would look correct, so nobody would go looking for the paragraph,
 * link, or photograph that did not. Every construct is therefore either
 * explicitly convertible, explicitly *lossy* (converted, with the loss
 * recorded), or a **refusal** that blocks its article from import until a human
 * resolves it. There is no fourth, silent category.
 *
 * Attributes are allow-listed the same way elements are, because an attribute
 * can carry behaviour the element alone does not: `style="display:none"` hides
 * content that would reappear on the new site, and an `onclick` is a script.
 * Presentational attributes are dropped with a `lossy` finding (the new site
 * owns its own design — that loss is intended); behavioural ones refuse.
 *
 * ## Why parse5
 *
 * Hand-rolled or regex HTML handling would undermine the allow-list guarantee
 * this module exists to make: unclosed tags, entities, and mixed content have
 * to be resolved the way a browser resolves them before "unsupported" means
 * anything. parse5 is the WHATWG-spec parser, a devDependency used only by this
 * owner-run migration tooling and never shipped in the application bundle
 * (`docs/asset-inventory.md`).
 *
 * The walk is over *mixed content in order* rather than over a parent's text:
 * reading `textContent` off a `<p>` would silently discard an `<img>` inside it
 * and duplicate the text of any nested element.
 *
 * Raw HTML is never emitted. Every block this module produces is a structured
 * Sanity object; no field carries markup.
 */

import type { ResolvedHistoricalPoll, HistoricalPollDocument } from "./joomla-polls.mts";
import { createHash } from "node:crypto";

import { parseFragment } from "parse5";

/**
 * Bump when a conversion rule changes in a way that could alter an already
 * reviewed body. An owner's acknowledgement of a lossy finding is bound to this
 * value (see `joomla-import-manifest.mts`), so a rule change invalidates a
 * stale approval instead of silently inheriting it.
 */
export const CONVERSION_POLICY_VERSION = "joomla-conversion-v2";

// ---------------------------------------------------------------------------
// Sanity content-block shapes
// ---------------------------------------------------------------------------

/**
 * Restated rather than imported, following the same convention
 * `sanity-seed-fixtures.mts` already uses: a `scripts/*.mts` module is
 * self-contained and imports nothing from the schema or application trees.
 * `joomla-html-conversion.test.mts` pins every name and bound below against
 * `sanity/schemas/content-block.ts`, so the two copies cannot drift.
 */
export const CONTENT_BLOCK_OBJECT_TYPES = {
  paragraph: "contentParagraphBlock",
  heading: "contentHeadingBlock",
  list: "contentListBlock",
  blockquote: "contentQuoteBlock",
  media: "contentMediaBlock",
  youtube: "contentYoutubeBlock",
  "mini-gallery": "contentGalleryBlock",
  table: "contentTableBlock",
  poll: "contentPollBlock",
} as const;

export const MAX_MINI_GALLERY_ITEMS = 12;
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 20;
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** A bounded excerpt of offending source, so a report is diagnosable without carrying a whole body. */
const MAX_FRAGMENT_LENGTH = 200;

export type SanityBlock = Readonly<Record<string, unknown>> & { readonly _type: string };

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * `refusal` blocks its article from import until a human resolves it.
 * `lossy` converts, but records exactly what did not survive, so an owner
 * acknowledges a specific transformation rather than a blanket "allow loss".
 */
export type ConversionFindingSeverity = "refusal" | "lossy";

export type ConversionFinding = {
  readonly severity: ConversionFindingSeverity;
  /** Stable machine-readable code; the manifest acknowledges these, not prose. */
  readonly code: ConversionFindingCode;
  readonly message: string;
  /** Bounded source excerpt. Private migration material — never shared evidence. */
  readonly fragment?: string;
};

export const REFUSAL_CODES = [
  "unsupported-element",
  "script-or-style",
  "hidden-content",
  "behavioural-attribute",
  "heading-level-unsupported",
  "heading-order",
  "empty-heading",
  "non-youtube-embed",
  "youtube-title-missing",
  "unknown-plugin-marker",
  "image-unresolved",
  "image-missing-alt",
  "gallery-unresolved",
  "gallery-empty",
  "gallery-inventory-mismatch",
  "multiple-end-galleries",
  "nested-list",
  "empty-list",
  "text-outside-list-item",
  "block-inside-quote-or-item",
  "table-headers-missing",
  "table-too-wide",
  "table-too-long",
  "table-ragged",
  "table-merged-cells",
  "table-header-outside-first-row",
  "empty-body",
] as const;

export const LOSSY_CODES = [
  "link-destination-dropped",
  "emphasis-dropped",
  "presentation-dropped",
  "anchor-id-dropped",
  "line-break-collapsed",
  "end-gallery-relocated",
  "ordered-list-start-dropped",
  "paragraph-boundary-flattened",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];
export type LossyCode = (typeof LOSSY_CODES)[number];
export type ConversionFindingCode = RefusalCode | LossyCode;

// ---------------------------------------------------------------------------
// Resolution contract supplied by the caller
// ---------------------------------------------------------------------------

/**
 * A photograph's stable identity, resolved from a source `src`. Deliberately
 * *not* derived here from the filename or traversal order: identity has to
 * survive a filename change, a re-upload, and a re-run (ADR-0002 §1), so the
 * caller owns a persisted source→identity map and this module only consumes it.
 */
export type ResolvedImage = {
  readonly mediaId: string;
  /** Required by the public media contract; a missing one refuses the article. */
  readonly alt?: string;
  /**
   * The verified SHA-256 of the actual file bytes behind this resolution, when
   * the caller checked it (`verifyApprovedGalleryFiles`-style). Folded into
   * `resolvedConversionDigest` so a file swapped in place — same locator, same
   * `mediaId`, different pixels, with its recorded hash updated to match —
   * still invalidates a stale approval (found in Codex review round 7): none
   * of `mediaId`, block structure, or alt text would otherwise change.
   */
  readonly contentHash?: string;
};

export type ResolvedGallery = {
  /** `mini` renders inline (≤ 12); `end` becomes the article's one end gallery. */
  readonly kind: "mini" | "end";
  /** The approved, ordered inventory — compared by identity, never by count alone. */
  readonly mediaIds: readonly string[];
  /** Alt text for every id in `mediaIds`, same order. The media contract requires one per photograph; a gallery is not exempt. */
  readonly altTextByMediaId: Readonly<Record<string, string>>;
  /** Verified content hash for every id in `mediaIds`, same purpose as `ResolvedImage.contentHash`. */
  readonly contentHashByMediaId?: Readonly<Record<string, string>>;
  readonly title?: string;
};

export type ConversionContext = {
  /** The article's own language subtag. Attributes each resolved image's alt text to it. */
  readonly language: string;
  /** `undefined` means "no approved identity for this source reference" → refusal. */
  readonly resolveImage: (src: string) => ResolvedImage | undefined;
  /** `undefined` means the gallery path is not in the approved decision sheet → refusal. */
  readonly resolveGallery: (path: string) => ResolvedGallery | undefined;
  /**
   * A source `<iframe>` carries no accessible name, but
   * `contentYoutubeBlock.title` is required and non-blank. The owner supplies
   * one per video id; without it the article is refused rather than given an
   * invented label.
   */
  readonly resolvePoll?: (legacyId: string) => ResolvedHistoricalPoll | undefined;
  readonly resolveYoutubeTitle?: (videoId: string) => string | undefined;
};

/** One resolved photograph's alt text, in the language this body was converted for. */
export type ResolvedImageAltText = {
  readonly mediaId: string;
  readonly language: string;
  readonly value: string;
};

/** One resolved photograph's verified content hash — see `ResolvedImage.contentHash`. */
export type ResolvedImageContentHash = {
  readonly mediaId: string;
  readonly contentHash: string;
};

export type ConversionResult = {
  readonly pollDocuments?: readonly HistoricalPollDocument[];
  readonly blocks: readonly SanityBlock[];
  readonly findings: readonly ConversionFinding[];
  /** Alt text for every photograph this body actually referenced, for the shared media document. */
  readonly resolvedImageAltText: readonly ResolvedImageAltText[];
  /**
   * Verified content hash for every photograph this body referenced whose
   * caller supplied one. Folded into `resolvedConversionDigest`; a photograph
   * the caller never hashed simply contributes nothing here, not a stale
   * placeholder.
   */
  readonly resolvedImageContentHashes: readonly ResolvedImageContentHash[];
  /** The article's one end gallery, when a `{gallery}` marker exceeded the inline bound. */
  readonly endGallery?: {
    readonly sourcePath: string;
    readonly mediaIds: readonly string[];
  };
  /** True when nothing refused. A `lossy` finding still needs an acknowledgement upstream. */
  readonly convertible: boolean;
};

// ---------------------------------------------------------------------------
// Element and attribute policy
// ---------------------------------------------------------------------------

/** Walked through: their children are converted in place, the element itself vanishes. */
const TRANSPARENT_ELEMENTS = new Set([
  "div", "section", "article", "main", "header", "footer", "aside", "center", "font", "tbody", "thead", "tfoot", "figure",
]);

const INLINE_ELEMENTS = new Set([
  "a", "strong", "b", "em", "i", "u", "s", "strike", "small", "sup", "sub", "code", "span", "abbr", "cite", "mark", "time",
]);

/** Never convertible: each is its own named refusal rather than a generic one. */
const SCRIPT_LIKE_ELEMENTS = new Set(["script", "style", "noscript"]);
const EMBED_ELEMENTS = new Set(["iframe", "object", "embed", "video", "audio", "canvas", "svg", "applet"]);

/**
 * Dropped with a `lossy` finding: presentation is the new site's own, so losing
 * it is the intended outcome rather than a defect.
 */
const PRESENTATIONAL_ATTRIBUTES = new Set([
  "class", "style", "align", "valign", "width", "height", "border", "cellpadding", "cellspacing",
  "bgcolor", "color", "face", "size", "hspace", "vspace", "dir", "lang", "title",
]);

/**
 * Consumed by the conversion itself; never "dropped" — but only on the
 * element that actually reads it. `STRUCTURAL_ATTRIBUTES` used to be one flat
 * set checked against every element regardless of tag, so `href` on a `<p>`
 * or `src` on an `<a>` — an attribute this converter never reads there — was
 * silently skipped by the same bypass a genuinely consumed attribute gets,
 * with no finding at all (found in Codex review round 9). Scoped per element
 * here instead: on any other tag, the same name falls through to the normal
 * classification (an `id` is still `anchor-id-dropped`, a presentational name
 * is still `presentation-dropped`, and anything else is refused as
 * `behavioural-attribute` rather than silently kept or dropped).
 */
const STRUCTURAL_ATTRIBUTES_BY_ELEMENT: Readonly<Record<string, ReadonlySet<string>>> = {
  img: new Set(["src", "alt"]),
  a: new Set(["href"]),
  iframe: new Set(["src"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  ol: new Set(["start", "type"]),
};

/**
 * Hides content that would reappear on the new site — a behaviour change, not
 * a style. Only checked `display:none`/`visibility:hidden` until Codex review
 * round 10 found the gap: `opacity:0`, `visibility:collapse`, and
 * `font-size:0` hide content exactly as effectively and were classified as
 * ordinary, acknowledgeable presentation instead — a real path for abandoned
 * or private legacy content to be silently republished. The opacity and
 * font-size branches require the value to be *exactly* zero (in any of its
 * common spellings — `0`, `0.0`, `.0`, `0%`, `0px`), not merely small, so
 * `opacity: 0.5` or `font-size: 10px` still classify as ordinary presentation.
 *
 * This is a deliberately bounded, pattern-based check for the common,
 * concretely-known hiding techniques — not a CSS parser, and not exhaustive.
 * A compound technique (`position:absolute;left:-9999px`,
 * `text-indent:-9999px`, `clip-path:inset(100%)`, `transform:scale(0)`)
 * still passes as ordinary presentation; closing that fully would need real
 * CSS parsing, which is out of proportion for a bounded migration tool. This
 * residual gap is named rather than silently assumed closed, the same way
 * every other unverified edge in this codebase is recorded rather than
 * claimed complete.
 */
const HIDING_STYLE =
  /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0*\.?0+%?(?=\s|;|$)|font-size\s*:\s*0(?:px|em|rem|%|pt)?(?=\s|;|$))/i;

// ---------------------------------------------------------------------------
// parse5 node shapes (structural subset — parse5 exposes these as unions)
// ---------------------------------------------------------------------------

type Attribute = { readonly name: string; readonly value: string };
type Node = {
  readonly nodeName: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: readonly Attribute[];
  readonly childNodes?: readonly Node[];
};

function isElement(node: Node): boolean {
  return typeof node.tagName === "string";
}

function isText(node: Node): boolean {
  return node.nodeName === "#text";
}

function attributesOf(node: Node): readonly Attribute[] {
  return node.attrs ?? [];
}

function attributeValue(node: Node, name: string): string | undefined {
  return attributesOf(node).find((attribute) => attribute.name === name)?.value;
}

function childrenOf(node: Node): readonly Node[] {
  return node.childNodes ?? [];
}

function excerpt(value: string): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length <= MAX_FRAGMENT_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_FRAGMENT_LENGTH)}…`;
}

function describeElement(node: Node): string {
  const attributes = attributesOf(node)
    .map((attribute) => ` ${attribute.name}="${excerpt(attribute.value)}"`)
    .join("");
  return `<${node.tagName ?? node.nodeName}${attributes}>`;
}

// ---------------------------------------------------------------------------
// Plugin markers
// ---------------------------------------------------------------------------

/** Joomla's paired form: `{gallery}stories/blogi/x{/gallery}`. */
const PAIRED_GALLERY_MARKER = /\{gallery\}([^{}]*)\{\/gallery\}/giu;
/** Joomla's inline form: `{gallery stories/blogi/x}`. */
const INLINE_GALLERY_MARKER = /\{gallery\s+([^{}]+)\}/giu;
/** Any other `{word …}` marker — `loadposition`, `loadmodule`, `contentpoll`, … */
const ANY_MARKER = /\{\/?([a-z][a-z0-9_-]*)\b[^{}]*\}/giu;

type MarkerSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "gallery"; readonly path: string; readonly source: string }
  | { readonly kind: "unknown-marker"; readonly name: string; readonly source: string };

/**
 * Splits one text node into ordered segments so a `{gallery}` marker sitting
 * between two sentences keeps its position in the body rather than being
 * hoisted or lost.
 */
export function splitPluginMarkers(text: string): readonly MarkerSegment[] {
  const matches: { start: number; end: number; segment: MarkerSegment }[] = [];

  for (const pattern of [PAIRED_GALLERY_MARKER, INLINE_GALLERY_MARKER]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (matches.some((existing) => start < existing.end && existing.start < start + match[0].length)) {
        continue; // already claimed by the paired form
      }
      matches.push({
        start,
        end: start + match[0].length,
        segment: { kind: "gallery", path: (match[1] ?? "").trim(), source: match[0] },
      });
    }
  }

  ANY_MARKER.lastIndex = 0;
  for (const match of text.matchAll(ANY_MARKER)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (matches.some((existing) => start < existing.end && existing.start < end)) continue;
    matches.push({
      start,
      end,
      segment: { kind: "unknown-marker", name: (match[1] ?? "").toLowerCase(), source: match[0] },
    });
  }

  matches.sort((left, right) => left.start - right.start);

  const segments: MarkerSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.start) });
    }
    segments.push(match.segment);
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

type InlineRun = { text: string };

class BodyConverter {
  private readonly blocks: SanityBlock[] = [];
  private readonly findings: ConversionFinding[] = [];
  private readonly inline: InlineRun = { text: "" };
  private headingLevel: number | undefined;
  private endGallery: { sourcePath: string; mediaIds: readonly string[] } | undefined;
  private readonly resolvedImageAltText: ResolvedImageAltText[] = [];
  private readonly resolvedImageContentHashes: ResolvedImageContentHash[] = [];
  /** Index in `blocks` at which the end-gallery marker was found, to detect relocation. */
  private endGalleryBlockIndex: number | undefined;
  /**
   * >0 while inside `captureFlatText` (a quote, list item, heading, table
   * cell, or caption). A `<p>` visited in this state must not spawn its own
   * block — a WYSIWYG editor commonly wraps even a single quoted paragraph or
   * list item in `<p>` (`<blockquote><p>…</p></blockquote>`), and refusing
   * that common, perfectly flattenable case was itself the defect (found in
   * Codex review round 8). A counter, not a boolean, because `captureFlatText`
   * can nest (a table cell's own capture while already inside a refused outer
   * capture is not reachable today, but a counter costs nothing and cannot be
   * accidentally left "on" by an early return the way a manually-reset
   * boolean could).
   */
  private flatTextCaptureDepth = 0;

  private readonly pollDocuments = new Map<string, HistoricalPollDocument>();
  private readonly context: ConversionContext;

  // An explicit field, not a parameter property: Node's native type stripping
  // rejects parameter properties, and Vitest's transpiler tolerates them — so
  // the latter would pass while `npm run convert:joomla` crashed (the same trap
  // `scripts/vercel-preview-api.mts` hit under AB#116).
  constructor(context: ConversionContext) {
    this.context = context;
  }

  refuse(code: RefusalCode, message: string, fragment?: string): void {
    this.findings.push({ severity: "refusal", code, message, ...(fragment === undefined ? {} : { fragment }) });
  }

  note(code: LossyCode, message: string, fragment?: string): void {
    this.findings.push({ severity: "lossy", code, message, ...(fragment === undefined ? {} : { fragment }) });
  }

  // --- inline buffering ----------------------------------------------------

  private appendInline(text: string): void {
    this.inline.text += text;
  }

  private flushParagraph(): void {
    const text = normalizeText(this.inline.text);
    this.inline.text = "";
    if (text.length === 0) return;
    this.blocks.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph, text });
  }

  private push(block: SanityBlock): void {
    this.flushParagraph();
    this.blocks.push(block);
  }

  // --- attribute policy ----------------------------------------------------

  /**
   * `reportPresentation: false` for a wrapper element that carries no content of
   * its own — a Joomla layout `<div>` has a class on essentially every instance,
   * and reporting each one as a dropped presentation would bury the findings
   * that describe real content. A behavioural attribute or hidden content on the
   * same element still refuses.
   *
   * `id`, deliberately, is **never** suppressed by this flag, even on a
   * transparent wrapper: `<div id="section">` is a common in-article anchor
   * target, and a dropped anchor id is a real, owner-acknowledgeable loss —
   * suppressing it there was itself a silent-fourth-category bug (found in
   * Codex review round 4), not a legitimate case of wrapper noise.
   */
  private checkAttributes(node: Node, reportPresentation = true): void {
    const tag = (node.tagName ?? "").toLowerCase();
    const structuralForThisElement = STRUCTURAL_ATTRIBUTES_BY_ELEMENT[tag];
    for (const attribute of attributesOf(node)) {
      const name = attribute.name.toLowerCase();
      if (structuralForThisElement?.has(name)) continue;

      if (name === "style" && HIDING_STYLE.test(attribute.value)) {
        this.refuse(
          "hidden-content",
          `${describeElement(node)} hides its content with a style rule. Hidden source content would become visible on the new site — decide explicitly whether it is published.`,
          excerpt(attribute.value),
        );
        continue;
      }

      if (name === "id") {
        this.note(
          "anchor-id-dropped",
          `Dropped the anchor id "${attribute.value}" from ${node.tagName}. Any inbound link to that fragment will no longer resolve.`,
          excerpt(attribute.value),
        );
        continue;
      }

      if (PRESENTATIONAL_ATTRIBUTES.has(name)) {
        if (!reportPresentation) continue;
        this.note(
          "presentation-dropped",
          `Dropped the presentational attribute ${name} from ${node.tagName}. The new site owns its own styling.`,
          excerpt(`${name}="${attribute.value}"`),
        );
        continue;
      }

      this.refuse(
        "behavioural-attribute",
        `${node.tagName} carries the attribute "${name}", which may change behaviour. Dropping it silently could alter what the page does.`,
        excerpt(`${name}="${attribute.value}"`),
      );
    }
  }

  /**
   * Runs `checkAttributes` on one node and reports whether it produced a
   * refusal, so a caller with no other attribute-bearing children to walk
   * (`<br>`, `<hr>`) can bail out the same way `visitTable`/`visitEmbed`
   * already do over a whole subtree.
   */
  private refusesOnAttributes(node: Node): boolean {
    const findingsBefore = this.findings.length;
    this.checkAttributes(node);
    return this.findings.slice(findingsBefore).some((finding) => finding.severity === "refusal");
  }

  // --- walking -------------------------------------------------------------

  convert(nodes: readonly Node[]): void {
    for (const node of nodes) this.visit(node);
    this.flushParagraph();
  }

  private visit(node: Node): void {
    if (isText(node)) {
      this.visitText(node.value ?? "");
      return;
    }
    if (!isElement(node)) return; // comments, doctypes: no content, no behaviour
    this.visitElement(node);
  }

  private visitText(raw: string): void {
    for (const segment of splitPluginMarkers(raw)) {
      if (segment.kind === "text") {
        this.appendInline(segment.text);
        continue;
      }
      if (segment.kind === "unknown-marker" && segment.name === "contentpoll") {
        const id = /^\{contentpoll(?:\s+id\s*=\s*|\s+)([1-9]\d{0,8})\s*\}$/iu.exec(segment.source)?.[1];
        const resolved = id === undefined ? undefined : this.context.resolvePoll?.(id);
        if (resolved && (resolved.poll.language === this.context.language || resolved.poll.language === "und")) {
          this.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.poll, poll: { _type: "reference", _ref: resolved.poll._id } });
          this.pollDocuments.set(resolved.poll._id, resolved.poll);
          this.pollDocuments.set(resolved.tally._id, resolved.tally);
          continue;
        }
      }
      if (segment.kind === "unknown-marker") {
        this.refuse(
          "unknown-plugin-marker",
          segment.name === "gallery"
            ? `An unpaired gallery marker ${segment.source} names no folder. A gallery has to be {gallery}path{/gallery} or {gallery path}.`
            : `The Joomla plugin marker {${segment.name}} has no equivalent on the new site. It must be converted by hand or removed deliberately.`,
          excerpt(segment.source),
        );
        continue;
      }
      this.visitGalleryMarker(segment.path, segment.source);
    }
  }

  private visitGalleryMarker(path: string, source: string): void {
    const resolved = this.context.resolveGallery(path);
    if (resolved === undefined) {
      this.refuse(
        "gallery-unresolved",
        `The gallery "${path}" is not in the approved decision sheet, so its images and order are unapproved.`,
        excerpt(source),
      );
      return;
    }
    if (resolved.mediaIds.length === 0) {
      this.refuse("gallery-empty", `The gallery "${path}" resolved to no images.`, excerpt(source));
      return;
    }

    const missingAlt = resolved.mediaIds.filter(
      (mediaId) => (resolved.altTextByMediaId[mediaId] ?? "").trim().length === 0,
    );
    if (missingAlt.length > 0) {
      this.refuse(
        "image-missing-alt",
        `${missingAlt.length} image(s) in the gallery "${path}" have no alternative text: ${missingAlt.slice(0, 3).join(", ")}${missingAlt.length > 3 ? ", …" : ""}.`,
        excerpt(source),
      );
      return;
    }
    for (const mediaId of resolved.mediaIds) {
      this.resolvedImageAltText.push({
        mediaId,
        language: this.context.language,
        value: resolved.altTextByMediaId[mediaId]!.trim(),
      });
      const contentHash = resolved.contentHashByMediaId?.[mediaId];
      if (contentHash !== undefined) {
        this.resolvedImageContentHashes.push({ mediaId, contentHash });
      }
    }

    if (resolved.kind === "mini") {
      if (resolved.mediaIds.length > MAX_MINI_GALLERY_ITEMS) {
        this.refuse(
          "gallery-inventory-mismatch",
          `The gallery "${path}" is marked for inline rendering but holds ${resolved.mediaIds.length} images, past the inline bound of ${MAX_MINI_GALLERY_ITEMS}.`,
          excerpt(source),
        );
        return;
      }
      this.push({
        _type: CONTENT_BLOCK_OBJECT_TYPES["mini-gallery"],
        ...(resolved.title === undefined ? {} : { title: resolved.title }),
        images: resolved.mediaIds.map((mediaId) => ({ media: mediaId })),
      });
      return;
    }

    if (this.endGallery !== undefined) {
      this.refuse(
        "multiple-end-galleries",
        `This article carries more than one gallery over the inline bound, but an article owns at most one end gallery (sanity/schemas/article.ts#endGalleryId).`,
        excerpt(source),
      );
      return;
    }
    this.flushParagraph();
    this.endGallery = { sourcePath: path, mediaIds: resolved.mediaIds };
    this.endGalleryBlockIndex = this.blocks.length;
  }

  private visitElement(node: Node): void {
    const tag = (node.tagName ?? "").toLowerCase();

    if (SCRIPT_LIKE_ELEMENTS.has(tag)) {
      this.refuse("script-or-style", `<${tag}> is never migrated.`, excerpt(textOf(node)));
      return;
    }

    if (EMBED_ELEMENTS.has(tag)) {
      this.visitEmbed(node, tag);
      return;
    }

    if (tag === "br") {
      // `<br>` and `<hr>` were the only two convertible elements that never
      // went through the attribute allow-list at all — `<br id="section">`
      // silently dropped a real anchor target, and `<br onclick="…">` would
      // have silently dropped real behaviour, with neither producing the
      // finding every other element's attributes already get (found in
      // Codex review round 11).
      if (this.refusesOnAttributes(node)) return;
      // A `<br>` inside prose is a line break the paragraph model has no way to
      // carry, so it collapses to a space rather than joining two words.
      this.appendInline(" ");
      this.note("line-break-collapsed", "A line break inside a paragraph collapsed to a space.");
      return;
    }

    if (tag === "hr") {
      if (this.refusesOnAttributes(node)) return;
      this.flushParagraph();
      this.note("presentation-dropped", "Dropped a horizontal rule; the new site has no such block.");
      return;
    }

    if (tag === "img") {
      this.checkAttributes(node);
      this.visitImage(node);
      return;
    }

    if (/^h[1-6]$/u.test(tag)) {
      this.checkAttributes(node);
      this.visitHeading(node, Number.parseInt(tag.slice(1), 10));
      return;
    }

    if (tag === "p") {
      this.checkAttributes(node);
      if (this.flatTextCaptureDepth > 0) {
        // Transparent here, not a block boundary: a quote or list item is one
        // flat string, so this paragraph's text joins whatever is already
        // buffered rather than becoming its own block. A space guards against
        // gluing two paragraphs into one word the way adjacent `<div>`s once
        // did (round 5); the boundary itself is recorded once, since multiple
        // paragraphs read as one continuous run is a real simplification, not
        // a lossless one.
        if (this.inline.text.length > 0 && !/\s$/u.test(this.inline.text)) {
          this.appendInline(" ");
          this.note("paragraph-boundary-flattened", "Joined a paragraph break inside a quote or list item into one line.");
        }
        this.convertChildren(node);
        return;
      }
      this.flushParagraph();
      this.convertChildren(node);
      this.flushParagraph();
      return;
    }

    if (tag === "blockquote") {
      this.checkAttributes(node);
      this.visitBlockquote(node);
      return;
    }

    if (tag === "ul" || tag === "ol") {
      this.checkAttributes(node);
      this.visitList(node, tag === "ol");
      return;
    }

    if (tag === "table") {
      this.checkAttributes(node);
      this.visitTable(node);
      return;
    }

    if (INLINE_ELEMENTS.has(tag)) {
      this.visitInlineElement(node, tag);
      return;
    }

    if (TRANSPARENT_ELEMENTS.has(tag)) {
      // A block-level wrapper's own boundary has to flush the paragraph
      // buffer on both sides: two adjacent `<div>`s with no paragraph tag
      // between them (ordinary, common Joomla layout markup) were otherwise
      // walked into one continuous inline buffer, silently concatenating
      // "First" and "Second" into "FirstSecond" with no space and no finding
      // (found in Codex review round 5).
      this.checkAttributes(node, false);
      this.flushParagraph();
      this.convertChildren(node);
      this.flushParagraph();
      return;
    }

    this.refuse(
      "unsupported-element",
      `<${tag}> has no equivalent in the shared content-block set (ADR-0003 decision 2).`,
      excerpt(describeElement(node)),
    );
  }

  private convertChildren(node: Node): void {
    for (const child of childrenOf(node)) this.visit(child);
  }

  /**
   * Walks a subtree that must flatten to plain text — a blockquote's contents or
   * a list item's — with its own inline buffer, and reports whether any child
   * emitted a *block*.
   *
   * A quote or an item cannot hold an image, a table, a nested heading, or a
   * gallery: the shared model has nowhere to put one. Converting it anyway
   * emitted the surrounding words twice (once as the stray paragraph the block
   * flushed, once inside the quote) and dropped the words before the block from
   * a list item — silent corruption of exactly the kind this module exists to
   * prevent. So any emitted block is undone and refused instead.
   */
  private captureFlatText(node: Node): { readonly text: string; readonly emittedBlocks: boolean } {
    const outerInline = this.inline.text;
    const blockCountBefore = this.blocks.length;
    // An oversized `{gallery}` marker mutates `this.endGallery` without ever
    // pushing a block (found in Codex review round 2): a gallery marker inside
    // a quote, heading, list item, or table cell was slipping past this
    // detection and silently relocating to the article's end instead of
    // producing the documented refusal.
    const endGalleryBefore = this.endGallery;
    const endGalleryBlockIndexBefore = this.endGalleryBlockIndex;
    this.inline.text = "";
    this.flatTextCaptureDepth += 1;
    try {
      this.convertChildren(node);
    } finally {
      this.flatTextCaptureDepth -= 1;
    }
    const text = normalizeText(this.inline.text);
    this.inline.text = outerInline;
    const emittedBlocks = this.blocks.length > blockCountBefore || this.endGallery !== endGalleryBefore;
    if (emittedBlocks) {
      this.blocks.length = blockCountBefore;
      this.endGallery = endGalleryBefore;
      this.endGalleryBlockIndex = endGalleryBlockIndexBefore;
    }
    return { text, emittedBlocks };
  }

  private visitInlineElement(node: Node, tag: string): void {
    this.checkAttributes(node);

    if (tag === "a") {
      const href = attributeValue(node, "href");
      const label = normalizeText(textOf(node));
      if (href !== undefined && href.trim().length > 0) {
        // The shared paragraph/list model carries plain strings with no inline
        // structure, so a link's *destination* cannot survive. Its words do —
        // which is exactly why this has to be reported: "download the
        // programme" still reads correctly while doing nothing.
        //
        // A `#fragment` link is not exempt: every `id` attribute is dropped
        // (`anchor-id-dropped`, above), unconditionally, so an in-page anchor's
        // target is always gone after conversion too — found in Codex review
        // round 3, which is right that the earlier carve-out assumed a target
        // could survive when nothing in this converter ever lets one.
        this.note(
          "link-destination-dropped",
          `The link target "${href.trim()}" was dropped; its text "${label}" remains as plain prose.`,
          excerpt(`${label} → ${href.trim()}`),
        );
      }
      this.convertChildren(node);
      return;
    }

    if (tag !== "span" && tag !== "time" && tag !== "abbr") {
      this.note("emphasis-dropped", `Dropped <${tag}> emphasis; its text remains.`, excerpt(textOf(node)));
    }
    this.convertChildren(node);
  }

  private visitImage(node: Node): void {
    const src = attributeValue(node, "src");
    if (src === undefined || src.trim().length === 0) {
      this.refuse("image-unresolved", "An image carries no source reference.", excerpt(describeElement(node)));
      return;
    }
    const resolved = this.context.resolveImage(src.trim());
    if (resolved === undefined) {
      this.refuse(
        "image-unresolved",
        `The image "${src.trim()}" has no approved photograph identity. Its file may be missing, or it may not be approved for publication.`,
        excerpt(src.trim()),
      );
      return;
    }
    const alt = resolved.alt ?? attributeValue(node, "alt");
    if (alt === undefined || alt.trim().length === 0) {
      this.refuse(
        "image-missing-alt",
        `The image "${src.trim()}" has no alternative text. The public media contract requires one; it is not invented here.`,
        excerpt(src.trim()),
      );
      return;
    }
    this.resolvedImageAltText.push({ mediaId: resolved.mediaId, language: this.context.language, value: alt.trim() });
    if (resolved.contentHash !== undefined) {
      this.resolvedImageContentHashes.push({ mediaId: resolved.mediaId, contentHash: resolved.contentHash });
    }
    this.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.media, media: resolved.mediaId });
  }

  private visitHeading(node: Node, level: number): void {
    // Walked through `captureFlatText`, not bare `textOf`: a heading holds
    // plain text only, so an embedded image, table, or nested heading has to
    // be refused rather than silently flattened into the heading's words —
    // `textOf` alone would have dropped it with no finding at all.
    const { text, emittedBlocks } = this.captureFlatText(node);
    if (emittedBlocks) {
      this.refuse(
        "block-inside-quote-or-item",
        `<h${level}> contains an image, table, list, or gallery. A heading holds plain text only, so this has to be restructured by hand.`,
        excerpt(textOf(node)),
      );
      return;
    }
    if (level === 1 || level > 4) {
      this.refuse(
        "heading-level-unsupported",
        `<h${level}> cannot be migrated: the page title owns h1 and the body supports levels 2–4 only (AB#21).`,
        excerpt(text),
      );
      return;
    }
    if (text.length === 0) {
      // The Studio schema requires non-blank heading text (`nonBlank`); an
      // empty `<h2></h2>` would otherwise publish a document the schema
      // itself would refuse.
      this.refuse("empty-heading", `<h${level}> has no text.`, excerpt(describeElement(node)));
      return;
    }
    // Restates `validatesSemanticHeadingOrder` in sanity/schemas/content-block.ts:
    // a body whose headings the Studio would reject is refused here rather than
    // written and rejected later.
    if (this.headingLevel === undefined) {
      if (level !== 2) {
        this.refuse(
          "heading-order",
          `The body's first heading is level ${level}; it must be level 2 because the page title owns h1.`,
          excerpt(text),
        );
        return;
      }
    } else if (level > this.headingLevel + 1) {
      this.refuse(
        "heading-order",
        `A heading skips from level ${this.headingLevel} to level ${level}. A heading may stay level, descend one level, or return to any shallower level.`,
        excerpt(text),
      );
      return;
    }
    this.headingLevel = level;
    this.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level, text });
  }

  private visitBlockquote(node: Node): void {
    const { text, emittedBlocks } = this.captureFlatText(node);
    if (emittedBlocks) {
      this.refuse(
        "block-inside-quote-or-item",
        "A blockquote contains an image, table, list, heading, or gallery. A quote holds plain text only, so this has to be restructured by hand.",
        excerpt(textOf(node)),
      );
      return;
    }
    if (text.length === 0) {
      this.note("presentation-dropped", "Dropped an empty blockquote.");
      return;
    }
    this.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.blockquote, text });
  }

  private visitList(node: Node, ordered: boolean): void {
    // `<ol start="…">`/`type="…"` changes the rendered numbering; the shared
    // list block has no field for it (found in Codex review round 2 — it was
    // silently renumbering from 1 with no finding).
    const start = attributeValue(node, "start");
    if (ordered && start !== undefined && start.trim() !== "" && start.trim() !== "1") {
      this.note(
        "ordered-list-start-dropped",
        `Dropped start="${start.trim()}"; the list will render numbered from 1.`,
        excerpt(describeElement(node)),
      );
    }
    const listType = attributeValue(node, "type");
    if (ordered && listType !== undefined && listType.trim() !== "" && listType.trim() !== "1") {
      this.note(
        "ordered-list-start-dropped",
        `Dropped type="${listType.trim()}"; the list will render with Arabic numerals.`,
        excerpt(describeElement(node)),
      );
    }

    const items: string[] = [];
    let sawNonWhitespaceText = false;
    for (const child of childrenOf(node)) {
      if (isText(child)) {
        if ((child.value ?? "").trim().length > 0) sawNonWhitespaceText = true;
        continue;
      }
      if (!isElement(child)) continue;
      const tag = (child.tagName ?? "").toLowerCase();
      if (tag !== "li") {
        this.refuse("unsupported-element", `<${tag}> is not a list item.`, excerpt(describeElement(child)));
        return;
      }
      if (childrenOf(child).some((grandchild) => {
        const name = (grandchild.tagName ?? "").toLowerCase();
        return name === "ul" || name === "ol";
      })) {
        this.refuse(
          "nested-list",
          "A nested list has no equivalent: the shared list block is flat. Flattening it would change the authored structure.",
          excerpt(textOf(child)),
        );
        return;
      }
      this.checkAttributes(child);
      const { text, emittedBlocks } = this.captureFlatText(child);
      if (emittedBlocks) {
        this.refuse(
          "block-inside-quote-or-item",
          "A list item contains an image, table, heading, or gallery. A list item holds plain text only, so this has to be restructured by hand.",
          excerpt(textOf(child)),
        );
        return;
      }
      if (text.length === 0) {
        this.refuse("empty-list", "A list item is empty; the schema rejects a blank item.", excerpt(describeElement(child)));
        return;
      }
      items.push(text);
    }
    if (items.length === 0) {
      this.refuse("empty-list", "A list holds no items.", excerpt(describeElement(node)));
      return;
    }
    if (sawNonWhitespaceText) {
      this.refuse(
        "text-outside-list-item",
        "The list has text sitting directly inside it, outside any <li>. Restructure it by hand so nothing is silently dropped.",
        excerpt(describeElement(node)),
      );
      return;
    }
    this.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.list, ordered, items });
  }

  private visitEmbed(node: Node, tag: string): void {
    if (tag !== "iframe") {
      this.refuse(
        "non-youtube-embed",
        `<${tag}> is not migrated: the only supported embed is a click-to-load YouTube player (privacy by default).`,
        excerpt(describeElement(node)),
      );
      return;
    }
    // Every other element's attributes go through the same allow-list before
    // its content converts; an iframe was skipping this, which let an
    // `onload` or a hiding style through unreported once the video id and
    // title resolved (found in Codex review round 1).
    const findingsBefore = this.findings.length;
    this.checkAttributes(node);
    if (this.findings.slice(findingsBefore).some((finding) => finding.severity === "refusal")) return;

    const src = attributeValue(node, "src") ?? "";
    const videoId = extractYoutubeVideoId(src);
    if (videoId === undefined) {
      this.refuse(
        "non-youtube-embed",
        `The embedded frame "${excerpt(src)}" is not a YouTube video. A third-party embed would load on its own, which this site does not do.`,
        excerpt(src),
      );
      return;
    }
    const title = this.context.resolveYoutubeTitle?.(videoId);
    if (title === undefined || title.trim().length === 0) {
      this.refuse(
        "youtube-title-missing",
        `The YouTube video ${videoId} needs an accessible title for its load button; the source frame carries none and one is not invented here.`,
        videoId,
      );
      return;
    }
    this.push({ _type: CONTENT_BLOCK_OBJECT_TYPES.youtube, videoId, title: title.trim() });
  }

  private visitTable(node: Node): void {
    // Every table descendant goes through the same attribute allow-list as
    // everything else — a `<td style="display:none">` or an `onclick` on a
    // `<tr>` was reaching the output unrefused, found in Codex review round 2.
    const findingsBefore = this.findings.length;
    // `<colgroup>`/`<col>` carry no text to lose, only attributes (typically
    // a column width) — but an attribute silently ignored is still a silent
    // drop, and this pair was reaching neither the row/cell walk nor the
    // section walk below (found in Codex review round 7).
    for (const child of childrenOf(node)) {
      if (!isElement(child)) continue;
      const tag = (child.tagName ?? "").toLowerCase();
      if (tag !== "colgroup") continue;
      this.checkAttributes(child);
      for (const col of childrenOf(child)) {
        if (isElement(col) && (col.tagName ?? "").toLowerCase() === "col") this.checkAttributes(col);
      }
    }
    for (const sectionElement of findTableSectionElements(node)) {
      this.checkAttributes(sectionElement);
    }
    const rowElements = findTableRowElements(node);
    for (const rowElement of rowElements) {
      this.checkAttributes(rowElement);
      for (const cell of childrenOf(rowElement)) {
        if (!isElement(cell)) continue;
        const tag = (cell.tagName ?? "").toLowerCase();
        if (tag === "th" || tag === "td") this.checkAttributes(cell);
      }
    }
    const captionElementForAttributes = findCaptionElement(node);
    if (captionElementForAttributes !== undefined) this.checkAttributes(captionElementForAttributes);
    if (this.findings.slice(findingsBefore).some((finding) => finding.severity === "refusal")) return;

    const rows = collectTableRows(node);
    if (rows.length === 0) {
      this.refuse("table-headers-missing", "A table holds no rows.", excerpt(describeElement(node)));
      return;
    }
    for (const row of rows) {
      for (const cell of row) {
        const span = attributeValue(cell, "colspan") ?? attributeValue(cell, "rowspan");
        if (span !== undefined && span.trim() !== "" && span.trim() !== "1") {
          this.refuse(
            "table-merged-cells",
            "A table has merged cells. The shared table block is strictly rectangular, so a merge cannot be represented without changing the data.",
            excerpt(describeElement(cell)),
          );
          return;
        }
      }
    }

    const [first, ...rest] = rows;
    const headerRow = first ?? [];
    const allHeaderCells = headerRow.every((cell) => (cell.tagName ?? "").toLowerCase() === "th");
    if (!allHeaderCells) {
      this.refuse(
        "table-headers-missing",
        "The table's first row is not a header row. The shared table block requires one non-empty header per column; inventing headers would label the data with words nobody wrote.",
        excerpt(describeElement(node)),
      );
      return;
    }
    // Walked through `captureFlatText`, not bare `textOf`: a cell holds plain
    // text only, so an embedded image, table, or script has to be refused
    // rather than silently flattened — bare `textOf` would turn a
    // `<script>alert(1)</script>` cell into ordinary-looking text with no
    // refusal at all.
    const headerCapture = headerRow.map((cell) => this.captureFlatText(cell));
    if (headerCapture.some((entry) => entry.emittedBlocks)) {
      this.refuse(
        "block-inside-quote-or-item",
        "A table header contains an image, table, list, or gallery. A cell holds plain text only.",
        excerpt(describeElement(node)),
      );
      return;
    }
    const headers = headerCapture.map((entry) => entry.text);
    if (headers.length === 0 || headers.some((header) => header.length === 0)) {
      this.refuse("table-headers-missing", "A column header is empty.", excerpt(headers.join(" | ")));
      return;
    }
    if (headers.length > MAX_TABLE_COLUMNS) {
      this.refuse(
        "table-too-wide",
        `The table has ${headers.length} columns, past the bound of ${MAX_TABLE_COLUMNS}.`,
        excerpt(headers.join(" | ")),
      );
      return;
    }
    if (rest.length > MAX_TABLE_ROWS) {
      this.refuse(
        "table-too-long",
        `The table has ${rest.length} body rows, past the bound of ${MAX_TABLE_ROWS}.`,
        excerpt(describeElement(node)),
      );
      return;
    }
    const bodyRows: { cells: string[] }[] = [];
    for (const row of rest) {
      if (row.length !== headers.length) {
        // A short row is a defect, not authored content: every later cell would
        // sit under the wrong header.
        this.refuse(
          "table-ragged",
          `A table row has ${row.length} cells but the table has ${headers.length} columns. Every later cell would fall under the wrong header.`,
          excerpt(row.map((cell) => textOf(cell)).join(" | ")),
        );
        return;
      }
      // A `<th>` past the first row — a second header row, or a row-header
      // cell — carries header semantics the shared table block has no field
      // for; treating it as an ordinary `<td>` would silently publish it as
      // plain data with no record that it was ever a header (found in Codex
      // review round 8).
      if (row.some((cell) => (cell.tagName ?? "").toLowerCase() === "th")) {
        this.refuse(
          "table-header-outside-first-row",
          "A <th> appears outside the table's first row (a second header row, or a row header). The shared table block has one header row only.",
          excerpt(row.map((cell) => textOf(cell)).join(" | ")),
        );
        return;
      }
      const cellCapture = row.map((cell) => this.captureFlatText(cell));
      if (cellCapture.some((entry) => entry.emittedBlocks)) {
        this.refuse(
          "block-inside-quote-or-item",
          "A table cell contains an image, table, list, or gallery. A cell holds plain text only.",
          excerpt(row.map((cell) => textOf(cell)).join(" | ")),
        );
        return;
      }
      bodyRows.push({ cells: cellCapture.map((entry) => entry.text) });
    }
    if (bodyRows.length === 0) {
      this.refuse("table-ragged", "A table has headers but no body rows.", excerpt(headers.join(" | ")));
      return;
    }

    const captionElement = findCaptionElement(node);
    let caption: string | undefined;
    if (captionElement !== undefined) {
      const captured = this.captureFlatText(captionElement);
      if (captured.emittedBlocks) {
        this.refuse(
          "block-inside-quote-or-item",
          "A table caption contains an image, table, list, or gallery. A caption holds plain text only.",
          excerpt(textOf(captionElement)),
        );
        return;
      }
      caption = captured.text.length === 0 ? undefined : captured.text;
    }
    this.push({
      _type: CONTENT_BLOCK_OBJECT_TYPES.table,
      ...(caption === undefined ? {} : { caption }),
      headers,
      rows: bodyRows,
    });
  }

  finish(): ConversionResult {
    this.flushParagraph();

    if (this.endGallery !== undefined && this.endGalleryBlockIndex !== undefined) {
      if (this.endGalleryBlockIndex < this.blocks.length) {
        // The marker sat mid-body, but an end gallery renders after the whole
        // body (AB#161). Moving it changes the reading order the author chose.
        this.note(
          "end-gallery-relocated",
          `The gallery "${this.endGallery.sourcePath}" appeared before the end of the body but renders after it. Confirm the reading order is still the intended one.`,
          this.endGallery.sourcePath,
        );
      }
    }

    if (this.blocks.length === 0) {
      this.refuse(
        "empty-body",
        "The conversion produced no blocks. An article's body is required and must hold at least one block.",
      );
    }

    const convertible = !this.findings.some((finding) => finding.severity === "refusal");
    return {
      blocks: this.blocks,
      ...(this.pollDocuments.size === 0 ? {} : { pollDocuments: [...this.pollDocuments.values()] }),
      findings: this.findings,
      resolvedImageAltText: this.resolvedImageAltText,
      resolvedImageContentHashes: this.resolvedImageContentHashes,
      ...(this.endGallery === undefined ? {} : { endGallery: this.endGallery }),
      convertible,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collapses whitespace the way HTML rendering does. Entities are already decoded by parse5. */
export function normalizeText(value: string): string {
  return value.replace(/ /gu, " ").replace(/\s+/gu, " ").trim();
}

/** Ordered text of a subtree, for a label or a cell — never for deciding what converts. */
function textOf(node: Node): string {
  if (isText(node)) return node.value ?? "";
  return childrenOf(node).map(textOf).join("");
}

/** Every `<thead>`/`<tbody>`/`<tfoot>` wrapper directly under a table. */
function findTableSectionElements(node: Node): readonly Node[] {
  return childrenOf(node).filter((child) => {
    const tag = (child.tagName ?? "").toLowerCase();
    return tag === "thead" || tag === "tbody" || tag === "tfoot";
  });
}

/** Every `<tr>` element in a table, wherever it sits under thead/tbody/tfoot. */
function findTableRowElements(node: Node): readonly Node[] {
  const rows: Node[] = [];
  const walk = (current: Node): void => {
    for (const child of childrenOf(current)) {
      if (!isElement(child)) continue;
      const tag = (child.tagName ?? "").toLowerCase();
      if (tag === "tr") rows.push(child);
      else if (tag === "thead" || tag === "tbody" || tag === "tfoot") walk(child);
    }
  };
  walk(node);
  return rows;
}

function collectTableRows(node: Node): readonly (readonly Node[])[] {
  const rows: Node[] = [];
  const walk = (current: Node): void => {
    for (const child of childrenOf(current)) {
      if (!isElement(child)) continue;
      const tag = (child.tagName ?? "").toLowerCase();
      if (tag === "tr") rows.push(child);
      else if (tag === "thead" || tag === "tbody" || tag === "tfoot") walk(child);
    }
  };
  walk(node);
  return rows.map((row) =>
    childrenOf(row).filter((cell) => {
      const tag = (cell.tagName ?? "").toLowerCase();
      return tag === "th" || tag === "td";
    }),
  );
}

function findCaptionElement(node: Node): Node | undefined {
  return childrenOf(node).find((child) => (child.tagName ?? "").toLowerCase() === "caption");
}

/**
 * Accepts the frame URL shapes a Joomla body actually carries and nothing else.
 * A non-YouTube frame must fall through to a refusal rather than be coerced.
 */
export function extractYoutubeVideoId(src: string): string | undefined {
  let url: URL;
  try {
    url = new URL(src.trim(), "https://example.invalid");
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./u, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : undefined;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return undefined;
  const embedMatch = /^\/(?:embed|v)\/([^/?#]+)/u.exec(url.pathname);
  const id = embedMatch?.[1] ?? url.searchParams.get("v") ?? "";
  return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : undefined;
}

/**
 * SHA-256 over the *resolved output* of a conversion — its blocks, its end
 * gallery, and every resolved photograph's alt text — not the source HTML.
 *
 * This exists because `sourceRecordDigest` (in `convert-joomla-content.mts`)
 * only covers what the owner-supplied source article itself says; it cannot
 * see a change to `resolution.json` — a different photograph substituted for
 * the same `src`, an edited alt text, a reordered or reclassified gallery, or
 * a changed YouTube title. All of those are owner-approved inputs
 * (`docs/sanity-seeding.md`'s resolution-file contract) exactly as much as the
 * article text is, and an edit to any of them changes what would actually
 * publish without touching the source record at all. Binding approval to this
 * digest too closes that gap (found in Codex review round 6).
 */
export function resolvedConversionDigest(result: ConversionResult): string {
  const canonical = JSON.stringify({
    blocks: result.blocks,
    ...(result.pollDocuments === undefined ? {} : { pollDocuments: [...result.pollDocuments].sort((a, b) => a._id.localeCompare(b._id)) }),
    endGallery: result.endGallery ?? null,
    // Order-independent: two runs resolving the same images in a different
    // Map iteration order must not spuriously invalidate an approval.
    resolvedImageAltText: [...result.resolvedImageAltText].sort((left, right) =>
      `${left.mediaId}:${left.language}`.localeCompare(`${right.mediaId}:${right.language}`),
    ),
    // Closes a real gap (found in Codex review round 7): swapping a file's
    // bytes in place while updating its recorded hash to match left `mediaId`,
    // block structure, and alt text all unchanged, so the digest never moved
    // and a stale approval kept covering different pixels.
    resolvedImageContentHashes: [...result.resolvedImageContentHashes].sort((left, right) =>
      left.mediaId.localeCompare(right.mediaId),
    ),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Converts one Joomla article body. Never throws on bad markup: parse5 repairs
 * what a browser would repair, and anything still unconvertible becomes a
 * refusal in the result.
 */
export function convertJoomlaBody(html: string, context: ConversionContext): ConversionResult {
  const fragment = parseFragment(html) as unknown as Node;
  const converter = new BodyConverter(context);
  converter.convert(childrenOf(fragment));
  return converter.finish();
}

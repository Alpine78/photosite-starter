/**
 * Covers `joomla-html-conversion.mts` against synthetic fixtures only — no
 * private migration material, no filesystem, no network. Every fixture below is
 * written by hand in this file precisely so the suite can run in CI on a clone
 * that has never seen the owner's source site.
 */

import { describe, expect, it } from "vitest";

import {
  CONTENT_BLOCK_OBJECT_TYPES,
  CONVERSION_POLICY_VERSION,
  convertJoomlaBody,
  extractYoutubeVideoId,
  LOSSY_CODES,
  MAX_MINI_GALLERY_ITEMS,
  MAX_TAB_GROUP_TABS,
  MAX_TAB_LABEL_LENGTH,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MIN_TAB_GROUP_TABS,
  normalizeText,
  REFUSAL_CODES,
  resolvedConversionDigest,
  splitPluginMarkers,
  YOUTUBE_VIDEO_ID_PATTERN,
  type ConversionContext,
  type ConversionResult,
} from "./joomla-html-conversion.mts";
import {
  CONTENT_BLOCK_OBJECT_TYPES as SCHEMA_OBJECT_TYPES,
  MAX_MINI_GALLERY_ITEMS as SCHEMA_MAX_MINI_GALLERY_ITEMS,
  MAX_TAB_GROUP_TABS as SCHEMA_MAX_TAB_GROUP_TABS,
  MAX_TAB_LABEL_LENGTH as SCHEMA_MAX_TAB_LABEL_LENGTH,
  MAX_TABLE_COLUMNS as SCHEMA_MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS as SCHEMA_MAX_TABLE_ROWS,
  MIN_TAB_GROUP_TABS as SCHEMA_MIN_TAB_GROUP_TABS,
  YOUTUBE_VIDEO_ID_PATTERN as SCHEMA_YOUTUBE_PATTERN,
} from "../sanity/schemas/content-block";

function altTextFor(mediaIds: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(mediaIds.map((mediaId) => [mediaId, `Alt ${mediaId}`]));
}

const context: ConversionContext = {
  language: "fi",
  resolveImage: (src) =>
    src.includes("known") ? { mediaId: `media-${src.replace(/\W/gu, "-")}`, alt: "Kuvateksti" } : undefined,
  resolveGallery: (path) => {
    if (path === "stories/small") {
      return { kind: "mini", mediaIds: ["a", "b", "c"], altTextByMediaId: altTextFor(["a", "b", "c"]) };
    }
    if (path === "stories/large") {
      const mediaIds = Array.from({ length: 32 }, (_, index) => `large-${index}`);
      return { kind: "end", mediaIds, altTextByMediaId: altTextFor(mediaIds) };
    }
    if (path === "stories/empty") return { kind: "mini", mediaIds: [], altTextByMediaId: {} };
    if (path === "stories/oversized-inline") {
      const mediaIds = Array.from({ length: 13 }, (_, index) => `x-${index}`);
      return { kind: "mini", mediaIds, altTextByMediaId: altTextFor(mediaIds) };
    }
    if (path === "stories/missing-alt") {
      return { kind: "mini", mediaIds: ["m1", "m2"], altTextByMediaId: { m1: "Alt" } };
    }
    return undefined;
  },
  resolveYoutubeTitle: (videoId) => (videoId === "dQw4w9WgXcQ" ? "Esittelyvideo" : undefined),
};

function convert(html: string, overrides?: Partial<ConversionContext>): ConversionResult {
  return convertJoomlaBody(html, { ...context, ...overrides });
}

function codes(result: ConversionResult, severity: "refusal" | "lossy"): readonly string[] {
  return result.findings.filter((finding) => finding.severity === severity).map((finding) => finding.code);
}

describe("round-11 review finding: <br> and <hr> go through the attribute allow-list too", () => {
  it("records a dropped anchor id on <br>, not just a line-break-collapsed note", () => {
    const result = convert('<p>rivi<br id="anchor">toinen</p>');
    expect(result.convertible).toBe(true);
    expect(codes(result, "lossy")).toEqual(["anchor-id-dropped", "line-break-collapsed"]);
  });

  it("refuses a behavioural attribute on <br>", () => {
    const result = convert('<p>a<br onclick="evil()">b</p>');
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("refuses a behavioural attribute on <hr>", () => {
    const result = convert('<p>a</p><hr onclick="evil()"><p>b</p>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("still converts a plain <br>/<hr> with no attributes exactly as before", () => {
    const result = convert("<p>rivi<br>toinen</p><p>a</p><hr><p>b</p>");
    expect(result.convertible).toBe(true);
    expect(codes(result, "lossy")).toEqual(["line-break-collapsed", "presentation-dropped"]);
  });
});

describe("round-7 review finding: resolvedConversionDigest also covers each resolved photograph's content hash", () => {
  it("changes when a loose image's content hash changes, mediaId and alt text unchanged", () => {
    const a = convert('<p><img src="known-1.jpg"></p>', {
      resolveImage: () => ({ mediaId: "media-images-known-1-jpg", alt: "Kuvateksti", contentHash: "a".repeat(64) }),
    });
    const b = convert('<p><img src="known-1.jpg"></p>', {
      resolveImage: () => ({ mediaId: "media-images-known-1-jpg", alt: "Kuvateksti", contentHash: "b".repeat(64) }),
    });
    expect(resolvedConversionDigest(a)).not.toBe(resolvedConversionDigest(b));
  });

  it("changes when a gallery photograph's content hash changes, everything else unchanged", () => {
    const a = convert("{gallery}stories/small{/gallery}", {
      resolveGallery: () => ({
        kind: "mini",
        mediaIds: ["a", "b", "c"],
        altTextByMediaId: altTextFor(["a", "b", "c"]),
        contentHashByMediaId: { a: "1".repeat(64), b: "2".repeat(64), c: "3".repeat(64) },
      }),
    });
    const b = convert("{gallery}stories/small{/gallery}", {
      resolveGallery: () => ({
        kind: "mini",
        mediaIds: ["a", "b", "c"],
        altTextByMediaId: altTextFor(["a", "b", "c"]),
        contentHashByMediaId: { a: "1".repeat(64), b: "different-hash".padEnd(64, "0"), c: "3".repeat(64) },
      }),
    });
    expect(resolvedConversionDigest(a)).not.toBe(resolvedConversionDigest(b));
  });

  it("is unaffected by a caller that never supplies a content hash at all", () => {
    const a = convert('<p><img src="known-1.jpg"></p>');
    expect(a.resolvedImageContentHashes).toEqual([]);
    expect(resolvedConversionDigest(a)).toBe(resolvedConversionDigest(convert('<p><img src="known-1.jpg"></p>')));
  });
});

describe("round-8 review finding: a <th> outside the table's first row is refused, not silently demoted to data", () => {
  it("refuses a second header row", () => {
    const result = convert("<table><tr><th>A</th><th>B</th></tr><tr><th>C</th><th>D</th></tr></table>");
    expect(codes(result, "refusal")).toContain("table-header-outside-first-row");
  });

  it("refuses a row-header cell", () => {
    const result = convert("<table><tr><th>A</th><th>B</th></tr><tr><th>Row header</th><td>data</td></tr></table>");
    expect(codes(result, "refusal")).toContain("table-header-outside-first-row");
  });

  it("still converts an ordinary table with header cells only in the first row", () => {
    const result = convert("<table><tr><th>A</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>");
    expect(result.convertible).toBe(true);
    expect(result.blocks[0]).toMatchObject({ headers: ["A"], rows: [{ cells: ["1"] }, { cells: ["2"] }] });
  });
});

describe("round-9 review finding: a structural attribute is only accepted on the element that actually consumes it", () => {
  it("refuses href on a <p> rather than silently dropping it", () => {
    const result = convert('<p href="https://evil.example">Teksti</p>');
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("refuses src on an <a>", () => {
    const result = convert('<a src="https://evil.example">Link</a>');
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("refuses start/type on a <ul> (only <ol> owns list numbering)", () => {
    const result = convert('<ul start="5"><li>a</li></ul>');
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("still accepts every legitimately consumed structural attribute", () => {
    const img = convert('<p><img src="known-1.jpg"></p>');
    expect(img.convertible).toBe(true);
    const a = convert('<p>Katso <a href="/x">linkki</a>.</p>');
    expect(a.convertible).toBe(true);
    const ol = convert('<ol start="5" type="1"><li>a</li></ol>');
    expect(ol.convertible).toBe(true);
    const table = convert('<table><tr><th colspan="1">A</th></tr><tr><td>1</td></tr></table>');
    expect(table.convertible).toBe(true);
  });
});

describe("round-8 review finding: a single <p> wrapper inside a quote or list item is accepted, not over-refused", () => {
  it("flattens a lone paragraph inside a blockquote", () => {
    const result = convert("<blockquote><p>Quoted prose.</p></blockquote>");
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([{ _type: "contentQuoteBlock", text: "Quoted prose." }]);
    expect(result.findings).toEqual([]);
  });

  it("flattens a lone paragraph inside a list item", () => {
    const result = convert("<ul><li><p>List item.</p></li></ul>");
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([{ _type: "contentListBlock", ordered: false, items: ["List item."] }]);
    expect(result.findings).toEqual([]);
  });

  it("joins two paragraphs in a quote with a space and records the flattened boundary", () => {
    const result = convert("<blockquote><p>First.</p><p>Second.</p></blockquote>");
    expect(result.blocks).toEqual([{ _type: "contentQuoteBlock", text: "First. Second." }]);
    expect(codes(result, "lossy")).toContain("paragraph-boundary-flattened");
  });

  it("still refuses genuinely unrepresentable content nested inside the paragraph", () => {
    const result = convert('<blockquote><p>Text <img src="known-1.jpg"></p></blockquote>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
    expect(result.blocks).toEqual([]);
  });

  it("does not let a flattened paragraph inside a quote leak a stray top-level paragraph block", () => {
    // Regression guard for the mechanism itself: before the fix, visiting the
    // inner <p> unconditionally flushed a *real* paragraph block, which this
    // asserts never happens once inside a flat-text capture.
    const result = convert("<blockquote><p>Sitaatti.</p></blockquote><p>Tavallinen kappale.</p>");
    expect(result.blocks).toEqual([
      { _type: "contentQuoteBlock", text: "Sitaatti." },
      { _type: "contentParagraphBlock", text: "Tavallinen kappale." },
    ]);
  });
});

describe("round-7 review finding: <colgroup>/<col> attributes go through the allow-list too", () => {
  it("records a dropped column width as lossy, rather than silently discarding it", () => {
    const result = convert('<table><colgroup><col style="width: 50%"></colgroup><tr><th>A</th></tr><tr><td>B</td></tr></table>');
    expect(result.convertible).toBe(true);
    expect(codes(result, "lossy")).toContain("presentation-dropped");
  });

  it("refuses an unrecognized colgroup/col attribute rather than dropping it silently", () => {
    const result = convert('<table><colgroup onclick="x()"><col></colgroup><tr><th>A</th></tr><tr><td>B</td></tr></table>');
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("still converts a table with a plain, attribute-free colgroup", () => {
    const result = convert("<table><colgroup><col></colgroup><tr><th>A</th></tr><tr><td>B</td></tr></table>");
    expect(result.convertible).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("round-6 review finding: resolvedConversionDigest binds approval to the resolved output, not just the source text", () => {
  it("changes when the resolved photograph identity changes, source body unchanged", () => {
    const a = convert('<p><img src="known-1.jpg"></p>');
    const b = convert('<p><img src="known-1.jpg"></p>', {
      resolveImage: () => ({ mediaId: "a-different-photograph", alt: "Kuvateksti" }),
    });
    expect(resolvedConversionDigest(a)).not.toBe(resolvedConversionDigest(b));
  });

  it("changes when only the alt text changes", () => {
    const a = convert('<p><img src="known-1.jpg"></p>');
    const b = convert('<p><img src="known-1.jpg"></p>', {
      resolveImage: () => ({ mediaId: "media-images-known-1-jpg", alt: "Eri kuvateksti" }),
    });
    expect(resolvedConversionDigest(a)).not.toBe(resolvedConversionDigest(b));
  });

  it("changes when gallery order changes, same photographs", () => {
    const a = convert("{gallery}stories/small{/gallery}");
    const b = convert("{gallery}stories/small{/gallery}", {
      resolveGallery: () => ({ kind: "mini", mediaIds: ["c", "b", "a"], altTextByMediaId: altTextFor(["a", "b", "c"]) }),
    });
    expect(resolvedConversionDigest(a)).not.toBe(resolvedConversionDigest(b));
  });

  it("is stable for the identical resolved output, alt text order included", () => {
    const a = convert('<p><img src="known-1.jpg"></p>');
    const b = convert('<p><img src="known-1.jpg"></p>');
    expect(resolvedConversionDigest(a)).toBe(resolvedConversionDigest(b));
  });
});

describe("schema constants stay pinned to the Studio schema", () => {
  // scripts/*.mts are self-contained by convention and import nothing from the
  // schema tree, so the copies are pinned here instead of shared at runtime.
  it("restates the same object type names, bounds, and video-id pattern", () => {
    expect(CONTENT_BLOCK_OBJECT_TYPES).toEqual(SCHEMA_OBJECT_TYPES);
    expect(MAX_MINI_GALLERY_ITEMS).toBe(SCHEMA_MAX_MINI_GALLERY_ITEMS);
    expect(MAX_TABLE_COLUMNS).toBe(SCHEMA_MAX_TABLE_COLUMNS);
    expect(MAX_TABLE_ROWS).toBe(SCHEMA_MAX_TABLE_ROWS);
    expect(MIN_TAB_GROUP_TABS).toBe(SCHEMA_MIN_TAB_GROUP_TABS);
    expect(MAX_TAB_GROUP_TABS).toBe(SCHEMA_MAX_TAB_GROUP_TABS);
    expect(MAX_TAB_LABEL_LENGTH).toBe(SCHEMA_MAX_TAB_LABEL_LENGTH);
    expect(YOUTUBE_VIDEO_ID_PATTERN.source).toBe(SCHEMA_YOUTUBE_PATTERN.source);
  });

  it("gives every finding code a stable, unique identity", () => {
    const all = [...REFUSAL_CODES, ...LOSSY_CODES];
    expect(new Set(all).size).toBe(all.length);
    expect(CONVERSION_POLICY_VERSION).toMatch(/^joomla-conversion-v\d+$/u);
  });
});

describe("prose", () => {
  it("converts paragraphs and headings, collapsing whitespace", () => {
    const result = convert("<p>Ensimmäinen   kappale.</p><h2>Otsikko</h2><p>Toinen.</p>");
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([
      { _type: "contentParagraphBlock", text: "Ensimmäinen kappale." },
      { _type: "contentHeadingBlock", level: 2, text: "Otsikko" },
      { _type: "contentParagraphBlock", text: "Toinen." },
    ]);
  });

  it("decodes entities and non-breaking spaces", () => {
    const result = convert("<p>Kissa&nbsp;&amp;&nbsp;koira &lt;taas&gt; &quot;lainaus&quot;</p>");
    // `&lt;taas&gt;` decodes to literal text the author wrote, not to markup.
    expect(result.blocks[0]).toEqual({
      _type: "contentParagraphBlock",
      text: 'Kissa & koira <taas> "lainaus"',
    });
  });

  it("never carries source markup into a block", () => {
    const result = convert(
      '<div class="wrap"><p>Teksti <strong>lihava</strong> ja <a href="/x">linkki</a>.</p></div>',
    );
    for (const block of result.blocks) {
      expect(JSON.stringify(block)).not.toMatch(/<\/?(?:p|div|strong|a|span)\b/iu);
    }
    expect(result.blocks).toEqual([
      { _type: "contentParagraphBlock", text: "Teksti lihava ja linkki." },
    ]);
  });

  it("repairs unclosed tags the way a browser does", () => {
    const result = convert("<p>Alku<p>Toinen<ul><li>Eka<li>Toka</ul>");
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([
      { _type: "contentParagraphBlock", text: "Alku" },
      { _type: "contentParagraphBlock", text: "Toinen" },
      { _type: "contentListBlock", ordered: false, items: ["Eka", "Toka"] },
    ]);
  });

  it("walks mixed content in order instead of reading a parent's text", () => {
    // Reading textContent off the <p> would drop the image entirely and
    // duplicate the emphasised words.
    const result = convert('<p>Ennen <em>korostus</em> <img src="known-1.jpg"> jälkeen</p>');
    expect(result.blocks.map((block) => block._type)).toEqual([
      "contentParagraphBlock",
      "contentMediaBlock",
      "contentParagraphBlock",
    ]);
    expect(result.blocks[0]).toMatchObject({ text: "Ennen korostus" });
    expect(result.blocks[2]).toMatchObject({ text: "jälkeen" });
  });

  it("collapses a line break to a space rather than joining two words", () => {
    const result = convert("<p>rivi<br>toinen</p>");
    expect(result.blocks[0]).toMatchObject({ text: "rivi toinen" });
    expect(codes(result, "lossy")).toContain("line-break-collapsed");
  });
});

describe("Word markup", () => {
  it("converts pasted Word prose and records the presentation it dropped", () => {
    const result = convert(
      '<p class="MsoNormal" style="mso-style-name:Normaali; margin:0cm"><span style="font-family:Calibri">Word-teksti</span></p>',
    );
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([{ _type: "contentParagraphBlock", text: "Word-teksti" }]);
    // Two on the paragraph (class, style) and one on the span.
    expect(codes(result, "lossy")).toEqual([
      "presentation-dropped",
      "presentation-dropped",
      "presentation-dropped",
    ]);
  });

  it("refuses Word markup that hides content", () => {
    const result = convert('<p style="display:none">Piilotettu luonnos</p>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("hidden-content");
  });

  it("round-10 review finding: refuses the other common CSS-hiding techniques, not only display:none/visibility:hidden", () => {
    for (const style of ["opacity: 0", "opacity:.0", "opacity: 0%", "visibility: collapse", "font-size: 0", "font-size:0px"]) {
      const result = convert(`<p style="${style}">Piilotettu luonnos</p>`);
      expect(codes(result, "refusal"), style).toContain("hidden-content");
    }
  });

  it("does not false-positive on a merely small or translucent value", () => {
    const translucent = convert('<p style="opacity: 0.5">Näkyvä teksti</p>');
    expect(translucent.convertible).toBe(true);
    const smallFont = convert('<p style="font-size: 10px">Näkyvä teksti</p>');
    expect(smallFont.convertible).toBe(true);
  });
});

describe("attribute policy", () => {
  it("refuses a behavioural attribute rather than dropping it", () => {
    const result = convert('<p onclick="alert(1)">Teksti</p>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("records a dropped anchor id, because an inbound link stops resolving", () => {
    const result = convert('<h2 id="vanha-ankkuri">Otsikko</h2>');
    expect(result.convertible).toBe(true);
    expect(codes(result, "lossy")).toContain("anchor-id-dropped");
  });
});

describe("links and emphasis", () => {
  it("keeps a link's words and reports its lost destination separately from emphasis", () => {
    const result = convert('<p>Lataa <a href="/files/ohjelma.pdf">ohjelma</a> ja <strong>huomaa</strong>.</p>');
    expect(result.convertible).toBe(true);
    expect(result.blocks[0]).toMatchObject({ text: "Lataa ohjelma ja huomaa." });
    const lossy = result.findings.filter((finding) => finding.severity === "lossy");
    expect(lossy.map((finding) => finding.code)).toEqual(["link-destination-dropped", "emphasis-dropped"]);
    // The destination has to appear in the finding: that is what an owner
    // reviews, and what a re-link would restore.
    expect(lossy[0]?.message).toContain("/files/ohjelma.pdf");
  });

  it("reports an in-page anchor as a lost destination too — every id is dropped, so its target is always gone", () => {
    const result = convert('<p>Katso <a href="#alaosa">alaosa</a>.</p>');
    expect(codes(result, "lossy")).toContain("link-destination-dropped");
  });
});

describe("headings", () => {
  it("refuses an h1 and an h5", () => {
    expect(codes(convert("<h1>Otsikko</h1>"), "refusal")).toContain("heading-level-unsupported");
    expect(codes(convert("<h2>A</h2><h5>B</h5>"), "refusal")).toContain("heading-level-unsupported");
  });

  it("refuses a body whose first heading is not level 2", () => {
    expect(codes(convert("<h3>Liian syvä</h3>"), "refusal")).toContain("heading-order");
  });

  it("refuses a skipped descent but allows a return to any shallower level", () => {
    expect(codes(convert("<h2>A</h2><h4>B</h4>"), "refusal")).toContain("heading-order");
    const fine = convert("<h2>A</h2><h3>B</h3><h4>C</h4><h2>D</h2>");
    expect(fine.convertible).toBe(true);
  });
});

describe("images", () => {
  it("emits a media block for an approved photograph", () => {
    const result = convert('<p><img src="images/known-1.jpg" alt="Lähteen alt"></p>');
    expect(result.blocks).toEqual([
      { _type: "contentMediaBlock", media: "media-images-known-1-jpg" },
    ]);
  });

  it("refuses an unmatched image instead of dropping it", () => {
    const result = convert('<p><img src="images/Logo.png"></p>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("image-unresolved");
  });

  it("refuses rather than inventing alternative text", () => {
    const result = convert('<p><img src="known-2.jpg"></p>', {
      resolveImage: () => ({ mediaId: "m1" }),
    });
    expect(codes(result, "refusal")).toContain("image-missing-alt");
  });
});

describe("figures", () => {
  it("carries a <figcaption> onto the media block as a placement-specific caption", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt"><figcaption>Kuvaaja itse</figcaption></figure>');
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([
      { _type: "contentMediaBlock", media: "media-known-1-jpg", caption: "Kuvaaja itse" },
    ]);
  });

  it("emits a plain media block, with no caption field, when the figure carries none", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt"></figure>');
    expect(result.blocks).toEqual([{ _type: "contentMediaBlock", media: "media-known-1-jpg" }]);
  });

  it("emits a plain media block when the only <figcaption> is blank", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt"><figcaption> </figcaption></figure>');
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([{ _type: "contentMediaBlock", media: "media-known-1-jpg" }]);
  });

  it("flattens inline markup inside a caption to plain text and records the loss", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt"><figcaption>Malli <em>X</em></figcaption></figure>');
    expect(result.blocks).toEqual([
      { _type: "contentMediaBlock", media: "media-known-1-jpg", caption: "Malli X" },
    ]);
    expect(codes(result, "lossy")).toContain("emphasis-dropped");
  });

  it("drops a presentational attribute on the caption itself", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt"><figcaption class="c">Teksti</figcaption></figure>');
    expect(codes(result, "lossy")).toContain("presentation-dropped");
    expect(result.blocks).toEqual([
      { _type: "contentMediaBlock", media: "media-known-1-jpg", caption: "Teksti" },
    ]);
  });

  it("tolerates a second, blank <figcaption> — the real legacy shape found in the source archive", () => {
    const result = convert(
      '<figure><img src="known-1.jpg" alt="Alt"><figcaption>Ensimmäinen</figcaption><figcaption></figcaption></figure>',
    );
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([
      { _type: "contentMediaBlock", media: "media-known-1-jpg", caption: "Ensimmäinen" },
    ]);
  });

  it("refuses two non-blank captions on the same figure rather than picking one", () => {
    const result = convert(
      '<figure><img src="known-1.jpg" alt="Alt"><figcaption>A</figcaption><figcaption>B</figcaption></figure>',
    );
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("figure-unsupported-shape");
  });

  it("refuses a figure holding more than one image", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt"><img src="known-1.jpg" alt="Alt"></figure>');
    expect(codes(result, "refusal")).toContain("figure-unsupported-shape");
  });

  it("refuses a figure carrying loose text alongside its image, rather than guessing it is a caption", () => {
    const result = convert('<figure><img src="known-1.jpg" alt="Alt">Irtoteksti</figure>');
    expect(codes(result, "refusal")).toContain("figure-unsupported-shape");
  });

  it("refuses a figure with no image at all", () => {
    const result = convert("<figure><figcaption>Ei kuvaa</figcaption></figure>");
    expect(codes(result, "refusal")).toContain("figure-unsupported-shape");
  });

  it("still refuses an unresolved photograph inside a figure", () => {
    const result = convert('<figure><img src="images/Logo.png"><figcaption>Teksti</figcaption></figure>');
    expect(codes(result, "refusal")).toContain("image-unresolved");
  });

  it("refuses a caption past the shared length bound instead of truncating it", () => {
    const result = convert(
      `<figure><img src="known-1.jpg" alt="Alt"><figcaption>${"x".repeat(501)}</figcaption></figure>`,
    );
    expect(codes(result, "refusal")).toContain("figure-unsupported-shape");
  });

  it("refuses a figure nested inside a blockquote, the same as a bare image", () => {
    const result = convert(
      '<blockquote>Sitaatti <figure><img src="known-1.jpg" alt="Alt"><figcaption>C</figcaption></figure> loppu</blockquote>',
    );
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
    expect(result.blocks).toEqual([]);
  });
});

describe("embeds", () => {
  it("converts a YouTube frame when an accessible title exists", () => {
    const result = convert('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
    expect(result.blocks).toEqual([
      { _type: "contentYoutubeBlock", videoId: "dQw4w9WgXcQ", title: "Esittelyvideo" },
    ]);
  });

  it("refuses a YouTube frame with no accessible title rather than inventing one", () => {
    const result = convert('<iframe src="https://youtu.be/AAAAAAAAAAA"></iframe>');
    expect(codes(result, "refusal")).toContain("youtube-title-missing");
  });

  it("refuses any other embed", () => {
    expect(codes(convert('<iframe src="https://vimeo.com/123"></iframe>'), "refusal")).toContain("non-youtube-embed");
    expect(codes(convert("<object data='x.swf'></object>"), "refusal")).toContain("non-youtube-embed");
  });

  it("refuses script and style outright", () => {
    expect(codes(convert("<script>evil()</script>"), "refusal")).toContain("script-or-style");
    expect(codes(convert("<style>p{}</style>"), "refusal")).toContain("script-or-style");
  });

  it("recognizes every documented YouTube URL shape and nothing else", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://evil.example/embed/dQw4w9WgXcQ")).toBeUndefined();
    expect(extractYoutubeVideoId("https://www.youtube.com/embed/short")).toBeUndefined();
  });
});

describe("block content where only text fits", () => {
  // Converting these instead of refusing emitted the surrounding words twice
  // (the stray paragraph the block flushed, plus the quote) and dropped a list
  // item's words before the image. Silent corruption, caught by self-review.
  it("refuses a blockquote holding an image, rather than duplicating its text", () => {
    const result = convert('<blockquote>Sitaatti <img src="known-1.jpg"> loppu</blockquote>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
    expect(result.blocks).toEqual([]);
  });

  it("refuses a list item holding an image, rather than dropping its leading words", () => {
    const result = convert('<ul><li>Kohta <img src="known-1.jpg"> lisää</li></ul>');
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
    expect(result.blocks).toEqual([]);
  });

  it("refuses a gallery marker inside a quote", () => {
    const result = convert("<blockquote>Katso {gallery}stories/small{/gallery}</blockquote>");
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
  });

  it("still converts a quote and an item whose contents are inline", () => {
    const quote = convert('<blockquote>Sitaatti <em>korostettu</em> loppu</blockquote>');
    expect(quote.convertible).toBe(true);
    expect(quote.blocks).toEqual([{ _type: "contentQuoteBlock", text: "Sitaatti korostettu loppu" }]);

    const list = convert("<ul><li>Kohta <strong>yksi</strong></li></ul>");
    expect(list.blocks).toEqual([{ _type: "contentListBlock", ordered: false, items: ["Kohta yksi"] }]);
  });
});

describe("lists", () => {
  it("refuses a nested list rather than flattening authored structure", () => {
    const result = convert("<ul><li>Eka<ul><li>Sisempi</li></ul></li></ul>");
    expect(codes(result, "refusal")).toContain("nested-list");
  });

  it("refuses an empty item", () => {
    expect(codes(convert("<ul><li>Eka</li><li> </li></ul>"), "refusal")).toContain("empty-list");
  });

  it("marks an ordered list", () => {
    expect(convert("<ol><li>Eka</li></ol>").blocks[0]).toEqual({
      _type: "contentListBlock",
      ordered: true,
      items: ["Eka"],
    });
  });
});

describe("tables", () => {
  const good = "<table><caption>Mitat</caption><tr><th>Malli</th><th>Paino</th></tr><tr><td>A</td><td>1</td></tr></table>";

  it("converts a rectangular table with headers", () => {
    expect(convert(good).blocks[0]).toEqual({
      _type: "contentTableBlock",
      caption: "Mitat",
      headers: ["Malli", "Paino"],
      rows: [{ cells: ["A", "1"] }],
    });
  });

  it("keeps an empty cell as content but refuses a short row as a defect", () => {
    const withEmptyCell = convert("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td></td></tr></table>");
    expect(withEmptyCell.convertible).toBe(true);
    expect(withEmptyCell.blocks[0]).toMatchObject({ rows: [{ cells: ["1", ""] }] });

    const ragged = convert("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>");
    expect(codes(ragged, "refusal")).toContain("table-ragged");
  });

  it("refuses a headerless table rather than inventing labels", () => {
    expect(codes(convert("<table><tr><td>1</td><td>2</td></tr></table>"), "refusal")).toContain(
      "table-headers-missing",
    );
  });

  it("refuses merged cells", () => {
    const merged = "<table><tr><th colspan='2'>A</th></tr><tr><td>1</td><td>2</td></tr></table>";
    expect(codes(convert(merged), "refusal")).toContain("table-merged-cells");
  });

  it("refuses a table past either bound", () => {
    const wide = `<table><tr>${"<th>h</th>".repeat(MAX_TABLE_COLUMNS + 1)}</tr><tr>${"<td>c</td>".repeat(MAX_TABLE_COLUMNS + 1)}</tr></table>`;
    expect(codes(convert(wide), "refusal")).toContain("table-too-wide");

    const long = `<table><tr><th>h</th></tr>${"<tr><td>c</td></tr>".repeat(MAX_TABLE_ROWS + 1)}</table>`;
    expect(codes(convert(long), "refusal")).toContain("table-too-long");
  });
});

describe("tab groups (AB#163)", () => {
  // The one real legacy shape (article 370's Bootstrap burst-test tabs):
  // <ul class="nav nav-tabs"> triggers immediately followed by a matching
  // <div class="tab-content"> of panes, each holding exactly one table.
  const twoTabs =
    '<ul class="nav nav-tabs"><li class="active"><a data-toggle="tab" href="#t1">Testi 1</a></li>' +
    '<li><a data-toggle="tab" href="#t2">Testi 2</a></li></ul>' +
    '<div class="tab-content">' +
    '<div class="tab-pane fade active in" id="t1"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div>' +
    '<div class="tab-pane fade" id="t2"><table><tr><th>B</th></tr><tr><td>2</td></tr></table></div>' +
    "</div>";

  it("converts the paired nav-tabs/tab-content shape to one tab-group block", () => {
    const result = convert(twoTabs);
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([
      {
        _type: "contentTabGroupBlock",
        tabs: [
          { label: "Testi 1", table: { _type: "contentTableBlock", headers: ["A"], rows: [{ cells: ["1"] }] } },
          { label: "Testi 2", table: { _type: "contentTableBlock", headers: ["B"], rows: [{ cells: ["2"] }] } },
        ],
      },
    ]);
  });

  it("keeps surrounding prose intact around the consumed pair", () => {
    const result = convert(`<p>Ennen</p>${twoTabs}<p>Jälkeen</p>`);
    expect(result.blocks.map((block) => block._type)).toEqual([
      "contentParagraphBlock",
      "contentTabGroupBlock",
      "contentParagraphBlock",
    ]);
  });

  it("refuses a nav-tabs list with no adjacent tab-content", () => {
    const result = convert('<ul class="nav nav-tabs"><li><a data-toggle="tab" href="#t1">A</a></li></ul><p>Muuta</p>');
    expect(codes(result, "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses non-blank text between the nav list and its tab-content", () => {
    const broken = twoTabs.replace('</ul><div class="tab-content">', "</ul>irtoteksti<div class=\"tab-content\">");
    expect(codes(convert(broken), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses a trigger carrying an attribute beyond data-toggle and href", () => {
    const withExtra = twoTabs.replace('data-toggle="tab" href="#t1"', 'data-toggle="tab" href="#t1" class="x"');
    expect(codes(convert(withExtra), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses a trigger whose href is not a fragment", () => {
    const badHref = twoTabs.replace('href="#t1"', 'href="/elsewhere"');
    expect(codes(convert(badHref), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses a pane holding more than one table", () => {
    const twoTables = twoTabs.replace(
      '<div class="tab-pane fade active in" id="t1"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div>',
      '<div class="tab-pane fade active in" id="t1"><table><tr><th>A</th></tr><tr><td>1</td></tr></table><table><tr><th>C</th></tr><tr><td>3</td></tr></table></div>',
    );
    expect(codes(convert(twoTables), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses a pane holding something other than a table", () => {
    const withParagraph = twoTabs.replace(
      '<div class="tab-pane fade active in" id="t1"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div>',
      '<div class="tab-pane fade active in" id="t1"><p>Teksti</p></div>',
    );
    expect(codes(convert(withParagraph), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("still surfaces a pane's own specific refusal rather than a generic shape refusal", () => {
    const withUnresolvedImage = twoTabs.replace(
      '<div class="tab-pane fade active in" id="t1"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div>',
      '<div class="tab-pane fade active in" id="t1"><img src="images/Logo.png"></div>',
    );
    const result = convert(withUnresolvedImage);
    expect(codes(result, "refusal")).toContain("image-unresolved");
    expect(codes(result, "refusal")).not.toContain("tab-group-unsupported-shape");
  });

  it("refuses a trigger fragment with no matching pane", () => {
    const brokenLink = twoTabs.replace('href="#t2"', 'href="#missing"');
    expect(codes(convert(brokenLink), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses an unreferenced extra pane", () => {
    const withExtraPane = twoTabs.replace(
      '<div class="tab-content">',
      '<div class="tab-content"><div class="tab-pane" id="t3"><table><tr><th>C</th></tr><tr><td>3</td></tr></table></div>',
    );
    expect(codes(convert(withExtraPane), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses fewer than two tabs", () => {
    const oneTab =
      '<ul class="nav nav-tabs"><li><a data-toggle="tab" href="#t1">Testi 1</a></li></ul>' +
      '<div class="tab-content"><div class="tab-pane" id="t1"><table><tr><th>A</th></tr><tr><td>1</td></tr></table></div></div>';
    expect(codes(convert(oneTab), "refusal")).toContain("tab-group-unsupported-shape");
  });

  it("refuses a tab group nested inside a blockquote, the same as a bare table", () => {
    const result = convert(`<blockquote>Sitaatti ${twoTabs} loppu</blockquote>`);
    expect(result.convertible).toBe(false);
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
    expect(result.blocks).toEqual([]);
  });

  it("flattens inline markup in a trigger label to plain text", () => {
    const withEmphasis = twoTabs.replace(">Testi 1<", "><em>Testi 1</em><");
    const result = convert(withEmphasis);
    expect(result.blocks).toMatchObject([{ tabs: [{ label: "Testi 1" }, { label: "Testi 2" }] }]);
    expect(codes(result, "lossy")).toContain("emphasis-dropped");
  });
});

describe("Joomla plugin markers", () => {
  it("splits markers out of surrounding prose in order", () => {
    expect(splitPluginMarkers("ennen {gallery}stories/x{/gallery} jälkeen")).toEqual([
      { kind: "text", text: "ennen " },
      { kind: "gallery", path: "stories/x", source: "{gallery}stories/x{/gallery}" },
      { kind: "text", text: " jälkeen" },
    ]);
  });

  it("refuses every marker that is not a gallery", () => {
    for (const marker of ["{loadposition user1}", "{loadmodule mod_x}", "{contentpoll id=3}"]) {
      const result = convert(`<p>${marker}</p>`);
      expect(codes(result, "refusal")).toContain("unknown-plugin-marker");
    }
  });

  it("converts a small gallery inline, in its authored position", () => {
    const result = convert("<p>Ennen</p>{gallery}stories/small{/gallery}<p>Jälkeen</p>");
    expect(result.convertible).toBe(true);
    expect(result.blocks.map((block) => block._type)).toEqual([
      "contentParagraphBlock",
      "contentGalleryBlock",
      "contentParagraphBlock",
    ]);
    expect(result.blocks[1]).toMatchObject({ images: [{ media: "a" }, { media: "b" }, { media: "c" }] });
  });

  it("routes an over-limit gallery to the article's one end gallery", () => {
    const result = convert("<p>Teksti</p>{gallery}stories/large{/gallery}");
    expect(result.convertible).toBe(true);
    expect(result.endGallery?.sourcePath).toBe("stories/large");
    expect(result.endGallery?.mediaIds).toHaveLength(32);
    // It is not also a body block: the end gallery is its own sequence.
    expect(result.blocks.map((block) => block._type)).toEqual(["contentParagraphBlock"]);
  });

  it("reports an end gallery that has to move from mid-body to the end", () => {
    const result = convert("{gallery}stories/large{/gallery}<p>Teksti jälkeen</p>");
    expect(result.convertible).toBe(true);
    expect(codes(result, "lossy")).toContain("end-gallery-relocated");
  });

  it("does not report relocation when the marker already ends the body", () => {
    const result = convert("<p>Teksti</p>{gallery}stories/large{/gallery}");
    expect(codes(result, "lossy")).not.toContain("end-gallery-relocated");
  });

  it("refuses a second over-limit gallery, because an article owns at most one", () => {
    const result = convert("{gallery}stories/large{/gallery}{gallery}stories/large{/gallery}");
    expect(codes(result, "refusal")).toContain("multiple-end-galleries");
  });

  it("refuses an unapproved, empty, or over-inline gallery", () => {
    expect(codes(convert("{gallery}stories/unknown{/gallery}"), "refusal")).toContain("gallery-unresolved");
    expect(codes(convert("{gallery}stories/empty{/gallery}"), "refusal")).toContain("gallery-empty");
    expect(codes(convert("{gallery}stories/oversized-inline{/gallery}"), "refusal")).toContain(
      "gallery-inventory-mismatch",
    );
  });

  it("refuses a gallery with any image missing alt text — a gallery is not exempt from the media contract", () => {
    const result = convert("{gallery}stories/missing-alt{/gallery}");
    expect(codes(result, "refusal")).toContain("image-missing-alt");
  });
});

describe("resolved image alt text travels to the shared media document, not the block", () => {
  it("records alt text per photograph in the article's own language, and puts none on the block", () => {
    const result = convert('<p><img src="images/known-1.jpg"></p>');
    expect(result.blocks).toEqual([{ _type: "contentMediaBlock", media: "media-images-known-1-jpg" }]);
    expect(result.resolvedImageAltText).toEqual([
      { mediaId: "media-images-known-1-jpg", language: "fi", value: "Kuvateksti" },
    ]);
  });

  it("records alt text for every image in a gallery", () => {
    const result = convert("{gallery}stories/small{/gallery}");
    expect(result.resolvedImageAltText).toEqual([
      { mediaId: "a", language: "fi", value: "Alt a" },
      { mediaId: "b", language: "fi", value: "Alt b" },
      { mediaId: "c", language: "fi", value: "Alt c" },
    ]);
  });
});

describe("round-5 review finding: adjacent transparent wrappers keep a word boundary", () => {
  it("does not concatenate two adjacent <div> paragraphs into one word", () => {
    const result = convert("<div>First</div><div>Second</div>");
    expect(result.blocks).toEqual([
      { _type: "contentParagraphBlock", text: "First" },
      { _type: "contentParagraphBlock", text: "Second" },
    ]);
  });

  it("still merges genuinely inline text inside one wrapper", () => {
    const result = convert('<div>Ennen <em>korostus</em> jälkeen</div>');
    expect(result.blocks).toEqual([{ _type: "contentParagraphBlock", text: "Ennen korostus jälkeen" }]);
  });
});

describe("round-4 review finding: an anchor id is reported even on a transparent wrapper", () => {
  it("reports a dropped id on a Joomla layout <div>", () => {
    const result = convert('<div id="section-a"><p>Teksti</p></div>');
    expect(codes(result, "lossy")).toContain("anchor-id-dropped");
  });

  it("still suppresses class/style noise on the same wrapper", () => {
    const result = convert('<div id="section-a" class="item-page"><p>Teksti</p></div>');
    expect(codes(result, "lossy")).toEqual(["anchor-id-dropped"]);
  });
});

describe("round-3 review finding: table section wrappers go through the attribute allow-list too", () => {
  it("refuses a hidden <tbody>, not just a hidden row or cell", () => {
    const result = convert(
      '<table><tbody style="display:none"><tr><th>A</th></tr><tr><td>Secret</td></tr></tbody></table>',
    );
    expect(codes(result, "refusal")).toContain("hidden-content");
    expect(result.blocks).toEqual([]);
  });
});

describe("round-2 review findings (table attributes, empty headings, gallery-in-quote, list numbering)", () => {
  it("applies the attribute allow-list to a table row and cell, not just the table", () => {
    const hidden = convert('<table><tr><th>H</th></tr><tr><td style="display:none">private</td></tr></table>');
    expect(codes(hidden, "refusal")).toContain("hidden-content");
    expect(hidden.blocks).toEqual([]);

    const behavioural = convert('<table><tr onclick="x()"><th>H</th></tr></table>');
    expect(codes(behavioural, "refusal")).toContain("behavioural-attribute");
  });

  it("applies the attribute allow-list to a caption", () => {
    const result = convert('<table><caption onclick="x()">C</caption><tr><th>H</th></tr><tr><td>1</td></tr></table>');
    expect(codes(result, "refusal")).toContain("behavioural-attribute");
  });

  it("refuses an empty heading rather than publishing blank required text", () => {
    const result = convert("<h2></h2><p>Teksti</p>");
    expect(codes(result, "refusal")).toContain("empty-heading");
    expect(result.convertible).toBe(false);
  });

  it("does not silently relocate an over-limit gallery found inside a quote, heading, or item", () => {
    const inQuote = convert("<blockquote>Katso {gallery}stories/large{/gallery}</blockquote>");
    expect(codes(inQuote, "refusal")).toContain("block-inside-quote-or-item");
    expect(inQuote.endGallery).toBeUndefined();

    const inHeading = convert("<h2>Katso {gallery}stories/large{/gallery}</h2>");
    expect(codes(inHeading, "refusal")).toContain("block-inside-quote-or-item");
    expect(inHeading.endGallery).toBeUndefined();

    const inItem = convert("<ul><li>Katso {gallery}stories/large{/gallery}</li></ul>");
    expect(codes(inItem, "refusal")).toContain("block-inside-quote-or-item");
    expect(inItem.endGallery).toBeUndefined();
  });

  it("still recognizes a legitimate end gallery after an earlier refused attempt in a quote", () => {
    // The rollback in captureFlatText must restore the outer endGallery state,
    // not just clear it, so a real end gallery later in the body still counts.
    const result = convert(
      "<blockquote>Katso {gallery}stories/large{/gallery}</blockquote><p>Teksti</p>{gallery}stories/small{/gallery}",
    );
    expect(codes(result, "refusal")).toContain("block-inside-quote-or-item");
  });

  it("records dropped ordered-list numbering rather than silently renumbering from 1", () => {
    const result = convert('<ol start="5"><li>a</li></ol>');
    expect(codes(result, "lossy")).toContain("ordered-list-start-dropped");
    expect(result.blocks[0]).toEqual({ _type: "contentListBlock", ordered: true, items: ["a"] });
  });

  it("refuses text sitting directly inside a list, outside any item", () => {
    const result = convert("<ul>tärkeä teksti<li>kohta</li></ul>");
    expect(codes(result, "refusal")).toContain("text-outside-list-item");
  });

  it("ignores whitespace-only text directly inside a list", () => {
    const result = convert("<ul>\n  <li>kohta</li>\n</ul>");
    expect(result.convertible).toBe(true);
  });
});

describe("whole-body outcomes", () => {
  it("refuses a body that converted to nothing", () => {
    expect(codes(convert("   "), "refusal")).toContain("empty-body");
  });

  it("refuses an unknown element instead of silently unwrapping it", () => {
    expect(codes(convert("<marquee>Liikkuu</marquee>"), "refusal")).toContain("unsupported-element");
  });

  it("walks through a Joomla layout wrapper without losing its content or filling the report", () => {
    const result = convert('<div class="item-page"><div class="inner"><p>Sisältö</p></div></div>');
    expect(result.convertible).toBe(true);
    expect(result.blocks).toEqual([{ _type: "contentParagraphBlock", text: "Sisältö" }]);
    // A wrapper carries no content of its own, so its styling is not a loss —
    // reporting each one would bury the findings that describe real content.
    expect(result.findings).toEqual([]);
  });

  it("still refuses a behavioural attribute on a layout wrapper", () => {
    expect(codes(convert('<div onclick="x()"><p>T</p></div>'), "refusal")).toContain("behavioural-attribute");
    expect(codes(convert('<div style="display:none"><p>T</p></div>'), "refusal")).toContain("hidden-content");
  });

  it("names an unpaired gallery marker for what it is", () => {
    const result = convert("<p>{gallery}</p>");
    const finding = result.findings.find((entry) => entry.code === "unknown-plugin-marker");
    expect(finding?.message).toContain("unpaired gallery marker");
  });

  it("bounds a finding's source excerpt", () => {
    const result = convert(`<marquee>${"x".repeat(500)}</marquee>`);
    const finding = result.findings.find((entry) => entry.code === "unsupported-element");
    expect(finding?.fragment?.length ?? 0).toBeLessThanOrEqual(201);
  });
});

describe("normalizeText", () => {
  it("collapses runs of whitespace including non-breaking spaces", () => {
    expect(normalizeText(" a   b\n\tc ")).toBe("a b c");
  });
});

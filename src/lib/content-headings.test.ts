import { describe, expect, it } from "vitest";

import {
  buildHeadingIds,
  listContentHeadings,
  nestContentHeadings,
  type ContentHeading,
} from "@/lib/content-headings";
import type { ContentBlock } from "@/lib/content-page";

const heading = (level: 2 | 3 | 4, text: string): ContentBlock => ({
  type: "heading",
  level,
  text,
});

const paragraph: ContentBlock = { type: "paragraph", text: "Body copy." };

describe("listContentHeadings", () => {
  it("lists level-2 headings in document order", () => {
    expect(
      listContentHeadings([
        heading(2, "Autofocus"),
        paragraph,
        heading(2, "Weather sealing"),
      ]),
    ).toEqual([
      { id: "section-autofocus", text: "Autofocus", level: 2 },
      { id: "section-weather-sealing", text: "Weather sealing", level: 2 },
    ]);
  });

  it("lists nothing for a body with no headings to skip between", () => {
    // ADR-0003 derives the navigation from structure: with nothing to jump to,
    // there is no navigation, and no authoring toggle changes that.
    expect(listContentHeadings([paragraph])).toEqual([]);
  });

  it("lists a level-3 heading too, unlike the pre-AB#21 table of contents", () => {
    expect(listContentHeadings([heading(2, "Gear"), heading(3, "A detail")])).toEqual([
      { id: "section-gear", text: "Gear", level: 2 },
      { id: "section-a-detail", text: "A detail", level: 3 },
    ]);
  });

  it("lists levels 2, 3, and 4 in authored document order, not id-issuance order", () => {
    // The id algorithm assigns level-2 ids in one pass and level-3/4 ids in a
    // second (AC4's compatibility guarantee below), so this proves the list
    // itself still reflects the body's own order rather than that internal
    // issuance order.
    const blocks = [
      heading(2, "First"),
      heading(3, "Second"),
      heading(4, "Third"),
      heading(2, "Fourth"),
    ];
    expect(listContentHeadings(blocks).map((entry) => entry.text)).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
    ]);
    expect(listContentHeadings(blocks).map((entry) => entry.level)).toEqual([
      2, 3, 4, 2,
    ]);
  });

  it("keeps Finnish headings readable rather than folding them away", () => {
    expect(listContentHeadings([heading(2, "Valotusaika ja tärähdys")])).toEqual([
      { id: "section-valotusaika-ja-tarahdys", text: "Valotusaika ja tärähdys", level: 2 },
    ]);
  });

  it("gives repeated heading text distinct ids", () => {
    // Two headings that read the same must not produce one id twice: the second
    // link would jump to the first heading.
    expect(
      listContentHeadings([
        heading(2, "Summary"),
        heading(2, "Summary"),
        heading(2, "Summary"),
      ]).map((entry) => entry.id),
    ).toEqual(["section-summary", "section-summary-2", "section-summary-3"]);
  });

  it("does not let a suffixed id collide with an authored one", () => {
    // The suffix competes for the same namespace as authored text, so counting
    // occurrences of each base slug is not enough: here the third heading would
    // otherwise be handed the second one's id.
    const ids = listContentHeadings([
      heading(2, "Gear"),
      heading(2, "Gear 2"),
      heading(2, "Gear"),
    ]).map((entry) => entry.id);

    expect(ids).toEqual(["section-gear", "section-gear-2", "section-gear-3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still produces an id for text that slugifies to nothing", () => {
    expect(listContentHeadings([heading(2, "—"), heading(2, "?")])).toEqual([
      { id: "section", text: "—", level: 2 },
      { id: "section-2", text: "?", level: 2 },
    ]);
  });

  it("gives a heading literally titled 'Gallery' its prefixed id, never the bare id the curated grid's own anchor owns", () => {
    // `<section id="gallery">` is the curated grid's own anchor
    // (`content-gallery.tsx`); the `section-` prefix on every heading id is
    // what keeps an authored heading from ever colliding with it (AC4).
    expect(listContentHeadings([heading(2, "Gallery")])).toEqual([
      { id: "section-gallery", text: "Gallery", level: 2 },
    ]);
  });
});

describe("buildHeadingIds — AC4 legacy level-2 id stability", () => {
  it("keys ids by block index, so a renderer cannot mistake which repeat it is on", () => {
    const blocks = [
      paragraph,
      heading(2, "Summary"),
      paragraph,
      heading(2, "Summary"),
    ];

    expect([...buildHeadingIds(blocks)]).toEqual([
      [1, "section-summary"],
      [3, "section-summary-2"],
    ]);
  });

  it("agrees with the table of contents it is derived alongside, by index", () => {
    // The navigation writes the fragment and the body writes the anchor; a
    // disagreement between them is a link that goes nowhere. Compared by
    // block index rather than by array position: the two-pass id algorithm
    // (level 2 first, then level 3/4) means `buildHeadingIds`'s own
    // insertion order no longer equals document order once a body mixes
    // levels, so `listContentHeadings`'s authored-order list and this map's
    // insertion order are two different, independently-tested orderings of
    // the same underlying ids.
    const blocks = [heading(2, "Gear"), heading(3, "Skipped"), heading(2, "Gear")];
    const ids = buildHeadingIds(blocks);

    // Both functions walk `blocks` once, in the same order, producing exactly
    // one entry/id per heading block — so zipping the two heading-only index
    // sequences together (rather than re-matching by text, which repeats
    // here on purpose) is what actually proves the two never disagree.
    const headingIndices = blocks.flatMap((block, index) =>
      block.type === "heading" ? [index] : [],
    );
    const entries = listContentHeadings(blocks);
    expect(entries).toHaveLength(headingIndices.length);
    entries.forEach((entry, position) => {
      expect(ids.get(headingIndices[position])).toBe(entry.id);
    });
  });

  it("gives an unmixed level-2-only body byte-identical ids to the pre-AB#21 algorithm", () => {
    // The exact fixture the old test suite exercised. A body that never
    // authors a deeper heading must see no change at all from this story.
    const blocks = [
      heading(2, "Gear"),
      heading(2, "Gear 2"),
      heading(2, "Gear"),
      heading(2, "—"),
    ];
    expect(listContentHeadings(blocks).map((entry) => entry.id)).toEqual([
      "section-gear",
      "section-gear-2",
      "section-gear-3",
      "section",
    ]);
  });

  it("never lets a later level-3/4 heading rename an earlier level-2 heading's id", () => {
    const before = [heading(2, "Gear"), heading(2, "Gear 2"), heading(2, "Gear")];
    const idsBefore = listContentHeadings(before)
      .filter((entry) => entry.level === 2)
      .map((entry) => entry.id);

    // The same three level-2 headings, unchanged and in the same relative
    // order, but with new level-3/4 headings inserted around and between
    // them — including one whose own slug ("Gear 2") would otherwise want
    // the very id a level-2 heading already owns.
    const after = [
      heading(3, "Preface"),
      heading(2, "Gear"),
      heading(4, "Gear 2"),
      heading(2, "Gear 2"),
      heading(3, "Gear"),
      heading(2, "Gear"),
    ];
    const idsAfter = listContentHeadings(after)
      .filter((entry) => entry.level === 2)
      .map((entry) => entry.id);

    expect(idsAfter).toEqual(idsBefore);
  });

  it("bumps a colliding level-3/4 heading to a suffix, never the level-2 heading it collides with", () => {
    const blocks = [
      heading(3, "Gear"),
      heading(2, "Gear"),
    ];
    const headings = listContentHeadings(blocks);

    expect(headings.find((entry) => entry.level === 2)?.id).toBe("section-gear");
    expect(headings.find((entry) => entry.level === 3)?.id).toBe("section-gear-2");
  });

  it("still disambiguates two punctuation-only headings across mixed levels", () => {
    const blocks = [heading(2, "—"), heading(3, "?"), heading(4, "…")];
    const ids = listContentHeadings(blocks).map((entry) => entry.id);

    expect(ids).toEqual(["section", "section-2", "section-3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("nestContentHeadings", () => {
  const flat = (
    ...entries: readonly (readonly [level: 2 | 3 | 4, text: string])[]
  ): readonly ContentHeading[] =>
    entries.map(([level, text], index) => ({
      id: `id-${index}`,
      text,
      level,
    }));

  it("returns an empty tree for no headings", () => {
    expect(nestContentHeadings([])).toEqual([]);
  });

  it("keeps a flat level-2-only list as siblings with no children", () => {
    const tree = nestContentHeadings(flat([2, "One"], [2, "Two"]));
    expect(tree.map((node) => node.text)).toEqual(["One", "Two"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("nests a level-3 heading under the level-2 heading before it", () => {
    const tree = nestContentHeadings(flat([2, "Parent"], [3, "Child"]));
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((child) => child.text)).toEqual(["Child"]);
  });

  it("nests a full level-2 > level-3 > level-4 branch", () => {
    const tree = nestContentHeadings(flat([2, "A"], [3, "B"], [4, "C"]));
    expect(tree).toEqual([
      {
        id: "id-0",
        text: "A",
        level: 2,
        children: [
          {
            id: "id-1",
            text: "B",
            level: 3,
            children: [{ id: "id-2", text: "C", level: 4, children: [] }],
          },
        ],
      },
    ]);
  });

  it("gives each level-2 branch its own separate level-3/4 children", () => {
    const tree = nestContentHeadings(
      flat([2, "A"], [3, "A1"], [2, "B"], [3, "B1"], [4, "B1a"]),
    );
    expect(tree).toHaveLength(2);
    expect(tree[0].children.map((child) => child.text)).toEqual(["A1"]);
    expect(tree[1].children.map((child) => child.text)).toEqual(["B1"]);
    expect(tree[1].children[0].children.map((n) => n.text)).toEqual(["B1a"]);
  });

  it("attaches a second level-4 heading to the new level-3 sibling, not the first level-4's old parent", () => {
    // h2 > h3 > h4 > h3 > h4: the second h4 must nest under the *second* h3,
    // proving the depth stack closes the first h3's branch rather than
    // treating every h4 as a sibling under the first-seen h3.
    const tree = nestContentHeadings(
      flat([2, "Root"], [3, "First"], [4, "Deep one"], [3, "Second"], [4, "Deep two"]),
    );
    expect(tree).toHaveLength(1);
    const [first, second] = tree[0].children;
    expect(first.text).toBe("First");
    expect(first.children.map((n) => n.text)).toEqual(["Deep one"]);
    expect(second.text).toBe("Second");
    expect(second.children.map((n) => n.text)).toEqual(["Deep two"]);
  });

  it("closes a level-4 branch when a heading returns to level 2", () => {
    const tree = nestContentHeadings(
      flat([2, "A"], [3, "A1"], [4, "A1a"], [2, "B"]),
    );
    expect(tree).toHaveLength(2);
    expect(tree[1].children).toEqual([]);
  });
});

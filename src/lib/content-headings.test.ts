import { describe, expect, it } from "vitest";

import {
  buildHeadingIds,
  listContentHeadings,
} from "@/lib/content-headings";
import type { ContentBlock } from "@/lib/content-page";

const heading = (level: 2 | 3, text: string): ContentBlock => ({
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
      { id: "section-autofocus", text: "Autofocus" },
      { id: "section-weather-sealing", text: "Weather sealing" },
    ]);
  });

  it("lists nothing for a body with no headings to skip between", () => {
    // ADR-0003 derives the navigation from structure: with nothing to jump to,
    // there is no navigation, and no authoring toggle changes that.
    expect(listContentHeadings([paragraph])).toEqual([]);
  });

  it("ignores level-3 headings, which the table of contents does not list", () => {
    expect(listContentHeadings([heading(3, "A detail")])).toEqual([]);
  });

  it("keeps Finnish headings readable rather than folding them away", () => {
    expect(listContentHeadings([heading(2, "Valotusaika ja tärähdys")])).toEqual(
      [{ id: "section-valotusaika-ja-tarahdys", text: "Valotusaika ja tärähdys" }],
    );
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
      { id: "section", text: "—" },
      { id: "section-2", text: "?" },
    ]);
  });
});

describe("buildHeadingIds", () => {
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

  it("agrees with the table of contents it is derived alongside", () => {
    // The navigation writes the fragment and the body writes the anchor; a
    // disagreement between them is a link that goes nowhere.
    const blocks = [
      heading(2, "Gear"),
      heading(3, "Skipped"),
      heading(2, "Gear"),
    ];

    expect(listContentHeadings(blocks).map((entry) => entry.id)).toEqual([
      ...buildHeadingIds(blocks).values(),
    ]);
  });
});

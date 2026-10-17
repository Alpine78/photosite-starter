import { describe, expect, it } from "vitest";
import { currentReadingChapter, type ReadingHeading } from "./content-reading-address";

const heading = (id: string, top: number, margin = 96): ReadingHeading => ({ id, top, margin, height: 24 });
const body = { top: -400, bottom: 1000 };

describe("reading chapter geometry", () => {
  it("selects authored heading depths through H4 using each heading's own scroll margin", () => {
    expect(currentReadingChapter([heading("h2", -200), heading("h3", 20), heading("h4", 100, 120)], body))
      .toEqual({ kind: "heading", id: "h4" });
  });
  it.each([-0.5, 0, 0.5, 1])("keeps the native fragment target at a fractional reading-line edge (%s)", (offset) => {
    expect(currentReadingChapter([heading("h2", -200), heading("h4", 96 + offset)], body))
      .toEqual({ kind: "heading", id: "h4" });
  });
  it("uses the same combined sticky-header padding and heading margin as native links", () => {
    expect(currentReadingChapter([heading("h2", -200), heading("h4", 189, 93 + 96)], body))
      .toEqual({ kind: "heading", id: "h4" });
    expect(currentReadingChapter([heading("h2", -200), heading("h4", 173, 77 + 96)], body))
      .toEqual({ kind: "heading", id: "h4" });
  });
  it("distinguishes the introduction from the area after the narrative", () => {
    expect(currentReadingChapter([heading("first", 500)], { top: 400, bottom: 1000 })).toEqual({ kind: "intro" });
    expect(currentReadingChapter([heading("last", -200)], { top: -400, bottom: 90 })).toEqual({ kind: "outside" });
  });
  it("does not invent a bottom-of-page chapter that never crossed the reading line", () => {
    expect(currentReadingChapter([heading("first", -200), heading("tail", 300)], body))
      .toEqual({ kind: "heading", id: "first" });
  });
  it.each([
    [], [heading("", 0)], [{ ...heading("hidden", 0), height: 0 }],
    [heading("later", 100), heading("earlier", 0)],
    [{ ...heading("bad", 0), top: NaN }],
    [{ ...heading("bad", 0), height: Infinity }],
    [heading("bad", 0, -1)], [heading("bad", 0, NaN)],
    [heading("before-body", -500)], [heading("after-body", 999)],
  ].map((headings) => ({ headings })))("refuses unusable or non-authored geometry", ({ headings }) => {
    expect(currentReadingChapter(headings, body)).toEqual({ kind: "invalid" });
  });
  it.each([{ top: NaN, bottom: 100 }, { top: 10, bottom: 10 }, { top: 11, bottom: 10 }])("refuses unusable body bounds", (bounds) => {
    expect(currentReadingChapter([heading("heading", 0)], bounds)).toEqual({ kind: "invalid" });
  });
});

import { describe, expect, it } from "vitest";
import {
  PARTIAL_PREFIX,
  RENDER_OPTIONS,
  checkRendition,
  formatCompileFailure,
  isDiagramPartial,
  renditionFileName,
  selectDiagramSources,
  summarizeCheck,
  type DiagramCheck,
} from "./diagram-rendering.mts";

describe("selecting diagram sources", () => {
  it("renders every .d2 file that is not a shared fragment", () => {
    expect(
      selectDiagramSources([
        "system-context.d2",
        "_shared.d2",
        "deployment-flow.d2",
      ]),
    ).toEqual(["deployment-flow.d2", "system-context.d2"]);
  });

  it("ignores files that are not D2 sources", () => {
    // The directory holds the generated renditions too, and a README. Only the
    // sources are compiled.
    expect(
      selectDiagramSources([
        "system-context.d2",
        "system-context.svg",
        "README.md",
      ]),
    ).toEqual(["system-context.d2"]);
  });

  it("orders sources so a run reports the same sequence every time", () => {
    // Directory order is filesystem-dependent. A gate whose output reorders
    // itself between two machines is a gate whose diff nobody trusts.
    expect(selectDiagramSources(["c.d2", "a.d2", "b.d2"])).toEqual([
      "a.d2",
      "b.d2",
      "c.d2",
    ]);
  });

  it("treats a leading underscore as the fragment marker", () => {
    expect(isDiagramPartial(`${PARTIAL_PREFIX}shared.d2`)).toBe(true);
    expect(isDiagramPartial("shared.d2")).toBe(false);
  });
});

describe("rendition paths", () => {
  it("keeps the source basename, so a reader knows which file to edit", () => {
    expect(renditionFileName("system-context.d2")).toBe("system-context.svg");
  });

  it("refuses anything that is not a D2 source", () => {
    expect(() => renditionFileName("system-context.svg")).toThrow(/\.d2/);
  });
});

describe("checking a committed rendition", () => {
  it("passes only on a byte-for-byte match", () => {
    expect(checkRendition("a.svg", "<svg>x</svg>", "<svg>x</svg>")).toEqual({
      diagram: "a.svg",
      state: "current",
    });
  });

  it("reports a source edited without regenerating as stale", () => {
    expect(checkRendition("a.svg", "<svg>old</svg>", "<svg>new</svg>")).toEqual({
      diagram: "a.svg",
      state: "stale",
    });
  });

  it("reports a diagram that was never rendered separately from a stale one", () => {
    // Different causes, different fixes. A contributor reading the failure
    // should not have to work out which of the two happened.
    expect(checkRendition("a.svg", undefined, "<svg>new</svg>")).toEqual({
      diagram: "a.svg",
      state: "missing",
    });
  });

  it("treats whitespace-only differences as drift", () => {
    // The committed file is a build artifact. "Close enough" is not a claim
    // this gate is able to make about it.
    expect(checkRendition("a.svg", "<svg>x</svg>\n", "<svg>x</svg>").state).toBe(
      "stale",
    );
  });
});

describe("summarizing a check run", () => {
  const current = (name: string): DiagramCheck => ({
    diagram: name,
    state: "current",
  });

  it("passes when every rendition matches", () => {
    const summary = summarizeCheck([current("a.svg"), current("b.svg")]);

    expect(summary.ok).toBe(true);
    expect(summary.message).toContain("2");
  });

  it("fails and names every diagram that drifted", () => {
    const summary = summarizeCheck([
      current("a.svg"),
      { diagram: "b.svg", state: "stale" },
      { diagram: "c.svg", state: "missing" },
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.message).toContain("b.svg");
    expect(summary.message).toContain("c.svg");
    expect(summary.message).not.toContain("a.svg");
  });

  it("names the command that fixes it", () => {
    // A failing gate that makes the reader search the repository for the
    // regeneration command has spent the one thing it should not cost.
    const summary = summarizeCheck([{ diagram: "b.svg", state: "stale" }]);

    expect(summary.message).toContain("npm run diagrams");
  });

  it("passes on an empty run rather than inventing a failure", () => {
    // The caller fails a run that found no sources at all; this function is
    // only asked whether what it was given is up to date.
    expect(summarizeCheck([]).ok).toBe(true);
  });
});

describe("reporting malformed D2", () => {
  it("unpacks D2's JSON error array into readable lines", () => {
    const error = new Error(
      JSON.stringify([
        {
          range: "system-context,2:0:17-2:3:20",
          errmsg: "system-context.d2:3:1: connection missing destination",
        },
      ]),
    );

    const formatted = formatCompileFailure("system-context.d2", error);

    expect(formatted).toContain("system-context.d2:3:1");
    expect(formatted).toContain("connection missing destination");
    // The raw JSON must not survive into the report.
    expect(formatted).not.toContain('errmsg"');
  });

  it("counts multiple problems", () => {
    const error = new Error(
      JSON.stringify([
        { range: "x,1:0:0-1:1:1", errmsg: "a.d2:1:1: first" },
        { range: "x,2:0:0-2:1:1", errmsg: "a.d2:2:1: second" },
      ]),
    );

    const formatted = formatCompileFailure("a.d2", error);

    expect(formatted).toContain("2 problems");
    expect(formatted).toContain("first");
    expect(formatted).toContain("second");
  });

  it("uses the singular for one problem", () => {
    const error = new Error(
      JSON.stringify([{ range: "x,1:0:0-1:1:1", errmsg: "a.d2:1:1: only" }]),
    );

    expect(formatCompileFailure("a.d2", error)).toContain("1 problem\n");
  });

  it("passes an unexpected failure through unchanged", () => {
    // A formatter that swallowed what it did not recognize would hide exactly
    // the failures nobody anticipated — a missing WASM file, an OOM, a worker
    // that died.
    const formatted = formatCompileFailure(
      "a.d2",
      new Error("worker terminated"),
    );

    expect(formatted).toBe("a.d2: worker terminated");
  });

  it("passes a thrown non-Error through unchanged", () => {
    expect(formatCompileFailure("a.d2", "boom")).toBe("a.d2: boom");
  });

  it("does not mistake unrelated JSON for a compile report", () => {
    expect(formatCompileFailure("a.d2", new Error('{"code":"ENOENT"}'))).toBe(
      'a.d2: {"code":"ENOENT"}',
    );
  });
});

describe("pinned render settings", () => {
  it("names every setting that moves geometry", () => {
    // Left to a default, any of these would let an unrelated tool update
    // rewrite every committed SVG, and the diff would no longer show what the
    // author actually changed.
    expect(RENDER_OPTIONS.layout).toBe("dagre");
    expect(RENDER_OPTIONS.pad).toBe(20);
    expect(RENDER_OPTIONS.sketch).toBe(false);
  });

  it("renders a dark palette as well as a light one", () => {
    // These are read on GitHub, which shows them in the reader's own colour
    // scheme. Without a dark theme, half the readers get dark text on a dark
    // page.
    expect(RENDER_OPTIONS.themeID).toBe(0);
    expect(RENDER_OPTIONS.darkThemeID).toBe(200);
  });
});

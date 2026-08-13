/**
 * The decisions behind `render-diagrams.mts`, separated from the file I/O so
 * they can be tested without a filesystem or a WASM engine (AB#133).
 *
 * Two properties make committed diagram renditions trustworthy, and both live
 * here:
 *
 *  - **Pinned settings.** A rendition is only reviewable in a pull request if
 *    the diff shows what the author changed and nothing else. Layout engine,
 *    theme, and padding all move geometry, so leaving any of them to a default
 *    would let an unrelated tool update rewrite every SVG in the repository. The
 *    engine version is pinned the same way, as an exact `@terrastruct/d2`
 *    version in `package.json` — `diagram-tool-pin.test.mts` fails the test gate
 *    if either pin loosens.
 *  - **Byte comparison.** `--check` re-renders the authoritative source and
 *    compares it to the committed file exactly. Not a semantic comparison: the
 *    committed SVG is a build artifact, and the only honest claim about it is
 *    that this commit's source and this commit's pinned renderer produce it.
 */

/** Where authoritative sources and their generated renditions both live. */
export const DIAGRAM_DIRECTORY = "docs/architecture";

/**
 * A `.d2` file whose name starts with an underscore is a shared fragment that
 * other diagrams import, not a diagram of its own, and gets no rendition. The
 * marker is in the filename rather than in a manifest so that adding a diagram
 * is one file and nothing else — a manifest is one more thing to forget, and
 * forgetting it would silently drop a diagram from the check.
 */
export const PARTIAL_PREFIX = "_";

/**
 * The render settings every diagram is produced with.
 *
 * `layout: "dagre"` is D2's default engine and the one these diagrams are drawn
 * for; naming it explicitly means a change of D2's default is not a change of
 * this repository's diagrams.
 *
 * `themeID: 0` is the neutral default palette and `darkThemeID: 200` its dark
 * counterpart. Both are set because these SVGs are read on GitHub, which
 * renders them in whichever colour scheme the reader is using: with only a
 * light theme, dark-mode readers get dark text on a dark page. D2 emits both
 * palettes behind a `prefers-color-scheme` rule inside the file, so one
 * artifact serves both.
 *
 * `pad: 20` trims D2's default 100px frame to something that does not dominate
 * an inline image in a Markdown document.
 *
 * `sketch` is deliberately left off. Sketch mode swaps in a handwriting font
 * and roughens every stroke, which reads as a whiteboard sketch rather than as
 * a maintained record — and it would add a second embedded typeface to every
 * committed file for no gain.
 */
export const RENDER_OPTIONS = {
  layout: "dagre",
  themeID: 0,
  darkThemeID: 200,
  pad: 20,
  sketch: false,
} as const;

/** Whether a `.d2` file is a shared fragment rather than a diagram. */
export function isDiagramPartial(fileName: string): boolean {
  return fileName.startsWith(PARTIAL_PREFIX);
}

/** Selects and orders the diagrams a run will render, from a directory listing. */
export function selectDiagramSources(
  fileNames: readonly string[],
): readonly string[] {
  return fileNames
    .filter((name) => name.endsWith(".d2") && !isDiagramPartial(name))
    .toSorted();
}

/**
 * The rendition path for a source. One source, one rendition, same basename —
 * so a reader who sees `system-context.svg` in a document knows without a lookup
 * which file to edit, and a reviewer sees both halves of a change side by side
 * in the same diff.
 */
export function renditionFileName(sourceFileName: string): string {
  if (!sourceFileName.endsWith(".d2")) {
    throw new Error(
      `Not a D2 source file: ${sourceFileName}. Diagram sources end in .d2.`,
    );
  }

  return `${sourceFileName.slice(0, -".d2".length)}.svg`;
}

/** What a `--check` run found for one diagram. */
export type DiagramCheck =
  | { readonly diagram: string; readonly state: "current" }
  | { readonly diagram: string; readonly state: "missing" }
  | { readonly diagram: string; readonly state: "stale" };

/**
 * Compares a freshly rendered diagram against what is committed.
 *
 * `committed` is `undefined` when no rendition exists yet. That is reported
 * separately from a stale one because the two have different causes — a new
 * diagram that was never rendered, versus a source edited without re-rendering
 * — and a contributor reading the failure should not have to guess which.
 */
export function checkRendition(
  diagram: string,
  committed: string | undefined,
  rendered: string,
): DiagramCheck {
  if (committed === undefined) {
    return { diagram, state: "missing" };
  }

  return committed === rendered
    ? { diagram, state: "current" }
    : { diagram, state: "stale" };
}

/**
 * Turns the results of a `--check` run into an operator-facing report.
 *
 * The failure message names the command that fixes it. A gate that only says
 * "out of date" makes the reader search the repository for the regeneration
 * command, and the one thing a failing CI step should never cost is a search.
 */
export function summarizeCheck(checks: readonly DiagramCheck[]): {
  readonly ok: boolean;
  readonly message: string;
} {
  const missing = checks.filter((check) => check.state === "missing");
  const stale = checks.filter((check) => check.state === "stale");

  if (missing.length === 0 && stale.length === 0) {
    return {
      ok: true,
      message: `All ${checks.length} architecture diagram renditions are up to date.`,
    };
  }

  const lines: string[] = [];

  for (const check of missing) {
    lines.push(
      `  ${check.diagram}: no committed rendition — it has never been rendered.`,
    );
  }

  for (const check of stale) {
    lines.push(
      `  ${check.diagram}: committed rendition does not match its source.`,
    );
  }

  return {
    ok: false,
    message: [
      `Architecture diagram renditions are out of date (${missing.length + stale.length} of ${checks.length}):`,
      ...lines,
      "",
      "The .d2 source is authoritative and the .svg is generated from it, so fix",
      "this by regenerating rather than by editing the SVG:",
      "",
      "    npm run diagrams",
      "",
      "then commit the changed .svg files alongside their source.",
    ].join("\n"),
  };
}

/** One position-tagged problem D2 reported in a source file. */
type D2CompileProblem = { readonly errmsg?: unknown };

/**
 * Renders a D2 compile failure as something a build log can be read for.
 *
 * D2 reports compile problems as an `Error` whose message is a JSON array of
 * `{ range, errmsg }` records, with the position already formatted into
 * `errmsg`. Printed raw, a single missing brace arrives as a wall of escaped
 * JSON. Parsed, it is the file, the line, and the problem — so the gate reports
 * malformed source the way a compiler would.
 *
 * Anything that does not parse as that shape is passed through unchanged. A
 * formatter that swallowed an unexpected error would hide exactly the failures
 * nobody anticipated.
 */
export function formatCompileFailure(
  sourceFileName: string,
  error: unknown,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const problems = parseCompileProblems(raw);

  if (problems === undefined) {
    return `${sourceFileName}: ${raw}`;
  }

  return [
    `${sourceFileName}: ${problems.length} problem${problems.length === 1 ? "" : "s"}`,
    ...problems.map((problem) => `  ${problem}`),
  ].join("\n");
}

function parseCompileProblems(raw: string): readonly string[] | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return undefined;
  }

  const messages = parsed.map((entry) => {
    const errmsg = (entry as D2CompileProblem | null)?.errmsg;
    return typeof errmsg === "string" ? errmsg : undefined;
  });

  return messages.every((message) => message !== undefined)
    ? (messages as readonly string[])
    : undefined;
}

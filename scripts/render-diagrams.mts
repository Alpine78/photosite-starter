#!/usr/bin/env node
/**
 * Renders every architecture diagram in `docs/architecture` from its D2 source.
 *
 *     npm run diagrams          # regenerate the committed .svg files
 *     npm run diagrams:check    # fail if any source is malformed or any .svg is stale
 *
 * The `.d2` files are authoritative and the `.svg` files beside them are build
 * artifacts that are never hand-edited. Both are committed, because a diagram
 * nobody can see without installing a toolchain is a diagram nobody reads: the
 * source is what a pull request reviews, and the rendition is what the
 * repository, GitHub, and the documentation display.
 *
 * `--check` is the CI gate. It compiles each source, which fails on malformed
 * D2, and compares a fresh rendition against the committed one byte for byte,
 * which fails when a source was edited without regenerating. Nothing is written
 * in that mode, so a build agent cannot "fix" the drift it is meant to report.
 *
 * All decisions live in `diagram-rendering.mts`, which has tests. This file is
 * the part that cannot be tested without a filesystem and the renderer: list
 * files, compile, render, write or compare, set an exit code.
 *
 * Runs on the Node major pinned in `package.json` (`engines.node`), which
 * executes TypeScript directly. Unlike the deployment scripts beside it, this
 * one does need a dependency — the diagram engine itself — pinned to an exact
 * version as a devDependency so the lockfile's integrity hash decides which
 * renderer produced the committed files.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { D2 } from "@terrastruct/d2";
import {
  DIAGRAM_DIRECTORY,
  RENDER_OPTIONS,
  checkRendition,
  formatCompileFailure,
  isDiagramPartial,
  renditionFileName,
  selectDiagramSources,
  summarizeCheck,
  type DiagramCheck,
} from "./diagram-rendering.mts";

const repositoryRoot = new URL("../", import.meta.url);
const diagramDirectory = new URL(`${DIAGRAM_DIRECTORY}/`, repositoryRoot);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Reads every `.d2` file in the directory into the map D2 resolves imports
 * against, keyed by filename.
 *
 * Partials are included and diagrams are compiled from it too: an import is
 * resolved against this map, not against the disk, so a fragment that is not
 * in it is a compile error rather than a silent read of whatever the process
 * happens to have access to.
 */
async function readDiagramSources(): Promise<Record<string, string>> {
  let fileNames: string[];

  try {
    fileNames = await readdir(diagramDirectory);
  } catch (error) {
    fail(
      `Could not read ${DIAGRAM_DIRECTORY}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const sources: Record<string, string> = {};

  for (const fileName of fileNames.filter((name) => name.endsWith(".d2"))) {
    sources[fileName] = await readFile(
      new URL(fileName, diagramDirectory),
      "utf8",
    );
  }

  return sources;
}

/** The committed rendition, or `undefined` when there is not one yet. */
async function readRendition(fileName: string): Promise<string | undefined> {
  try {
    return await readFile(new URL(fileName, diagramDirectory), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function main(): Promise<void> {
  const checkOnly = process.argv.slice(2).includes("--check");
  const sources = await readDiagramSources();
  const diagrams = selectDiagramSources(Object.keys(sources));

  if (diagrams.length === 0) {
    fail(
      `No diagram sources found in ${DIAGRAM_DIRECTORY}. Expected at least one .d2 file that is not a shared fragment.`,
    );
  }

  const d2 = new D2();
  const checks: DiagramCheck[] = [];
  const written: string[] = [];

  for (const sourceFileName of diagrams) {
    let svg: string;

    try {
      // The whole directory is passed as the import filesystem so a diagram can
      // share definitions with its siblings; `inputPath` selects which of them
      // is the diagram being rendered.
      const compiled = await d2.compile({
        fs: sources,
        inputPath: sourceFileName,
        options: { ...RENDER_OPTIONS },
      });

      svg = await d2.render(compiled.diagram, compiled.renderOptions);
    } catch (error) {
      // Malformed source is the failure this gate exists for, so it is reported
      // in D2's own file-and-position terms and stops the run. Continuing would
      // bury the one line that has to be fixed under the output of every
      // diagram that happened to still compile.
      fail(formatCompileFailure(sourceFileName, error));
    }

    const target = renditionFileName(sourceFileName);

    if (checkOnly) {
      checks.push(checkRendition(target, await readRendition(target), svg));
      continue;
    }

    // Written only when the bytes differ, so an unchanged diagram keeps its
    // modification time and a no-op run leaves the working tree alone.
    if ((await readRendition(target)) !== svg) {
      await writeFile(new URL(target, diagramDirectory), svg, "utf8");
      written.push(target);
    }
  }

  if (checkOnly) {
    const summary = summarizeCheck(checks);

    if (!summary.ok) {
      fail(summary.message);
    }

    console.log(summary.message);
    return;
  }

  const partials = Object.keys(sources).filter(isDiagramPartial).length;

  console.log(
    written.length === 0
      ? `${diagrams.length} architecture diagrams already up to date.`
      : `Rendered ${written.length} of ${diagrams.length} architecture diagrams:\n${written.map((name) => `  ${DIAGRAM_DIRECTORY}/${name}`).join("\n")}`,
  );

  if (partials > 0) {
    console.log(
      `(${partials} shared fragment${partials === 1 ? "" : "s"} imported, not rendered on ${partials === 1 ? "its" : "their"} own.)`,
    );
  }
}

// The renderer runs D2 in a worker, which keeps the event loop alive after the
// last render resolves. Exiting explicitly is what ends the process; without
// it the command hangs after printing its result.
await main();
process.exit(0);

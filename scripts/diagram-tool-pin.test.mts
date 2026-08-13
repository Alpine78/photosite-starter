import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The diagram toolchain pin, checked where it can actually break (AB#133).
 *
 * `docs/architecture` commits generated SVGs next to their authoritative D2
 * sources. That only stays honest while one renderer produces them: a floating
 * version would let an engine release rewrite every committed file, and the
 * diff of a one-line source edit would arrive as three rewritten artifacts
 * nobody can review.
 *
 * `npm run diagrams:check` proves the committed renditions match a fresh
 * render, but it can only do that with the renderer installed. These tests are
 * the cheap half that runs in the ordinary test gate: the version is exactly
 * pinned, the pipeline actually runs the check, and the committed artifacts all
 * came from the same engine — which is what catches a half-finished
 * regeneration after a version bump.
 */

const repositoryRoot = new URL("../", import.meta.url);

function readRepositoryFile(name: string): string {
  return readFileSync(new URL(name, repositoryRoot), "utf8");
}

const packageJson = JSON.parse(readRepositoryFile("package.json")) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const PIPELINE = readRepositoryFile("azure-pipelines.yml");

/** An exact version: `0.1.33`, never `^0.1.33`, `~0.1.33`, or a tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

describe("diagram renderer pin", () => {
  it("pins one exact version rather than a range", () => {
    expect(packageJson.devDependencies?.["@terrastruct/d2"]).toMatch(
      EXACT_VERSION,
    );
  });

  it("is a development dependency, never a runtime one", () => {
    // It renders documentation at author time. Nothing in the application
    // imports it, and a WASM engine of this size has no business in a
    // deployment's production dependency tree.
    expect(packageJson.dependencies?.["@terrastruct/d2"]).toBeUndefined();
  });

  it("exposes both the regenerate and the verify command", () => {
    expect(packageJson.scripts?.diagrams).toContain("render-diagrams.mts");
    expect(packageJson.scripts?.["diagrams:check"]).toContain("--check");
  });
});

describe("diagram gate", () => {
  it("runs the check in the pipeline's quality-gate stage", () => {
    // Without this step the committed SVGs drift from their sources silently,
    // and the first person to notice is a reader who trusted a stale picture.
    expect(PIPELINE).toContain("npm run diagrams:check");
  });

  it("runs the check before the deployment stage consumes anything", () => {
    // The check belongs with lint, test, and build — not after them in a stage
    // that a clone without hosting skips entirely.
    const checkIndex = PIPELINE.indexOf("npm run diagrams:check");
    const deployStageIndex = PIPELINE.indexOf("- stage: DeployPreview");

    expect(checkIndex).toBeGreaterThan(-1);
    expect(deployStageIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(deployStageIndex);
  });
});

describe("committed renditions", () => {
  const diagramDirectory = new URL("docs/architecture/", repositoryRoot);

  const renditions = readdirSync(diagramDirectory)
    .filter((name) => name.endsWith(".svg"))
    .toSorted();

  it("has a rendition for every source that is not a shared fragment", () => {
    const sources = readdirSync(diagramDirectory)
      .filter((name) => name.endsWith(".d2") && !name.startsWith("_"))
      .toSorted();

    expect(sources.length).toBeGreaterThan(0);
    expect(renditions).toEqual(
      sources.map((name) => name.replace(/\.d2$/, ".svg")),
    );
  });

  it("was produced by a single engine version", () => {
    // A bump that regenerated some diagrams and not others would otherwise
    // reach main looking fine — every file is valid SVG, and only the mixed
    // provenance gives it away.
    const versions = renditions.map((name) => {
      const svg = readFileSync(new URL(name, diagramDirectory), "utf8");
      return svg.match(/data-d2-version="([^"]*)"/)?.[1];
    });

    expect(versions).not.toContain(undefined);
    expect(new Set(versions).size).toBe(1);
  });
});

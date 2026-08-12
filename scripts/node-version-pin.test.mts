import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The runtime pin, checked where it can actually break.
 *
 * Three places name the Node major this project runs on: `package.json`
 * `engines`, which Vercel reads and which overrides whatever the project's
 * dashboard setting says; the pipeline's UseNode task, which decides what the
 * gates ran against; and the Vercel project's own setting, which the first two
 * override. ADR-0004 §2 pins them together rather than inheriting a platform
 * default, because that default moves with each LTS release — and a release
 * candidate built and tested on one major but executed on another is a
 * difference nobody chose.
 *
 * Only two of the three are in this repository. This test holds those two
 * together; the third is covered by `engines` taking precedence over it.
 */

const repositoryRoot = new URL("../", import.meta.url);

function readRepositoryFile(name: string): string {
  return readFileSync(new URL(name, repositoryRoot), "utf8");
}

/** Matches a named pipeline-level list variable, whatever indentation it carries. */
const PIPELINE_NODE_VERSION =
  /^\s*-\s+name:\s*nodeVersion\s*\n\s+value:\s*"([^"]+)"/m;

/** Matches the pinned Vercel CLI version alongside it. */
const PIPELINE_VERCEL_CLI_VERSION =
  /^\s*-\s+name:\s*vercelCliVersion\s*\n\s+value:\s*"([^"]+)"/m;

/** A major-only pin: `24.x`, never a range and never a full version. */
const MAJOR_PIN = /^(\d+)\.x$/;

const PIPELINE = readRepositoryFile("azure-pipelines.yml");
const packageJson = JSON.parse(readRepositoryFile("package.json")) as {
  engines?: { node?: string };
};

function readPipelineVariable(pattern: RegExp, name: string): string {
  const match = PIPELINE.match(pattern);

  if (match === null) {
    throw new Error(
      `Could not find the ${name} variable in azure-pipelines.yml. If it was renamed or reformatted, update this test with it — the pin it guards is the point, not the spelling.`,
    );
  }

  return match[1];
}

describe("Node runtime pin", () => {
  it("pins a single major in package.json rather than a range", () => {
    // A range such as ">=22" would leave the choice to whatever the platform
    // defaults to that month, which is the thing being pinned against.
    expect(packageJson.engines?.node).toMatch(MAJOR_PIN);
  });

  it("pins the same major in the pipeline that the deployment declares", () => {
    const pipelineVersion = readPipelineVariable(
      PIPELINE_NODE_VERSION,
      "nodeVersion",
    );
    const declared = packageJson.engines?.node ?? "";

    expect(pipelineVersion).toMatch(MAJOR_PIN);
    expect(pipelineVersion.match(MAJOR_PIN)?.[1]).toBe(
      declared.match(MAJOR_PIN)?.[1],
    );
  });
});

describe("Vercel CLI pin", () => {
  it("names one exact version, not a range", () => {
    // `^58.9.1` would let a CLI release change how a release candidate is
    // built or deployed between two runs of the same commit (ADR-0004 §3).
    expect(
      readPipelineVariable(PIPELINE_VERCEL_CLI_VERSION, "vercelCliVersion"),
    ).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Job = Readonly<{
  job: string;
  pool: string | Readonly<{ vmImage: string }>;
  workspace?: Readonly<{ clean: string }>;
}>;

type Stage = Readonly<{ stage: string; jobs: readonly Job[] }>;
type Pipeline = Readonly<{ stages: readonly Stage[]; variables: unknown }>;

const require = createRequire(import.meta.url);
const { load } = require("js-yaml") as { load: (source: string) => unknown };
const yaml = readFileSync(new URL("../azure-pipelines.yml", import.meta.url), "utf8");
const pipeline = load(yaml) as Pipeline;
const isolatedPool = "photosite-pr-isolated";

describe("CI credential isolation wiring (AB#416)", () => {
  it("assigns every job its own explicit pool and cleans self-hosted workspaces", () => {
    expect(pipeline.stages.map(({ stage, jobs }) => ({
      stage,
      jobs: jobs.map(({ job, pool, workspace }) => ({ job, pool, clean: workspace?.clean })),
    }))).toEqual([
      {
        stage: "Verify",
        jobs: [
          { job: "Verify", pool: isolatedPool, clean: "all" },
          { job: "Studio", pool: isolatedPool, clean: "all" },
        ],
      },
      { stage: "DependencyAudit", jobs: [{ job: "Audit", pool: isolatedPool, clean: "all" }] },
      { stage: "DeployPreview", jobs: [{ job: "DeployPreview", pool: { vmImage: "ubuntu-latest" } }] },
    ]);
    // A template or generated job needs an explicit review of its expanded pools.
    expect(JSON.stringify(pipeline)).not.toMatch(/"(?:extends|template|\$\{\{[^"]+)"\s*:/u);
  });

  it("keeps variable groups and deployment credential inputs off the self-hosted jobs", () => {
    const nonDeployment = {
      variables: pipeline.variables,
      stages: pipeline.stages.filter(({ stage }) => stage !== "DeployPreview"),
    };
    expect(JSON.stringify(nonDeployment)).not.toMatch(
      /"group"\s*:|\b(?:VERCEL_TOKEN|VERCEL_AUTOMATION_BYPASS_SECRET|SANITY_BUILD_READ_TOKEN)\b/u,
    );
  });
});

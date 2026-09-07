import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The contract between `azure-pipelines.yml` and `repoint-preview-alias.mts`.
 *
 * The unit tests for the orchestrator and the SHA validator prove the revision
 * gate (AB#144) *decides* correctly. They cannot see whether the pipeline
 * actually hands the executable the commit it built: a missing argument fails
 * closed (the executable refuses without three arguments), so every unit test
 * and local gate would still pass while every real repoint failed. This test
 * locks that one wiring fact.
 */

const PIPELINE = readFileSync(
  new URL("../azure-pipelines.yml", import.meta.url),
  "utf8",
);

describe("Preview alias repoint pipeline wiring", () => {
  it("passes the built commit SHA to the repoint executable", () => {
    // Loose on formatting (line breaks, quoting) but strict on the fact: the
    // `repoint:preview` invocation forwards `$(Build.SourceVersion)` — the
    // commit this DeployPreview run built — so the executable can compare it
    // with the live `main` tip.
    const invocation = PIPELINE.match(
      /npm run repoint:preview[\s\S]{0,240}?Build\.SourceVersion/,
    );

    expect(
      invocation,
      "azure-pipelines.yml must call `npm run repoint:preview` with $(Build.SourceVersion) as an argument (AB#144). If the step was reformatted, update this test — the wiring is the point, not the spelling.",
    ).not.toBeNull();
  });

  it("keeps the repoint step gated on a verified deployment", () => {
    // The revision gate is additional to, not a replacement for, the existing
    // "only repoint a verified deployment" condition.
    expect(PIPELINE).toMatch(/previewDeploymentVerified'\], 'true'/);
  });

  it("passes PREVIEW_STABLE_ALIAS into the release-candidate build step (AB#136)", () => {
    // `next.config.ts` bakes the alias-host `X-Robots-Tag: noindex` rule at
    // build time (`src/lib/preview-noindex-alias.ts`), and `vercel pull` does
    // not write this variable-group value. Without this wiring the Preview
    // build fails closed by design (VERCEL_ENV=preview with no alias throws),
    // so this test documents the requirement and catches a reformat that drops
    // it. Loose on formatting, strict on the fact.
    const buildStep = PIPELINE.match(
      /vercel build --target=preview[\s\S]{0,600}?PREVIEW_STABLE_ALIAS: \$\(PREVIEW_STABLE_ALIAS\)/,
    );

    expect(
      buildStep,
      "azure-pipelines.yml's `vercel build --target=preview` step must pass PREVIEW_STABLE_ALIAS in its env: block (AB#136). If the step was reformatted, update this test — the wiring is the point.",
    ).not.toBeNull();
  });
});

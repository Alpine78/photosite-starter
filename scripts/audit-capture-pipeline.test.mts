import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const yaml = readFileSync(new URL("../azure-pipelines.yml", import.meta.url), "utf8");
const audit = yaml.split("  - stage: DependencyAudit\n")[1]?.split("  - stage: DeployPreview\n")[0];
if (!audit) throw new Error("Dependency audit stage missing");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
describe("scheduled audit capture wiring", () => {
  it("retains main-only daily scheduling and cancellation-aware stage admission", () => {
    expect(yaml).toContain('cron: "0 6 * * *"');
    const schedule = yaml.split("schedules:\n")[1].split("variables:\n")[0];
    expect(schedule).toMatch(/include:\s+- main/); expect(schedule).toContain("always: true");
    expect(audit).toContain("dependsOn: []");
    expect(audit).toContain("condition: and(succeeded(), eq(variables['Build.Reason'], 'Schedule'))");
    expect(audit).toContain('pool: "Default"');
  });
  it("runs one orchestrator for both trees and publishes only the current ready leaf", () => {
    expect(packageJson.scripts["capture:audit"]).toBe("node scripts/capture-npm-audit.mts");
    expect(audit.match(/npm run --silent capture:audit/g)).toHaveLength(1);
    expect(audit).toContain('dependencyAuditReady: "false"');
    expect(audit).toContain("condition: and(succeededOrFailed(), eq(variables['dependencyAuditReady'], 'true'))");
    expect(audit).toContain("targetPath: '$(Build.ArtifactStagingDirectory)/dependency-audit-$(Build.BuildId)-$(System.JobAttempt)'");
    expect(audit).toContain("artifact: 'dependency-audit-$(System.JobAttempt)'");
    expect(audit.indexOf("capture:audit")).toBeLessThan(audit.indexOf("PublishPipelineArtifact@1"));
    expect(audit).not.toMatch(/continueOnError|always\(|^\s+npm audit|npm (?:install|ci)|registry=|variable.?group|AGENT_TEMPDIRECTORY.*targetPath/m);
  });
  it("keeps the browser diagnostic guards separate from the audit job", () => {
    expect(yaml).toContain("condition: and(succeededOrFailed(), eq(variables['browserDiagnosticsAvailable'], 'true'))");
    expect(yaml).toContain('targetPath: "playwright-report"');
    expect(audit).not.toContain("browserDiagnosticsAvailable");
  });
});

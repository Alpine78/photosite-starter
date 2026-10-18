#!/usr/bin/env node
/** CI-owned capture only; never stream raw npm output or exception messages. */
import { captureAudits } from "./npm-audit-capture-io.mts";
import { AuditCaptureError } from "./npm-audit-capture.mts";

const controller = new AbortController();
const cancel = () => controller.abort();
process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
const fail = () => { console.error("Dependency audit failed: internal"); process.exitCode = 2; controller.abort(); };
process.on("uncaughtException", fail); process.on("unhandledRejection", fail);
try {
  console.log("##vso[task.setvariable variable=dependencyAuditReady]false");
  if (process.argv.length !== 2) throw new AuditCaptureError("configuration");
  const result = await captureAudits({
    root: process.cwd(), temporaryRoot: process.env.AGENT_TEMPDIRECTORY ?? "",
    artifactRoot: process.env.BUILD_ARTIFACTSTAGINGDIRECTORY ?? "", npmCli: process.env.npm_execpath ?? "",
    buildId: process.env.BUILD_BUILDID ?? "", jobAttempt: process.env.SYSTEM_JOBATTEMPT ?? "", signal: controller.signal,
    ready: () => console.log("##vso[task.setvariable variable=dependencyAuditReady]true"),
    status: (target, status, code) => console.log(`Dependency audit ${target}: ${status}; gate=${code}`),
  });
  process.exitCode = result.gateExit;
} catch (error) {
  console.error(`Dependency audit failed: ${error instanceof AuditCaptureError ? error.code : "internal"}`);
  process.exitCode = 2;
} finally {
  process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
  process.removeListener("uncaughtException", fail); process.removeListener("unhandledRejection", fail);
}

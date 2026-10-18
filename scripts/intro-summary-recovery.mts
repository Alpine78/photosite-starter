/** Read-only access to an approved intro recovery record; no CMS write imports. */
import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { recomputeIntroSummaryDigest, type IntroSummaryPlan } from "./joomla-intro-summary.mts";

class IntroSummaryWriteError extends Error {
  constructor(message: string) { super(message); this.name = "IntroSummaryWriteError"; }
}
function fail(message: string): never { throw new IntroSummaryWriteError(message); }

export const recoveryFileName = (digest: string) => `intro-summary-approved-${digest}.json`;

export async function readRecoveryRecord(outDir: string, digest: string): Promise<IntroSummaryPlan | undefined> {
  const filePath = path.join(outDir, recoveryFileName(digest));
  try {
    if (!(await stat(filePath)).isFile()) fail("The intro recovery entry must resolve to a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try { await lstat(filePath); } catch (entryError) {
        if ((entryError as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      }
    }
    fail("The intro recovery entry cannot be read; restore it before continuing");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(filePath));
    const plan = JSON.parse(text) as IntroSummaryPlan;
    if (plan.digest !== digest || recomputeIntroSummaryDigest(plan) !== digest) {
      fail("The intro recovery record does not match its digest; restore it before continuing");
    }
    return plan;
  } catch {
    fail("The intro recovery record is invalid or unreadable; restore it before continuing");
  }
}


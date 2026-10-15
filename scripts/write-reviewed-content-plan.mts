/** Owner-run, revision-guarded application of an explicit small CMS correction plan. */
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planState, reviewPlan, versionConflicts, type ReviewedContentPlan } from "./reviewed-content-plan.mts";
import { parseSeedConnection, runSeedMutationBatches, runSeedQuery, type SeedConnection } from "./sanity-seed-http.mts";

type Options = { planPath: string; approvedDigest?: string; out?: string; apply: boolean };

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes") { apply = true; continue; }
    if (!arg || !["--plan", "--approved-digest", "--out"].includes(arg) || !argv[i + 1] || argv[i + 1]?.startsWith("--")) {
      throw new Error(`Invalid option ${arg ?? ""}`);
    }
    values.set(arg, argv[++i] as string);
  }
  const planPath = values.get("--plan");
  if (!planPath) throw new Error("--plan <path> is required");
  const approvedDigest = values.get("--approved-digest");
  const out = values.get("--out");
  if (apply && (!approvedDigest || !/^[0-9a-f]{64}$/.test(approvedDigest) || !out)) {
    throw new Error("--yes requires --approved-digest <sha256> and --out <recovery directory>");
  }
  return { planPath, apply, ...(approvedDigest ? { approvedDigest } : {}), ...(out ? { out } : {}) };
}

async function readDocuments(connection: SeedConnection, plan: ReviewedContentPlan): Promise<readonly Record<string, unknown>[]> {
  const result = await runSeedQuery(connection, {
    query: "*[_id in $ids]",
    params: { ids: plan.rows.map((row) => row.id) },
    perspective: "raw",
  });
  if (!Array.isArray(result)) throw new Error("Unexpected CMS document response");
  return result;
}

async function readVersionIds(connection: SeedConnection): Promise<readonly string[]> {
  const result = await runSeedQuery(connection, {
    query: '*[_type in ["article", "service", "homePage"]]._id',
    perspective: "raw",
  });
  if (!Array.isArray(result) || result.some((id) => typeof id !== "string")) {
    throw new Error("Unexpected CMS version response");
  }
  return result;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(argv);
  const bytes = await readFile(options.planPath);
  const { plan, mutations } = reviewPlan(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  console.log(`Plan ${plan.digest}: ${plan.rows.length} documents; ${mutations.length} guarded patches.`);
  for (const row of plan.rows) console.log(`${row.before._type} ${row.id} @ ${row.revision}`);
  if (!options.apply) {
    console.log("Dry run only. No credential was read and nothing was written.");
    return;
  }
  if (options.approvedDigest !== plan.digest) throw new Error("Approved digest differs from reviewed plan");
  if (process.env.NEXT_PUBLIC_SANITY_MIGRATION_TOKEN) throw new Error("Migration token must never have a NEXT_PUBLIC_ prefix");
  const token = process.env.SANITY_MIGRATION_TOKEN;
  const apiVersion = process.env.SANITY_API_VERSION;
  if (!token || !apiVersion || process.env.SANITY_PROJECT_ID !== plan.target.projectId ||
      process.env.SANITY_DATASET !== plan.target.dataset) {
    throw new Error("Migration credential/API version or target configuration is missing or differs from the plan");
  }
  const connection = parseSeedConnection({ ...plan.target, apiVersion, token });
  const state = planState(plan, await readDocuments(connection, plan));
  if (state === "after") { console.log("This plan is already applied."); return; }
  if (state !== "before") throw new Error("Current CMS documents differ from the reviewed revisions; no write occurred");
  const conflicts = versionConflicts(plan, await readVersionIds(connection));
  if (conflicts.length) throw new Error(`${conflicts.length} planned documents have a draft or release version; no write occurred`);

  const out = options.out as string;
  await mkdir(out, { recursive: true, mode: 0o700 });
  if (!(await lstat(out)).isDirectory()) throw new Error("Recovery path is not a real directory");
  await chmod(out, 0o700);
  const recovery = path.join(out, `reviewed-content-approved-${plan.digest}.json`);
  try {
    await writeFile(recovery, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" ||
        !(await lstat(recovery)).isFile() || !bytes.equals(await readFile(recovery))) {
      throw new Error("Recovery record exists with different content or cannot be read");
    }
  }
  await chmod(recovery, 0o600);
  if (versionConflicts(plan, await readVersionIds(connection)).length) {
    throw new Error("A draft or release version appeared before the write; no write occurred");
  }
  let writeError: unknown;
  try {
    await runSeedMutationBatches(connection, mutations, { batchSize: mutations.length });
  } catch (error) { writeError = error; }
  const after = planState(plan, await readDocuments(connection, plan));
  const lateVersions = versionConflicts(plan, await readVersionIds(connection));
  console.log(`Readback: ${after}; version conflicts: ${lateVersions.length}; recovery: ${recovery}`);
  if (after !== "after" || lateVersions.length) {
    throw new Error(writeError instanceof Error ? `Write uncertain: ${writeError.message}` : "Write readback did not match the approved plan");
  }
  console.log("All approved patches applied and verified.");
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`Reviewed content write failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

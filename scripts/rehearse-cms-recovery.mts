import { argumentsOf } from "./private-operation-files.mts";
import { rehearseRecovery } from "./cms-recovery-files.mts";
async function main() {
  const args = argumentsOf(process.argv.slice(2), ["manifest", "snapshot", "snapshot-sha256", "out"]);
  const receipt = await rehearseRecovery({ manifest: args.manifest, snapshot: args.snapshot, snapshotSha256: args["snapshot-sha256"], out: args.out });
  const { assets: _assets, ...summary } = receipt; void _assets;
  console.log(JSON.stringify(summary));
}
main().catch(() => { console.error("[rehearse-cms-recovery] Recovery refused; partial private output may remain. No completed receipt was issued."); process.exitCode = 1; });

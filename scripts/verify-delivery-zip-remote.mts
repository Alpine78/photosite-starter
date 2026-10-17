/** Anonymous whole-object read only. No files, credentials, upload or app configuration. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRemoteZipDeclaration, RemoteZipInputError, verifyRemoteDeliveryZip } from "./delivery-zip-remote-integrity.mts";

export function parseRemoteZipArguments(argv: readonly string[]) {
  const fields = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!["--project-id", "--dataset", "--asset-id", "--bytes", "--sha256"].includes(flag) ||
      fields.has(flag) || typeof value !== "string" || value.length > 128 || value.length < 1 || value.startsWith("--")) throw new RemoteZipInputError();
    fields.set(flag, value);
  }
  const bytes = fields.get("--bytes");
  if (fields.size !== 5 || bytes === undefined || !/^[1-9]\d{0,9}$/u.test(bytes)) throw new RemoteZipInputError();
  return parseRemoteZipDeclaration({ projectId: fields.get("--project-id"), dataset: fields.get("--dataset"),
    assetId: fields.get("--asset-id"), bytes: Number(bytes), sha256: fields.get("--sha256") });
}

/** Injectable output/fetch keeps every argument refusal provably before network work. */
export async function remoteZipMain(argv: readonly string[], options: {
  fetchImplementation?: typeof fetch; stdout?: (line: string) => void; stderr?: (line: string) => void;
} = {}): Promise<number> {
  const stdout = options.stdout ?? console.log, stderr = options.stderr ?? console.error;
  try {
    const declaration = parseRemoteZipArguments(argv);
    const report = await verifyRemoteDeliveryZip(declaration, { fetchImplementation: options.fetchImplementation });
    stdout(JSON.stringify(report));
    return report.status === "matched" ? 0 : 1;
  } catch (error) {
    stderr(error instanceof RemoteZipInputError ? "[remote-zip] INVALID_INPUT" : "[remote-zip] VERIFICATION_FAILED");
    return error instanceof RemoteZipInputError ? 2 : 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await remoteZipMain(process.argv.slice(2));
}

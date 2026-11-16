/**
 * AB#421: the shared write-safety rules of the owner-run Sanity writers. Pure: no IO, no network.
 *
 * - `readWriteToken` is the one check every write-token reader uses. A copy of the token under a
 *   `NEXT_PUBLIC_` name is refused rather than ignored, the rule `src/lib/sanity-config.ts`
 *   enforces for the runtime read token: Next.js compiles `NEXT_PUBLIC_` values into the browser
 *   bundle, so its presence means a write credential is already on its way to every visitor, and
 *   quietly preferring the server-only copy would leave the leak in place. A token is never accepted
 *   as a flag (shell history, process listings), and neither message ever contains any part of it.
 * - `formatWriteTarget` is the line a writer prints before its first network request, so a reviewed
 *   plan cannot silently go to whatever project or dataset an inherited environment names.
 * - `WriteRunProgress` is the small record a writer leaves when a run stops after an upload or a
 *   mutation: the uploaded asset ids and the last completed batch. It is evidence for reconciling
 *   by hand, not a resume file, and it holds no token, document content or error text.
 */

export type WriteEnvironment = Readonly<Record<string, string | undefined>>;

export type WriteCredentialErrorCode = "PUBLIC_TOKEN_REFUSED" | "TOKEN_REQUIRED";

export class WriteCredentialError extends Error {
  readonly code: WriteCredentialErrorCode;
  readonly variable: string;

  constructor(code: WriteCredentialErrorCode, variable: string, message: string) {
    super(message);
    this.name = "WriteCredentialError";
    this.code = code;
    this.variable = variable;
  }
}

/** Throws when `NEXT_PUBLIC_<name>` holds a value. Used where the same token also serves a read. */
export function refusePublicTokenCopy(environment: WriteEnvironment, name: string): void {
  const publicName = `NEXT_PUBLIC_${name}`;
  if (environment[publicName]?.trim()) {
    throw new WriteCredentialError(
      "PUBLIC_TOKEN_REFUSED",
      name,
      `${publicName} is set: a NEXT_PUBLIC_ value is compiled into the browser bundle, so this write credential must never use that name. Remove it and set ${name} instead.`,
    );
  }
}

/** The write token from the environment only, after refusing a public copy of it. */
export function readWriteToken(environment: WriteEnvironment, name: string): string {
  refusePublicTokenCopy(environment, name);
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new WriteCredentialError("TOKEN_REQUIRED", name, `${name} is required (this tool never accepts a token as a flag)`);
  }
  return value;
}

export type SanityWriteTarget = Readonly<{ projectId: string; dataset: string; apiVersion: string }>;

/**
 * The target line. Takes the three fields explicitly so a connection object, which also carries
 * the token, can be passed without the token ever reaching the output.
 */
export function formatWriteTarget({ projectId, dataset, apiVersion }: SanityWriteTarget): string {
  return `Sanity target: project ${projectId}, dataset ${dataset}, API version ${apiVersion}`;
}

/** Also the file name a writer with a private `--out` directory uses for the record. */
export const PARTIAL_RUN_FILE = "partial-run.json";
/** The prefix of the one stderr line a writer without an output directory prints instead. */
export const PARTIAL_RUN_LINE_PREFIX = "PARTIAL_RUN ";

export type PartialRunRecord = Readonly<{
  version: 1;
  target: SanityWriteTarget;
  uploadedAssetIds: readonly string[];
  completedBatches: number;
  /** A label such as `media 2/3`, or null when no batch completed. */
  lastCompletedBatch: string | null;
  note: string;
}>;

export class WriteRunProgress {
  readonly #target: SanityWriteTarget;
  readonly #uploadedAssetIds: string[] = [];
  #completedBatches = 0;
  #lastCompletedBatch: string | null = null;
  #started = false;

  constructor({ projectId, dataset, apiVersion }: SanityWriteTarget) {
    this.#target = { projectId, dataset, apiVersion };
  }

  /** Call before the first upload or mutation request; a failure before it leaves nothing to record. */
  start(): void {
    this.#started = true;
  }

  get started(): boolean {
    return this.#started;
  }

  recordUpload(assetId: string): void {
    this.#uploadedAssetIds.push(assetId);
  }

  recordBatch(label: string): void {
    this.#completedBatches += 1;
    this.#lastCompletedBatch = label;
  }

  /** A `runSeedMutationBatches` `onBatchCommitted` callback labelled with the wave's name. */
  batchRecorder(wave: string): (completed: number, total: number) => void {
    return (completed, total) => this.recordBatch(`${wave} ${completed}/${total}`);
  }

  toRecord(): PartialRunRecord {
    return {
      version: 1,
      target: this.#target,
      uploadedAssetIds: [...this.#uploadedAssetIds],
      completedBatches: this.#completedBatches,
      lastCompletedBatch: this.#lastCompletedBatch,
      note: "The run stopped after it began writing. Nothing was rolled back. Reconcile the target's current state before any re-run.",
    };
  }
}

export function formatPartialRunLine(record: PartialRunRecord): string {
  return `${PARTIAL_RUN_LINE_PREFIX}${JSON.stringify(record)}`;
}

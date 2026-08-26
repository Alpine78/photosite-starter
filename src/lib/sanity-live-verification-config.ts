/**
 * Pure configuration helpers for `sanity-live-verification.test.ts` (AB#138).
 * Kept in a separate, non-test module deliberately: that file has top-level
 * `describe`/`it` blocks that reach a real network, so anything importing
 * functions out of it would also register (and, under `npm test`, attempt to
 * run) those live tests despite `vitest.config.mts`'s exclusion of that file
 * from the default suite. A plain unit test can safely import from here.
 *
 * No `server-only` marker: this module does no IO of its own (it neither
 * reads `process.env` nor touches the filesystem) — every value it needs is
 * passed in, which is also what makes it trivially unit-testable.
 */

import { isAbsolute, resolve } from "node:path";

/** Set to point the live-verification suite at an env file other than the default Preview one. */
export const LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR = "SANITY_LIVE_VERIFICATION_ENV_FILE";

/**
 * The env-file keys that identify *which* Sanity project and dataset this
 * suite reads. Every one of these must be defined by the selected env file
 * itself — see `assertLiveVerificationTargetIsSelfContained` — rather than
 * silently inherited from whatever is already in the ambient shell
 * environment, which would let a selected file naming a different or
 * incomplete target quietly resolve part of itself against an unrelated
 * project a developer happened to have exported for other work.
 */
export const REQUIRED_LIVE_VERIFICATION_TARGET_KEYS = [
  "SANITY_PROJECT_ID",
  "SANITY_DATASET",
  "SANITY_DATASET_VISIBILITY",
  "SANITY_API_VERSION",
] as const;

export class LiveVerificationConfigError extends Error {
  constructor(message: string) {
    super(`[sanity-live-verification-config] ${message}`);
    this.name = "LiveVerificationConfigError";
  }
}

/**
 * Resolves the `.env` file this suite loads. Defaults to the existing
 * `.vercel/.env.preview.local` path when `SANITY_LIVE_VERIFICATION_ENV_FILE`
 * is unset, so the suite's default behavior (and every existing invocation
 * of `npm run verify:sanity-live`) is unchanged. A relative override is
 * resolved against `cwd`, matching how the default path itself is built; an
 * absolute override is used as-is. An override that is present but empty or
 * whitespace-only is a configuration error, not a silent fall-through to the
 * default — an operator who set the variable meant to point somewhere.
 */
export function resolveLiveVerificationEnvFile(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): string {
  const override = env[LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR];
  if (override === undefined) {
    return resolve(cwd, ".vercel", ".env.preview.local");
  }
  const trimmed = override.trim();
  if (trimmed.length === 0) {
    throw new LiveVerificationConfigError(
      `${LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR} was set to an empty or whitespace-only value`,
    );
  }
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

/**
 * Refuses to run this suite's target against a hybrid configuration —
 * partly the selected env file, partly whatever the ambient process
 * environment already happened to hold. Every key in
 * `REQUIRED_LIVE_VERIFICATION_TARGET_KEYS` must be present and non-blank in
 * the file that was actually loaded; a missing one is a configuration error
 * naming the file and the missing key, not a silent read of an unrelated
 * ambient value that could belong to an entirely different Sanity project.
 */
export function assertLiveVerificationTargetIsSelfContained(
  parsedEnvFileContent: Readonly<Record<string, string>>,
  envFilePath: string,
): void {
  const missing = REQUIRED_LIVE_VERIFICATION_TARGET_KEYS.filter(
    (key) => (parsedEnvFileContent[key] ?? "").trim().length === 0,
  );
  if (missing.length > 0) {
    throw new LiveVerificationConfigError(
      `${envFilePath} does not define ${missing.join(", ")}. Every target-identifying setting ` +
        "must come from the selected env file itself, never an ambient environment variable, so " +
        "this suite can never assemble its target from two different sources.",
    );
  }
}

import { describe, expect, it } from "vitest";

import {
  assertLiveVerificationTargetIsSelfContained,
  LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR,
  LiveVerificationConfigError,
  resolveLiveVerificationEnvFile,
} from "./sanity-live-verification-config";

const CWD = "/repo";

describe("resolveLiveVerificationEnvFile", () => {
  it("defaults to .vercel/.env.preview.local under cwd when unset", () => {
    expect(resolveLiveVerificationEnvFile({}, CWD)).toBe("/repo/.vercel/.env.preview.local");
  });

  it("resolves a relative override against cwd", () => {
    expect(
      resolveLiveVerificationEnvFile({ [LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR]: ".vercel/.env.production.local" }, CWD),
    ).toBe("/repo/.vercel/.env.production.local");
  });

  it("uses an absolute override as-is", () => {
    expect(
      resolveLiveVerificationEnvFile(
        { [LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR]: "/secrets/production.env" },
        CWD,
      ),
    ).toBe("/secrets/production.env");
  });

  it("rejects an empty override rather than silently falling back to the default", () => {
    expect(() => resolveLiveVerificationEnvFile({ [LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR]: "" }, CWD)).toThrow(
      LiveVerificationConfigError,
    );
  });

  it("rejects a whitespace-only override", () => {
    expect(() => resolveLiveVerificationEnvFile({ [LIVE_VERIFICATION_ENV_FILE_OVERRIDE_VAR]: "   " }, CWD)).toThrow(
      LiveVerificationConfigError,
    );
  });
});

describe("assertLiveVerificationTargetIsSelfContained", () => {
  const completeTarget = {
    SANITY_PROJECT_ID: "abc123",
    SANITY_DATASET: "production",
    SANITY_DATASET_VISIBILITY: "private",
    SANITY_API_VERSION: "v2026-06-24",
  };

  it("passes when every required target key is present and non-blank", () => {
    expect(() => assertLiveVerificationTargetIsSelfContained(completeTarget, "/repo/.env.production.local")).not.toThrow();
  });

  it("throws naming the missing key when one is absent", () => {
    const incomplete = Object.fromEntries(
      Object.entries(completeTarget).filter(([key]) => key !== "SANITY_DATASET"),
    );
    expect(() => assertLiveVerificationTargetIsSelfContained(incomplete, "/repo/.env.production.local")).toThrow(
      /SANITY_DATASET/,
    );
  });

  it("treats a blank value the same as a missing key", () => {
    const withBlank = { ...completeTarget, SANITY_API_VERSION: "   " };
    expect(() => assertLiveVerificationTargetIsSelfContained(withBlank, "/repo/.env.production.local")).toThrow(
      /SANITY_API_VERSION/,
    );
  });
});

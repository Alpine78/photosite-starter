/**
 * Configuration of the reminder run: off unless `PROOF_REMINDERS=enabled`, and
 * then only with the selection route's credential, the key secret and a cron
 * secret of at least 16 characters; anything incomplete is reported.
 */
import "server-only";
import { readProofSelectionConfig } from "@/lib/proof-selection-request";
import { readProofSelectionKeySecret } from "@/lib/proof-selection-key";

export type ProofReminderConfig =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "enabled"; token: string; secret: Buffer; cronSecret: string }>;

export function readProofReminderConfig(environment: Readonly<Record<string, string | undefined>>): ProofReminderConfig {
  if (environment.PROOF_REMINDERS?.trim() !== "enabled") return { state: "disabled" };
  const selection = readProofSelectionConfig(environment);
  const cronSecret = environment.CRON_SECRET?.trim() ?? "";
  if (selection.state !== "enabled" || cronSecret.length < 16 || environment.NEXT_PUBLIC_CRON_SECRET?.trim()) return { state: "misconfigured" };
  try {
    return { state: "enabled", token: selection.token, secret: readProofSelectionKeySecret(environment), cronSecret };
  } catch {
    return { state: "misconfigured" };
  }
}

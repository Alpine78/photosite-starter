/**
 * Which environment this deployment *is*, as the deployment itself declares it.
 *
 * Its own module rather than a corner of `deployment-config.ts`, because the
 * safeguards that consult it are the things `deployment-config.ts` validates:
 * the content source refuses demo fixtures in production, and the contact
 * form's sink adapter refuses to accept mail it will not send. Keeping the
 * stage here lets both be read during configuration without the configuration
 * and its guards importing each other in a circle.
 */

export type DeploymentStage = "development" | "preview" | "production";

const DEPLOYMENT_STAGES: readonly DeploymentStage[] = [
  "development",
  "preview",
  "production",
];

const DEPLOYMENT_STAGE_SETTING = "SITE_DEPLOYMENT_STAGE";

/**
 * Reads the declared deployment stage.
 *
 * An unset value means `production`, which is the fail-closed direction: an
 * operator who forgets the setting gets the environment with the safeguards
 * on, not the one that quietly accepts a development shortcut. Local
 * development and CI declare themselves explicitly, which `.env.example`, the
 * Azure Pipelines build step, and the Playwright harness all do.
 */
export function readDeploymentStage(
  environment: Record<string, string | undefined>,
): DeploymentStage {
  const value = environment[DEPLOYMENT_STAGE_SETTING]?.trim();
  if (!value) return "production";

  if (!DEPLOYMENT_STAGES.includes(value as DeploymentStage)) {
    throw new Error(
      `[deployment-config] Invalid ${DEPLOYMENT_STAGE_SETTING}: expected one of ${DEPLOYMENT_STAGES.join(", ")}, received "${value}"`,
    );
  }
  return value as DeploymentStage;
}

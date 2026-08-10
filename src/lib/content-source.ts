/**
 * Where this deployment's authored content comes from.
 *
 * The project ships a mock data layer so the site runs, builds, and is testable
 * before a CMS exists. That layer is demo content: placeholder copy about a
 * studio nobody owns, and AI-generated placeholder photographs. It is exactly
 * right for development, CI, and the Playwright harness, and it is the wrong
 * thing for a real photographer's visitors to read.
 *
 * So the source is declared, never inferred. There is no default: a default of
 * `mock` would let a production deployment serve demo content to the public
 * because someone forgot a setting, and a default of `sanity` would make every
 * developer machine fail until it had a project to talk to. A deployment that
 * declares nothing gets a configuration error naming the setting it needs,
 * which is the one outcome that cannot be mistaken for working.
 *
 * On top of that, a production deployment may not select `mock` at all. That is
 * the same shape of safeguard the contact form's sink adapter carries: a mode
 * that is correct everywhere else is silent misrepresentation in production —
 * a live site quietly presenting someone else's placeholder work as the
 * photographer's own. Documentation saying so is not a control; this is.
 *
 * The source is read as part of `loadDeploymentConfig`, not lazily at the first
 * content read. That matters: every route resolves the deployment config, so a
 * production deployment declaring `mock` fails while it is being built, and a
 * deployment declaring nothing fails there too. A guard that only fired once
 * some future adapter happened to consult it would be a guard in name only.
 *
 * This module decides *which* store. It never reaches one, and it holds no
 * credential — that is `sanity-config.ts` and `sanity-client.ts`.
 */

import type { DeploymentStage } from "@/lib/deployment-stage";

const contentSourceSettingName = "SITE_CONTENT_SOURCE";

/**
 * `mock` reads the project's own fixture layer in `src/lib`. `sanity` reads the
 * customer-owned Content Lake through the project's adapters. There is
 * deliberately no third value that mixes them: a per-seam fallback is how a
 * site ends up publishing half real content and half demo content without
 * anyone noticing which half is which.
 */
export type ContentSource = "mock" | "sanity";

const CONTENT_SOURCES: readonly ContentSource[] = ["mock", "sanity"];

/** Raised when a deployment's content-source setting is missing or unusable. */
export class ContentSourceConfigurationError extends Error {
  constructor(message: string) {
    super(`[content-source] ${message}`);
    this.name = "ContentSourceConfigurationError";
  }
}

type ContentSourceEnvironment = Record<string, string | undefined>;

/**
 * Reads and validates the declared content source.
 *
 * The stage is passed in rather than read here, so that this module and the
 * deployment configuration that calls it do not import each other in a circle.
 * `deployment-stage.ts` owns parsing it.
 */
export function readContentSource(
  environment: ContentSourceEnvironment,
  stage: DeploymentStage,
): ContentSource {
  const value = environment[contentSourceSettingName]?.trim();

  if (!value) {
    throw new ContentSourceConfigurationError(
      `Missing required deployment setting: ${contentSourceSettingName}. Declare "mock" to read the project's demo fixtures, or "sanity" to read the deployment's own Content Lake.`,
    );
  }

  if (!CONTENT_SOURCES.includes(value as ContentSource)) {
    throw new ContentSourceConfigurationError(
      `Invalid ${contentSourceSettingName}: expected one of ${CONTENT_SOURCES.join(", ")}, received "${value}"`,
    );
  }

  const source = value as ContentSource;

  // Fail closed before a single page renders, rather than at the moment a
  // visitor reads placeholder copy and believes it.
  if (source === "mock" && stage === "production") {
    throw new ContentSourceConfigurationError(
      `Invalid ${contentSourceSettingName}: the "mock" source serves the project's demo content, so it must not run in a production deployment. Configure "sanity", or declare SITE_DEPLOYMENT_STAGE as development or preview.`,
    );
  }

  return source;
}

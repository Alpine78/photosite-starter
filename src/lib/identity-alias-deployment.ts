/** Explicit-environment alias configuration (ADR-0031, AB#264). */
import "server-only";

import { isProxy } from "node:util/types";

import { validateIdentityAliasPins, type IdentityAliasPins } from "@/lib/identity-aliases";
import { loadSanityConfig } from "@/lib/sanity-config";
import {
  createSanityIdentityAliasLoader,
  validateIdentityAliasDocumentId,
  type SanityIdentityAliasLoader,
} from "@/lib/sanity-identity-aliases";

const PREFIX = "SITE_IDENTITY_ALIAS_";
const PUBLIC_PREFIX = `NEXT_PUBLIC_${PREFIX}`;
const NAMES = ["MODE", "DOCUMENT_ID", "SOURCE_MAP_SHA256", "PAYLOAD_SHA256", "ROW_COUNT"] as const;
const MAX_SETTING_LENGTH = 512;
type Environment = Readonly<Record<string, string | undefined>>;
export type IdentityAliasDeployment =
  | { readonly mode: "legacy" }
  | {
      readonly mode: "renamed" | "restored";
      readonly documentId: string;
      readonly pins: IdentityAliasPins;
    };

export class IdentityAliasDeploymentError extends Error {
  constructor() {
    super("[identity-alias-deployment] Invalid configuration");
    this.name = "IdentityAliasDeploymentError";
  }
}
function fail(): never { throw new IdentityAliasDeploymentError(); }

/** Never invoke supplied accessors, including inherited configuration. */
function scalar(environment: Environment, name: string, bounded = false): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(environment, name);
  if (!descriptor) {
    if (name in environment) fail();
    return undefined;
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
  const value: unknown = descriptor.value;
  if (value !== undefined && (typeof value !== "string" || (bounded && value.length > MAX_SETTING_LENGTH))) fail();
  return value as string | undefined;
}

function settings(environment: Environment): IdentityAliasDeployment {
  if (!environment || typeof environment !== "object" || Array.isArray(environment) || isProxy(environment)) fail();
  const allowed = new Set(NAMES.flatMap((name) => [PREFIX + name, PUBLIC_PREFIX + name]));
  // Inspect prototypes before `in` can reach a proxy trap. Native process.env
  // prototypes are allowed; alias settings must still be own data properties.
  let current: object | null = environment;
  while (current !== null) {
    if (isProxy(current)) fail();
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        if (current === environment) fail();
        continue;
      }
      const upper = key.toUpperCase();
      if ((upper.startsWith(PREFIX) || upper.startsWith(PUBLIC_PREFIX)) &&
          (!allowed.has(key) || current !== environment)) fail();
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  const values = NAMES.map((name) => {
    if (scalar(environment, PUBLIC_PREFIX + name, true)?.trim()) fail();
    return scalar(environment, PREFIX + name, true)?.trim() ?? "";
  });
  const [rawMode, documentId, sourceMapSha256, payloadSha256, count] = values;
  const mode = rawMode || "legacy";
  if (mode === "legacy") {
    if (values.slice(1).some(Boolean)) fail();
    return Object.freeze({ mode });
  }
  if (mode !== "renamed" && mode !== "restored") fail();
  if (count.length > 16 || !/^[1-9][0-9]*$/.test(count)) fail();
  const pins = validateIdentityAliasPins({ sourceMapSha256, payloadSha256, expectedRowCount: Number(count) });
  return Object.freeze({ mode, documentId: validateIdentityAliasDocumentId(documentId), pins });
}

/** No ambient environment or IO; only a frozen, credential-free settings tuple. */
export function readIdentityAliasDeployment(environment: Environment): IdentityAliasDeployment {
  try { return settings(environment); }
  catch { return fail(); }
}

/** Each call owns a new lazy generation. Undefined fetch uses the existing default. */
export function createDeploymentIdentityAliasLoader(
  environment: Environment,
  fetchImplementation?: typeof fetch,
): SanityIdentityAliasLoader {
  try {
    const deployment = readIdentityAliasDeployment(environment);
    if (fetchImplementation !== undefined && typeof fetchImplementation !== "function") fail();
    if (deployment.mode === "legacy") return createSanityIdentityAliasLoader(deployment);
    const source: Record<string, string | undefined> = {};
    for (const name of [
      "SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_DATASET_VISIBILITY",
      "SANITY_API_VERSION", "SANITY_READ_TOKEN", "NEXT_PUBLIC_SANITY_READ_TOKEN",
    ]) source[name] = scalar(environment, name);
    return createSanityIdentityAliasLoader({
      ...deployment,
      sanityConfig: loadSanityConfig(source),
      fetchImplementation,
    });
  } catch { return fail(); }
}

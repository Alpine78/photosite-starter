/**
 * The deployment's gallery cursor codec: AB#67's authenticated encoding, bound
 * to this deployment's own signing key.
 *
 * ## Why the key is a runtime secret rather than a deployment setting
 *
 * Every other configured value the site reads is a `SITE_*` setting validated
 * by `loadDeploymentConfig` at build time. This one deliberately is not, for
 * two reasons that pull the same way:
 *
 * - **It is a credential, and the build must not need it.** Following the
 *   `RESEND_API_KEY` row in `docs/deployment.md`, it is a Vercel *Sensitive*
 *   value injected at request time. A Sensitive value reaches `next build` as
 *   the literal string `[SENSITIVE]`, so a build-time setting would either be
 *   readable — defeating the point — or would sign every cursor with a
 *   placeholder.
 * - **Nothing at build time issues a cursor.** A gallery that fits in one page
 *   never needs the key at all, so requiring it to build is a provisioning step
 *   that buys nothing.
 *
 * ## Why it must be stable
 *
 * ADR-0003 decision 8 makes unfiltered continuation URLs indexable and requires
 * a token to survive ordinary editing. A key that differed per boot would break
 * that far harder than any edit could: serverless instances do not share a
 * process, so a cursor issued by one instance would 404 on the next request
 * handled by another. The key is therefore one stable value per environment,
 * and **rotating it retires every issued and indexed cursor URL at once** —
 * which is a deliberate, documented act, not a side effect of a deploy.
 *
 * ## Why resolution is deferred
 *
 * `galleryCursorCodec` reads the key when a cursor is actually encoded or
 * decoded, not when this module is imported. A deployment whose galleries all
 * fit in one page never touches the secret, so a missing key is an error only
 * for the deployments that genuinely need one — and it names itself at the
 * first gallery large enough to paginate rather than failing every route.
 */

import "server-only";
import {
  createHmacGalleryCursorCodec,
  type GalleryCursorCodec,
} from "@/lib/gallery-pagination";
import {
  KEYSET_CURSOR_SIGNING_KEY_SETTING,
  KeysetCursorConfigurationError,
  loadKeysetCursorSigningKey,
  type KeysetCursorEnvironment,
} from "@/lib/keyset-cursor";

const SIGNING_KEY_SETTING = KEYSET_CURSOR_SIGNING_KEY_SETTING;

/**
 * The same shape `loadDeploymentConfig` and `loadSanityConfig` read. Not
 * `NodeJS.ProcessEnv`: Next augments that with a required `NODE_ENV`, which
 * would make every caller construct one to pass two settings.
 */
type GalleryCursorEnvironment = KeysetCursorEnvironment;

export class GalleryCursorConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GalleryCursorConfigurationError";
  }
}

/**
 * The codec one environment's key produces, validated at the moment it is read.
 *
 * Separate from the memoized accessor below so a test can supply an environment
 * directly, the way `loadDeploymentConfig` and `loadSanityConfig` do — the
 * validation stays deterministic without a module-cache reset.
 *
 * The environment contract (the `NEXT_PUBLIC_` refusal, the missing-key
 * message) is shared with `content-listing-cursor.ts` through
 * `loadKeysetCursorSigningKey`; the generic `KeysetCursorConfigurationError` it
 * raises is re-wrapped so this module's own callers and tests keep seeing a
 * `GalleryCursorConfigurationError`.
 */
export function loadGalleryCursorCodec(
  environment: GalleryCursorEnvironment,
): GalleryCursorCodec {
  let signingKey: string;
  try {
    signingKey = loadKeysetCursorSigningKey(environment);
  } catch (cause) {
    if (cause instanceof KeysetCursorConfigurationError) {
      throw new GalleryCursorConfigurationError(cause.message, { cause });
    }
    throw cause;
  }

  try {
    return createHmacGalleryCursorCodec(signingKey);
  } catch (cause) {
    throw new GalleryCursorConfigurationError(
      `Invalid ${SIGNING_KEY_SETTING}: expected 32 to 256 printable ASCII characters.`,
      { cause },
    );
  }
}

let cachedCodec: GalleryCursorCodec | undefined;

function resolveCodec(): GalleryCursorCodec {
  // The last tripwire, after the unprefixed name and the `server-only` marker
  // above: a codec in a browser would mean the signing key travelled there.
  if (typeof window !== "undefined") {
    throw new GalleryCursorConfigurationError(
      "A gallery cursor codec was created in a browser. It carries a server-only signing key and must be reached from a Server Component, Route Handler, or another server module.",
    );
  }

  cachedCodec ??= loadGalleryCursorCodec(process.env);
  return cachedCodec;
}

/**
 * The deployment's codec, with the key resolved on use.
 *
 * It satisfies `GalleryCursorCodec` eagerly so an adapter can hand it to
 * `buildCuratedGalleryPage` unconditionally, while the secret behind it is read
 * only if that particular gallery turns out to need one.
 */
export const galleryCursorCodec: GalleryCursorCodec = {
  encode: (scope, boundary) => resolveCodec().encode(scope, boundary),
  decode: (cursor, scope) => resolveCodec().decode(cursor, scope),
};

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

const SIGNING_KEY_SETTING = "GALLERY_CURSOR_SIGNING_KEY";

/**
 * The same shape `loadDeploymentConfig` and `loadSanityConfig` read. Not
 * `NodeJS.ProcessEnv`: Next augments that with a required `NODE_ENV`, which
 * would make every caller construct one to pass two settings.
 */
type GalleryCursorEnvironment = Record<string, string | undefined>;

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
 */
export function loadGalleryCursorCodec(
  environment: GalleryCursorEnvironment,
): GalleryCursorCodec {
  // Refused rather than ignored, for the same reason the Sanity read token is:
  // Next.js compiles a `NEXT_PUBLIC_` value into the browser bundle, and a
  // signing key published to every visitor lets anyone mint cursors this
  // deployment would accept.
  const publicName = `NEXT_PUBLIC_${SIGNING_KEY_SETTING}`;
  if (environment[publicName] !== undefined) {
    throw new GalleryCursorConfigurationError(
      `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so the cursor signing key must never be set under that name. Remove it and set ${SIGNING_KEY_SETTING} instead.`,
    );
  }

  const signingKey = environment[SIGNING_KEY_SETTING];
  if (signingKey === undefined || signingKey.length === 0) {
    throw new GalleryCursorConfigurationError(
      `Missing ${SIGNING_KEY_SETTING}: a gallery large enough to paginate issues a continuation cursor, which this deployment signs with its own key. Set one stable secret value per environment — rotating it retires every continuation URL already issued and indexed.`,
    );
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
  encode: (scope, afterOrder, afterPlacementId) =>
    resolveCodec().encode(scope, afterOrder, afterPlacementId),
  decode: (cursor, scope) => resolveCodec().decode(cursor, scope),
};

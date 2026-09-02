/**
 * The administrator credential's **format** (ADR-0015 §4): how
 * `PRIVATE_GALLERY_ADMIN_SECRET_HASH` is encoded, how it is parsed and bounded,
 * how a submitted secret is verified against it in constant time, and the
 * generation digest a session is bound to.
 *
 * Pure: it reads no environment and holds no state.
 * `private-gallery-admin-credential.ts` is the server-only half that resolves
 * the setting. The split exists because the owner-run generator
 * (`scripts/generate-admin-secret.mts`) runs under plain Node, where
 * `server-only`'s CommonJS entry point throws by design — and a security format
 * with two implementations, one for the application and one for the command
 * that produces its input, is exactly the drift this repository avoids
 * elsewhere. `eslint.config.mjs` bars `src/app` and `src/components` from both
 * halves.
 *
 * §4's decision in one line: a secret the operator **generates** rather than
 * chooses, verified server-side with `scrypt` from `node:crypto`, with its salt
 * and parameters encoded alongside the hash. No dependency, no password-reset
 * flow, and rotation is a configuration change plus a redeploy.
 *
 * ## The stored format
 *
 *     scrypt$1$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 *
 * Self-describing on purpose. A bare hash would pin the parameters in code, so
 * raising them later would silently invalidate a deployment's configured value
 * with no way to tell that is what happened; carrying them means an old hash
 * keeps verifying and the operator re-provisions when they choose. The leading
 * version field is what lets the whole encoding change without ambiguity.
 *
 * ## A measured detail that would otherwise break every login
 *
 * ADR-0015 §4 fixes `N = 2^15, r = 8, p = 1`. That needs `128 · N · r` =
 * exactly 33 554 432 bytes, and Node's default `maxmem` is exactly
 * 33 554 432 bytes — OpenSSL's check is `>=`, so **the ADR's own parameters
 * throw with the default**: `error:030000AC … memory limit exceeded`. Measured
 * against the pinned Node 24, not assumed. `maxmem` is therefore always passed
 * explicitly, derived from the parsed parameters with a margin, and the
 * parameter ceilings below exist so that derived value can never ask for a
 * gigabyte because someone typed an extra digit.
 *
 * ## What is bounded, and why each bound is here
 *
 * The parameters come from deployment configuration rather than from a request,
 * so these guard a mistake rather than an attack — but a mistake here is a
 * production outage or an OOM, and both are silent until someone logs in.
 * The submitted secret, by contrast, *is* attacker-controlled, and its length
 * bound is real defence: it is the one input to this expensive function that
 * arrives over the network.
 *
 */

import { createHash, scryptSync, timingSafeEqual } from "node:crypto";

export const PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING =
  "PRIVATE_GALLERY_ADMIN_SECRET_HASH";

/** The only encoding version this module writes or accepts. */
export const PRIVATE_GALLERY_ADMIN_CREDENTIAL_VERSION = 1;

/** ADR-0015 §4's parameters, and the values the generator writes. */
export const PRIVATE_GALLERY_ADMIN_SCRYPT_N = 32768; // 2^15
export const PRIVATE_GALLERY_ADMIN_SCRYPT_R = 8;
export const PRIVATE_GALLERY_ADMIN_SCRYPT_P = 1;

/**
 * §4's parameters are the **floor**, not merely the default: a deployment may
 * raise the cost and never lower it. A configured value below this would be a
 * weaker credential than the record decided, arriving through a channel nobody
 * reviews.
 */
const MIN_N = PRIVATE_GALLERY_ADMIN_SCRYPT_N;
/** A per-parameter ceiling, with {@link MAX_SCRYPT_MEMORY_BYTES} bounding the product. */
const MAX_N = 131072; // 2^17
const MIN_R = PRIVATE_GALLERY_ADMIN_SCRYPT_R;
const MAX_R = 32;
const MIN_P = PRIVATE_GALLERY_ADMIN_SCRYPT_P;
const MAX_P = 4;

/**
 * The real guard on cost, checked on the **product** rather than on each
 * parameter alone. Independent ceilings would let `N = 2^17` and `r = 32` — both
 * individually allowed — ask for 512 MiB inside a login, which on a Function is
 * an allocation failure rather than a configuration error anyone can read.
 * 128 MiB is four times ADR-0015 §4's own parameters, so a deployment can raise
 * the cost meaningfully and still not reach it.
 */
const MAX_SCRYPT_MEMORY_BYTES = 128 * 1024 * 1024;

/** 128 bits is the floor; the generator writes this many bytes. */
export const PRIVATE_GALLERY_ADMIN_SALT_BYTES = 16;
const MIN_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;

/** A 256-bit derived key, fixed so a comparison is always over equal lengths. */
export const PRIVATE_GALLERY_ADMIN_HASH_BYTES = 32;

/**
 * The longest submitted secret this will hash. The bounded request body already
 * limits what can arrive, and this bounds it again at the expensive step: the
 * password is the one input here that comes off the network, and `scrypt` runs
 * PBKDF2-SHA256 over it before the memory-hard part.
 *
 * Generously above the 43 characters a `openssl rand -base64 32` secret occupies,
 * so an operator using a different generator is not locked out.
 */
export const PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH = 512;

/**
 * The shortest secret the **generator** will accept if one is supplied to it.
 * ADR-0015 §4 makes "generated rather than chosen" a requirement of the
 * decision, not advice, and this is where that becomes executable. Verification
 * deliberately does *not* enforce it — it must accept whatever was hashed, or
 * raising this later would lock an operator out of their own deployment.
 */
export const PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH = 32;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type PrivateGalleryAdminCredentialErrorReason =
  | "missing"
  | "malformed"
  | "unsupported-version"
  | "weak-parameters"
  | "invalid-parameter";

export class PrivateGalleryAdminCredentialError extends Error {
  readonly reason: PrivateGalleryAdminCredentialErrorReason;

  constructor(
    reason: PrivateGalleryAdminCredentialErrorReason,
    message: string,
  ) {
    // Never interpolate the configured value, a salt, a hash, or a submitted
    // secret. A configuration error is often the first thing to reach a log.
    super(`[private-gallery-admin-credential] ${message}`);
    this.name = "PrivateGalleryAdminCredentialError";
    this.reason = reason;
  }
}

function fail(
  reason: PrivateGalleryAdminCredentialErrorReason,
  message: string,
): never {
  throw new PrivateGalleryAdminCredentialError(reason, message);
}

export type PrivateGalleryAdminCredential = {
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
  /**
   * The opaque digest a session is bound to. Derived from the encoded
   * credential, never the credential itself — see
   * {@link privateGalleryAdminCredentialGeneration}.
   */
  readonly generation: string;
};

function decodeBase64Url(
  value: string,
  label: string,
  minBytes: number,
  maxBytes: number,
): Buffer {
  if (!BASE64URL.test(value)) {
    fail("malformed", `${label} is not unpadded base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  // Re-encode: base64's redundant trailing bits mean several spellings decode
  // to the same bytes, and a value that is not its own canonical encoding is a
  // sign the configuration was hand-edited.
  if (decoded.toString("base64url") !== value) {
    fail("malformed", `${label} is not canonically encoded`);
  }
  if (decoded.length < minBytes || decoded.length > maxBytes) {
    fail("malformed", `${label} does not decode to the expected size`);
  }
  return decoded;
}

function parseInteger(value: string, label: string): number {
  // `Number()` accepts "0x8000", " 8 ", "1e5" and "Infinity"; none of those
  // belongs in a cost parameter, and each would parse to something plausible.
  if (!/^[0-9]{1,10}$/.test(value)) {
    fail("malformed", `${label} is not a plain decimal integer`);
  }
  return Number(value);
}

/**
 * The generation digest a session is bound to (ADR-0015 §2's central
 * revocation).
 *
 * SHA-256 over the **encoded credential**, so it changes whenever the secret,
 * the salt, or the parameters change — every one of which is a re-provisioning
 * that should end existing sessions.
 *
 * It is deliberately a digest *of* the stored hash rather than the stored hash
 * itself: this value is written into the administrator session table, read on
 * every request, and present in every database backup. The scrypt hash is the
 * offline-attack target for the secret; there is no reason for a copy of it to
 * live in a second table that exists for an unrelated purpose.
 */
export function privateGalleryAdminCredentialGeneration(
  encoded: string,
): string {
  return createHash("sha256").update(encoded, "utf8").digest("base64url");
}

/** Parses the encoded form. Exported so the generator can verify its own output. */
export function parsePrivateGalleryAdminCredential(
  encoded: string,
): PrivateGalleryAdminCredential {
  const fields = encoded.split("$");
  if (fields.length !== 7 || fields[0] !== "scrypt") {
    fail(
      "malformed",
      "the credential is not a scrypt$version$N$r$p$salt$hash string",
    );
  }

  const version = parseInteger(fields[1] as string, "the version");
  if (version !== PRIVATE_GALLERY_ADMIN_CREDENTIAL_VERSION) {
    fail(
      "unsupported-version",
      `the credential declares version ${version}, which this build does not implement`,
    );
  }

  const n = parseInteger(fields[2] as string, "N");
  const r = parseInteger(fields[3] as string, "r");
  const p = parseInteger(fields[4] as string, "p");

  // A power of two is scrypt's own requirement for N; OpenSSL would reject it
  // later, but with a message about "invalid parameters" rather than one an
  // operator can act on.
  if (n < MIN_N || n > MAX_N || (n & (n - 1)) !== 0) {
    fail(
      "weak-parameters",
      `N must be a power of two between ${MIN_N} and ${MAX_N}; ADR-0015 §4 fixes ${PRIVATE_GALLERY_ADMIN_SCRYPT_N} as the floor and a deployment may raise it, never lower it`,
    );
  }
  if (r < MIN_R || r > MAX_R) {
    fail("weak-parameters", `r must be between ${MIN_R} and ${MAX_R}`);
  }
  if (p < MIN_P || p > MAX_P) {
    fail("weak-parameters", `p must be between ${MIN_P} and ${MAX_P}`);
  }
  const memoryBytes = 128 * n * r;
  if (memoryBytes > MAX_SCRYPT_MEMORY_BYTES) {
    fail(
      "weak-parameters",
      `N and r together ask for ${Math.round(memoryBytes / (1024 * 1024))} MiB, above this build's ${MAX_SCRYPT_MEMORY_BYTES / (1024 * 1024)} MiB ceiling`,
    );
  }

  const salt = decodeBase64Url(
    fields[5] as string,
    "the salt",
    MIN_SALT_BYTES,
    MAX_SALT_BYTES,
  );
  const hash = decodeBase64Url(
    fields[6] as string,
    "the hash",
    PRIVATE_GALLERY_ADMIN_HASH_BYTES,
    PRIVATE_GALLERY_ADMIN_HASH_BYTES,
  );

  return {
    n,
    r,
    p,
    salt,
    hash,
    generation: privateGalleryAdminCredentialGeneration(encoded),
  };
}

/**
 * `maxmem` for these parameters, with a megabyte of headroom.
 *
 * Always passed explicitly. See this module's header: the ADR's own parameters
 * need exactly Node's default limit, and OpenSSL rejects at `>=`, so relying on
 * the default makes every login throw.
 */
function scryptMaxmem(credential: PrivateGalleryAdminCredential): number {
  return 128 * credential.n * credential.r + 1024 * 1024;
}

/**
 * Whether `secret` is the one this credential was generated from.
 *
 * Constant-time in the comparison, over two fixed-length 32-byte buffers, so a
 * caller cannot learn a prefix from how long a refusal takes. The length bound
 * is checked first and returns `false` rather than throwing: an over-long
 * submitted value is a wrong secret, not a configuration defect, and the login
 * route answers both identically anyway.
 *
 * Derivation cost is the same for a right and a wrong secret, which is the
 * property that matters more than the comparison — and the reason
 * `private-gallery-admin-login.ts` bounds how often this can be reached.
 */
export function verifyPrivateGalleryAdminSecret(
  credential: PrivateGalleryAdminCredential,
  secret: string,
): boolean {
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    secret.length > PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH
  ) {
    return false;
  }

  const derived = scryptSync(
    secret,
    credential.salt,
    PRIVATE_GALLERY_ADMIN_HASH_BYTES,
    {
      N: credential.n,
      r: credential.r,
      p: credential.p,
      maxmem: scryptMaxmem(credential),
    },
  );

  // Both are PRIVATE_GALLERY_ADMIN_HASH_BYTES long by construction — the parser
  // refuses any other stored length — so `timingSafeEqual` cannot throw here.
  return timingSafeEqual(derived, credential.hash);
}

/**
 * Encodes a credential from a secret and a fresh salt. Used by the owner-run
 * generator (`npm run admin:secret`); it is here rather than in the script so
 * the encoder and the parser sit beside each other and are tested as a pair.
 */
export function encodePrivateGalleryAdminCredential(params: {
  readonly secret: string;
  readonly salt: Buffer;
  readonly n?: number;
  readonly r?: number;
  readonly p?: number;
}): string {
  const {
    secret,
    salt,
    n = PRIVATE_GALLERY_ADMIN_SCRYPT_N,
    r = PRIVATE_GALLERY_ADMIN_SCRYPT_R,
    p = PRIVATE_GALLERY_ADMIN_SCRYPT_P,
  } = params;

  if (
    typeof secret !== "string" ||
    secret.length < PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH ||
    secret.length > PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH
  ) {
    fail(
      "invalid-parameter",
      `the secret must be ${PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH} to ${PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH} characters. ADR-0015 §4 requires a generated value; a memorable passphrase is not an acceptable secret for this boundary`,
    );
  }
  if (
    !Buffer.isBuffer(salt) ||
    salt.length < MIN_SALT_BYTES ||
    salt.length > MAX_SALT_BYTES
  ) {
    fail(
      "invalid-parameter",
      `the salt must be ${MIN_SALT_BYTES} to ${MAX_SALT_BYTES} bytes`,
    );
  }

  const derived = scryptSync(
    secret,
    salt,
    PRIVATE_GALLERY_ADMIN_HASH_BYTES,
    { N: n, r, p, maxmem: 128 * n * r + 1024 * 1024 },
  );

  const encoded = [
    "scrypt",
    String(PRIVATE_GALLERY_ADMIN_CREDENTIAL_VERSION),
    String(n),
    String(r),
    String(p),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");

  // Parse our own output before returning it. This is not ceremony: it is the
  // only thing that applies the parameter floors to `n`, `r` and `p` here, and
  // it means the generator cannot hand an operator a string this build would
  // then refuse to load — a failure that would otherwise surface as a broken
  // deployment rather than a failed command.
  parsePrivateGalleryAdminCredential(encoded);
  return encoded;
}

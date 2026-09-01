/**
 * The AES-256-GCM seal/open for a stored private client-gallery capability
 * (ADR-0014 §3, "Capability storage is recoverable, not hash-only").
 *
 * The capability is a 256-bit CSPRNG bearer secret — the *whole* credential a
 * shareable link carries. It is stored encrypted, not hashed, so the
 * administrator "resend access instructions" and "copy access link" actions can
 * reconstruct the exact link. This module is the only place that seal/open
 * happens; it holds key material at runtime, so `import "server-only"` plus the
 * `eslint.config.mjs` import boundary keep `src/app` and `src/components` out.
 *
 * The contract is fixed by the ADR and restated here so a later change to it is
 * a deliberate edit to both:
 *
 * - **One AEAD:** AES-256-GCM, a fresh random 96-bit nonce and a 128-bit tag
 *   per encryption. No bare or unauthenticated mode.
 * - **Versioned envelope:** `{ version: 1, algorithm: "A256GCM", keyId, nonce,
 *   ciphertext, tag }`, binary fields unpadded base64url, stored as one JSON
 *   string in fixed key order. An unknown version or algorithm fails closed.
 * - **Canonical associated data:** the UTF-8 bytes of the fixed-order JSON
 *   tuple `["private-gallery-capability-v1", galleryId, handle, generation]`,
 *   binding the ciphertext to its gallery, handle, and generation.
 * - **Fail closed:** a bad tag, an unknown `keyId`, a mismatched AAD, a
 *   malformed envelope, or a decrypted value that is not a well-formed
 *   capability secret is a classified refusal — never a plaintext or empty
 *   fallback.
 * - **Rotation:** {@link capabilityEnvelopeNeedsRotation} +
 *   {@link resealCapability} are the primitives. The *store* slice owns the
 *   atomic conditional persist (keyed on generation + row version, discarding a
 *   lost race against an administrator revoke/replace) and the retirement scan
 *   that parses and re-checks every row's envelope `keyId` — not just a
 *   denormalized column — before a key may be removed from the keyring.
 */

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  PRIVATE_GALLERY_CAPABILITY_KEY_ID_PATTERN,
  type PrivateGalleryCapabilityKeyring,
} from "@/lib/private-gallery-config";

const ENVELOPE_VERSION = 1 as const;
const ENVELOPE_ALGORITHM = "A256GCM" as const;

const KEY_BYTES = 32;
const NONCE_BYTES = 12; // 96-bit GCM nonce
const TAG_BYTES = 16; // 128-bit GCM tag

/** The capability secret: 256 bits from a CSPRNG (ADR-0014 §3). */
export const CAPABILITY_SECRET_BYTES = 32;
/** 32 bytes as unpadded base64url is exactly 43 characters. */
const CAPABILITY_SECRET_CHARS = 43;
/** GCM ciphertext length equals plaintext length: the 43-char secret string. */
const CIPHERTEXT_BYTES = CAPABILITY_SECRET_CHARS;

/** The gallery handle: the ADR-0014 §3 CSPRNG floor of 128 bits. */
export const GALLERY_HANDLE_BYTES = 16;
const HANDLE_MIN_BYTES = GALLERY_HANDLE_BYTES;
const HANDLE_MAX_BYTES = 64;

/** An opaque internal gallery id; bounded so it cannot bloat the AAD. */
const MAX_GALLERY_ID_CHARS = 128;
/** A stored envelope for a 43-byte secret serializes well under this. */
const MAX_ENVELOPE_STRING_CHARS = 512;

const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
// The internal gallery id is opaque; this module only bounds it. A creation
// slice that mints ids outside printable ASCII would widen this deliberately.
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export type PrivateGalleryCapabilityEnvelope = {
  readonly version: typeof ENVELOPE_VERSION;
  readonly algorithm: typeof ENVELOPE_ALGORITHM;
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
};

/** The three values the envelope's associated data binds the ciphertext to. */
export type PrivateGalleryCapabilityContext = {
  readonly galleryId: string;
  readonly handle: string;
  readonly generation: number;
};

/** The stored record's two capability columns (ADR-0014 §3). */
export type PrivateGalleryCapabilityMaterial = {
  readonly keyId: string;
  readonly envelope: string;
};

export type PrivateGalleryCapabilityErrorReason =
  | "malformed-context"
  | "malformed-secret"
  | "malformed-envelope"
  | "malformed-keyring"
  | "unknown-version"
  | "unknown-algorithm"
  | "unknown-key"
  | "auth-failed";

export class PrivateGalleryCapabilityError extends Error {
  readonly reason: PrivateGalleryCapabilityErrorReason;

  constructor(reason: PrivateGalleryCapabilityErrorReason, message: string) {
    super(`[private-gallery-capability] ${message}`);
    this.name = "PrivateGalleryCapabilityError";
    this.reason = reason;
  }
}

function fail(
  reason: PrivateGalleryCapabilityErrorReason,
  message: string,
): never {
  throw new PrivateGalleryCapabilityError(reason, message);
}

/**
 * Decodes an unpadded base64url string, rejecting a non-canonical value (stray
 * padding, an alternate alphabet, or non-zero trailing bits) and, when given,
 * an unexpected decoded length. Node's decoder is lenient; a re-encode
 * comparison is what makes this strict.
 */
function decodeStrictBase64url(
  value: string,
  expectedBytes: number,
  reason: PrivateGalleryCapabilityErrorReason,
  label: string,
): Buffer {
  if (!UNPADDED_BASE64URL.test(value)) {
    fail(reason, `${label} is not unpadded base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    fail(reason, `${label} is not canonically encoded`);
  }
  if (decoded.length !== expectedBytes) {
    fail(
      reason,
      `${label} decodes to ${decoded.length} bytes, expected ${expectedBytes}`,
    );
  }
  return decoded;
}

/**
 * Asserts a value is a well-formed capability secret: an unpadded base64url
 * string of exactly 43 characters that decodes canonically to 32 bytes. Applied
 * to `sealCapability`'s input and again to `openCapability`'s decrypted output,
 * so neither an authoring bug nor a corrupt row can put a guessable or
 * malformed credential into circulation.
 */
export function assertCapabilitySecret(value: string): void {
  if (typeof value !== "string" || value.length !== CAPABILITY_SECRET_CHARS) {
    fail(
      "malformed-secret",
      `a capability secret is ${CAPABILITY_SECRET_CHARS} base64url characters`,
    );
  }
  decodeStrictBase64url(
    value,
    CAPABILITY_SECRET_BYTES,
    "malformed-secret",
    "the capability secret",
  );
}

/**
 * Validates the context and returns the canonical associated-data bytes: the
 * UTF-8 of `["private-gallery-capability-v1", galleryId, handle, generation]`.
 * `JSON.stringify` of an array is deterministic in order and escaping, which is
 * why a delimiter inside `galleryId` or `handle` cannot make two contexts
 * collide.
 */
export function canonicalCapabilityAad(
  context: PrivateGalleryCapabilityContext,
): Buffer {
  const { galleryId, handle, generation } = context;

  if (
    typeof galleryId !== "string" ||
    galleryId.length === 0 ||
    galleryId.length > MAX_GALLERY_ID_CHARS ||
    !PRINTABLE_ASCII.test(galleryId)
  ) {
    fail("malformed-context", "galleryId is not a bounded printable string");
  }

  if (typeof handle !== "string" || !UNPADDED_BASE64URL.test(handle)) {
    fail("malformed-context", "handle is not unpadded base64url");
  }
  const handleBytes = Buffer.from(handle, "base64url");
  if (
    handleBytes.toString("base64url") !== handle ||
    handleBytes.length < HANDLE_MIN_BYTES ||
    handleBytes.length > HANDLE_MAX_BYTES
  ) {
    fail(
      "malformed-context",
      `handle must decode canonically to ${HANDLE_MIN_BYTES}–${HANDLE_MAX_BYTES} bytes`,
    );
  }

  if (!Number.isSafeInteger(generation) || generation < 0) {
    fail("malformed-context", "generation is not a non-negative safe integer");
  }

  return Buffer.from(
    JSON.stringify([
      "private-gallery-capability-v1",
      galleryId,
      handle,
      generation,
    ]),
    "utf8",
  );
}

function serializeEnvelope(envelope: PrivateGalleryCapabilityEnvelope): string {
  // Fixed key order — `JSON.stringify` preserves insertion order for string
  // keys, so the stored form is deterministic and golden-vector testable.
  return JSON.stringify({
    version: envelope.version,
    algorithm: envelope.algorithm,
    keyId: envelope.keyId,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    tag: envelope.tag,
  });
}

const ENVELOPE_KEYS = [
  "version",
  "algorithm",
  "keyId",
  "nonce",
  "ciphertext",
  "tag",
] as const;

/**
 * Parses and fully validates a stored envelope string without decrypting it —
 * so a bounded rotation scan can read `keyId` cheaply, and `openCapability`
 * shares one validation path.
 *
 * `JSON.parse` silently keeps the last of any duplicate member; the exact
 * six-key shape check bounds the object regardless, and a row writer who can
 * inject a duplicate member could inject any single value directly, so this is
 * not a separate escalation to reject.
 */
export function parseCapabilityEnvelope(
  serialized: string,
): PrivateGalleryCapabilityEnvelope {
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    serialized.length > MAX_ENVELOPE_STRING_CHARS
  ) {
    fail("malformed-envelope", "the envelope is not a bounded JSON string");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    fail("malformed-envelope", "the envelope is not JSON");
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("malformed-envelope", "the envelope is not a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    !ENVELOPE_KEYS.every((key) => Object.hasOwn(record, key))
  ) {
    fail(
      "malformed-envelope",
      `the envelope must have exactly the fields ${ENVELOPE_KEYS.join(", ")}`,
    );
  }

  if (typeof record.version !== "number") {
    fail("malformed-envelope", "version is not a number");
  }
  if (record.version !== ENVELOPE_VERSION) {
    fail("unknown-version", `unsupported envelope version ${String(record.version)}`);
  }
  if (typeof record.algorithm !== "string") {
    fail("malformed-envelope", "algorithm is not a string");
  }
  if (record.algorithm !== ENVELOPE_ALGORITHM) {
    fail(
      "unknown-algorithm",
      `unsupported envelope algorithm ${JSON.stringify(record.algorithm)}`,
    );
  }
  if (
    typeof record.keyId !== "string" ||
    !PRIVATE_GALLERY_CAPABILITY_KEY_ID_PATTERN.test(record.keyId)
  ) {
    fail("malformed-envelope", "keyId is not a valid key id");
  }
  for (const field of ["nonce", "ciphertext", "tag"] as const) {
    if (typeof record[field] !== "string") {
      fail("malformed-envelope", `${field} is not a string`);
    }
  }

  decodeStrictBase64url(
    record.nonce as string,
    NONCE_BYTES,
    "malformed-envelope",
    "nonce",
  );
  decodeStrictBase64url(
    record.ciphertext as string,
    CIPHERTEXT_BYTES,
    "malformed-envelope",
    "ciphertext",
  );
  decodeStrictBase64url(
    record.tag as string,
    TAG_BYTES,
    "malformed-envelope",
    "tag",
  );

  return {
    version: ENVELOPE_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    keyId: record.keyId as string,
    nonce: record.nonce as string,
    ciphertext: record.ciphertext as string,
    tag: record.tag as string,
  };
}

function resolveKey(
  keyring: PrivateGalleryCapabilityKeyring,
  keyId: string,
  missingReason: PrivateGalleryCapabilityErrorReason,
): Uint8Array {
  const key = keyring.getKey(keyId);
  if (key === undefined) {
    fail(missingReason, `no key for id ${JSON.stringify(keyId)}`);
  }
  if (key.length !== KEY_BYTES) {
    // The configured keyring guarantees 32 bytes; a test double or a future
    // adapter might not, and a wrong-length key must not reach the cipher.
    key.fill(0);
    fail("malformed-keyring", `key ${JSON.stringify(keyId)} is not 32 bytes`);
  }
  return key;
}

/**
 * Seals a capability secret under the keyring's active key, bound to `context`.
 * Returns the two values the stored record needs.
 */
export function sealCapability(
  keyring: PrivateGalleryCapabilityKeyring,
  context: PrivateGalleryCapabilityContext,
  secret: string,
): PrivateGalleryCapabilityMaterial {
  assertCapabilitySecret(secret);
  const aad = canonicalCapabilityAad(context);

  const keyId = keyring.activeKeyId;
  const key = resolveKey(keyring, keyId, "malformed-keyring");
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(secret, "utf8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const envelope: PrivateGalleryCapabilityEnvelope = {
      version: ENVELOPE_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      keyId,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: tag.toString("base64url"),
    };
    return { keyId, envelope: serializeEnvelope(envelope) };
  } finally {
    key.fill(0);
  }
}

/**
 * Opens a stored envelope. Every failure — a malformed envelope, an unknown
 * version/algorithm/key, a mismatched context, a bad tag, or a decrypted value
 * that is not a well-formed capability secret — is a classified throw.
 */
export function openCapability(
  keyring: PrivateGalleryCapabilityKeyring,
  context: PrivateGalleryCapabilityContext,
  serializedEnvelope: string,
): string {
  const envelope = parseCapabilityEnvelope(serializedEnvelope);
  const aad = canonicalCapabilityAad(context);

  const key = resolveKey(keyring, envelope.keyId, "unknown-key");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64url"),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    decipher.setAAD(aad);

    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);
    } catch {
      fail(
        "auth-failed",
        "capability decryption failed authentication (tag, key, or context mismatch)",
      );
    }

    let secret: string;
    try {
      secret = STRICT_UTF8.decode(plaintext);
    } catch {
      fail("malformed-secret", "the decrypted capability is not valid UTF-8");
    }
    plaintext.fill(0);
    assertCapabilitySecret(secret);
    return secret;
  } finally {
    key.fill(0);
  }
}

/** The envelope's key id, without decrypting — for a bounded rotation scan. */
export function capabilityEnvelopeKeyId(serializedEnvelope: string): string {
  return parseCapabilityEnvelope(serializedEnvelope).keyId;
}

/** Whether a stored envelope was sealed under a key other than the active one. */
export function capabilityEnvelopeNeedsRotation(
  keyring: PrivateGalleryCapabilityKeyring,
  serializedEnvelope: string,
): boolean {
  return (
    parseCapabilityEnvelope(serializedEnvelope).keyId !== keyring.activeKeyId
  );
}

/**
 * Opens an envelope and re-seals the same secret under the active key. The
 * store slice persists the result with an atomic, version-checked update; a
 * caller must discard it if the row's generation moved under it.
 */
export function resealCapability(
  keyring: PrivateGalleryCapabilityKeyring,
  context: PrivateGalleryCapabilityContext,
  serializedEnvelope: string,
): PrivateGalleryCapabilityMaterial {
  return sealCapability(
    keyring,
    context,
    openCapability(keyring, context, serializedEnvelope),
  );
}

/** A fresh 256-bit capability secret (ADR-0014 §3), unpadded base64url. */
export function generateCapabilitySecret(): string {
  return randomBytes(CAPABILITY_SECRET_BYTES).toString("base64url");
}

/** A fresh gallery handle at the ADR-0014 §3 128-bit CSPRNG floor. */
export function generateGalleryHandle(): string {
  return randomBytes(GALLERY_HANDLE_BYTES).toString("base64url");
}

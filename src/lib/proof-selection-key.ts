/**
 * Proof selection keys (ADR-0038 decisions 4 and 9, AB#130).
 *
 * A key is 256 random bits, given to the customer once inside the share link's
 * URL fragment. The server stores only its SHA-256 hash for verification and an
 * AES-256-GCM copy under a server-only secret, so the reminder can rebuild the
 * link. The ciphertext is bound to its gallery through the additional
 * authenticated data: a copy moved to another gallery does not decrypt.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SECRET_NAME = "PROOF_SELECTION_KEY_SECRET";

export type EncryptedSelectionKey = Readonly<{ v: 1; iv: string; data: string; tag: string }>;

export class ProofSelectionKeyError extends Error {
  constructor(message: string) {
    super(`[proof-selection-key] ${message}`);
    this.name = "ProofSelectionKeyError";
  }
}

function decodeExact(value: unknown, bytes: number): Buffer | undefined {
  if (typeof value !== "string" || !BASE64URL.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value ? decoded : undefined;
}

/** The 32-byte encryption secret; refused if exposed as a browser variable. */
export function readProofSelectionKeySecret(environment: Record<string, string | undefined>): Buffer {
  if (environment[`NEXT_PUBLIC_${SECRET_NAME}`]?.trim()) {
    throw new ProofSelectionKeyError(`Remove NEXT_PUBLIC_${SECRET_NAME}: the key secret must be server-only.`);
  }
  const secret = decodeExact(environment[SECRET_NAME]?.trim(), KEY_BYTES);
  if (!secret) throw new ProofSelectionKeyError(`${SECRET_NAME} must be 32 bytes encoded as base64url.`);
  return secret;
}

export function isSelectionKey(value: unknown): value is string {
  return decodeExact(value, KEY_BYTES) !== undefined;
}

export function selectionKeyHash(key: string): string {
  if (!isSelectionKey(key)) throw new ProofSelectionKeyError("invalid selection key");
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function createSelectionKey(random: (size: number) => Buffer = randomBytes): { key: string; hash: string } {
  const bytes = random(KEY_BYTES);
  if (bytes.length !== KEY_BYTES) throw new ProofSelectionKeyError("random source returned the wrong length");
  const key = bytes.toString("base64url");
  return { key, hash: selectionKeyHash(key) };
}

/** Constant-time comparison of a presented key against a stored hash. */
export function selectionKeyMatches(presented: unknown, storedHash: unknown): boolean {
  if (!isSelectionKey(presented) || typeof storedHash !== "string" || !/^[a-f0-9]{64}$/u.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(selectionKeyHash(presented), "hex"), Buffer.from(storedHash, "hex"));
}

function additionalData(galleryId: string): Buffer {
  return Buffer.from(`photosite-proof-selection-key:v1:${galleryId}`, "utf8");
}

export function encryptSelectionKey(
  key: string,
  galleryId: string,
  secret: Buffer,
  random: (size: number) => Buffer = randomBytes,
): EncryptedSelectionKey {
  if (!isSelectionKey(key)) throw new ProofSelectionKeyError("invalid selection key");
  if (secret.length !== KEY_BYTES) throw new ProofSelectionKeyError("invalid secret length");
  const iv = random(IV_BYTES);
  if (iv.length !== IV_BYTES) throw new ProofSelectionKeyError("random source returned the wrong length");
  const cipher = createCipheriv("aes-256-gcm", secret, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(galleryId));
  const data = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64url"), data: data.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

/** For the reminder route only (ADR-0038 decision 9); throws on any tampering. */
export function decryptSelectionKey(encrypted: unknown, galleryId: string, secret: Buffer): string {
  if (typeof encrypted !== "object" || encrypted === null) throw new ProofSelectionKeyError("invalid ciphertext");
  const record = encrypted as Record<string, unknown>;
  const iv = decodeExact(record.iv, IV_BYTES), tag = decodeExact(record.tag, TAG_BYTES);
  if (record.v !== 1 || !iv || !tag || typeof record.data !== "string" || !BASE64URL.test(record.data) ||
    Object.keys(record).some((name) => !["v", "iv", "data", "tag"].includes(name))) throw new ProofSelectionKeyError("invalid ciphertext");
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(galleryId));
    decipher.setAuthTag(tag);
    const key = Buffer.concat([decipher.update(Buffer.from(record.data, "base64url")), decipher.final()]).toString("utf8");
    if (!isSelectionKey(key)) throw new ProofSelectionKeyError("decrypted value is not a selection key");
    return key;
  } catch (error) {
    if (error instanceof ProofSelectionKeyError) throw error;
    throw new ProofSelectionKeyError("ciphertext could not be authenticated");
  }
}

import { describe, expect, it } from "vitest";
import {
  createSelectionKey,
  decryptSelectionKey,
  encryptSelectionKey,
  isSelectionKey,
  ProofSelectionKeyError,
  readProofSelectionKeySecret,
  selectionKeyHash,
  selectionKeyMatches,
} from "@/lib/proof-selection-key";

const secretText = Buffer.alloc(32, 7).toString("base64url");
const secret = Buffer.alloc(32, 7);

describe("proof selection keys (ADR-0038 decisions 4 and 9)", () => {
  it("creates a 256-bit base64url key and its SHA-256 hash", () => {
    const { key, hash } = createSelectionKey();
    expect(isSelectionKey(key)).toBe(true);
    expect(Buffer.from(key, "base64url")).toHaveLength(32);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(selectionKeyHash(key)).toBe(hash);
    expect(createSelectionKey().key).not.toBe(key);
  });
  it("matches only the exact key, in constant time against the stored hash", () => {
    const { key, hash } = createSelectionKey();
    expect(selectionKeyMatches(key, hash)).toBe(true);
    expect(selectionKeyMatches(createSelectionKey().key, hash)).toBe(false);
    for (const bad of [undefined, "", key + "A", key.toUpperCase(), 42]) expect(selectionKeyMatches(bad, hash)).toBe(false);
    expect(selectionKeyMatches(key, "not-a-hash")).toBe(false);
  });
  it("round-trips through encryption bound to the gallery", () => {
    const { key } = createSelectionKey();
    const encrypted = encryptSelectionKey(key, "gallery-1", secret);
    expect(encrypted.v).toBe(1);
    expect(JSON.stringify(encrypted)).not.toContain(key);
    expect(decryptSelectionKey(encrypted, "gallery-1", secret)).toBe(key);
    expect(() => decryptSelectionKey(encrypted, "gallery-2", secret)).toThrow(ProofSelectionKeyError);
    expect(() => decryptSelectionKey(encrypted, "gallery-1", Buffer.alloc(32, 8))).toThrow(ProofSelectionKeyError);
    const tampered = { ...encrypted, data: Buffer.from(encrypted.data, "base64url").map((byte, index) => index === 0 ? byte ^ 1 : byte) };
    expect(() => decryptSelectionKey({ ...tampered, data: Buffer.from(tampered.data).toString("base64url") }, "gallery-1", secret)).toThrow(ProofSelectionKeyError);
    expect(() => decryptSelectionKey({ ...encrypted, extra: 1 }, "gallery-1", secret)).toThrow(ProofSelectionKeyError);
    expect(encryptSelectionKey(key, "gallery-1", secret).iv).not.toBe(encrypted.iv);
  });
  it("reads only a 32-byte server-only secret", () => {
    expect(readProofSelectionKeySecret({ PROOF_SELECTION_KEY_SECRET: secretText }).equals(secret)).toBe(true);
    for (const value of [undefined, "", "short", Buffer.alloc(31).toString("base64url"), `${secretText}=`]) {
      expect(() => readProofSelectionKeySecret({ PROOF_SELECTION_KEY_SECRET: value })).toThrow(ProofSelectionKeyError);
    }
    expect(() => readProofSelectionKeySecret({ PROOF_SELECTION_KEY_SECRET: secretText, NEXT_PUBLIC_PROOF_SELECTION_KEY_SECRET: secretText })).toThrow(/server-only/);
  });
});

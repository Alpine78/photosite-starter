import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertCapabilitySecret,
  CAPABILITY_SECRET_BYTES,
  canonicalCapabilityAad,
  capabilityEnvelopeKeyId,
  capabilityEnvelopeNeedsRotation,
  GALLERY_HANDLE_BYTES,
  generateCapabilitySecret,
  generateGalleryHandle,
  openCapability,
  parseCapabilityEnvelope,
  PrivateGalleryCapabilityError,
  resealCapability,
  sealCapability,
  type PrivateGalleryCapabilityContext,
} from "@/lib/private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";

function keyOf(fill: number): Buffer {
  return Buffer.alloc(32, fill);
}

/**
 * A fake keyring that records every buffer `getKey` hands out, so a test can
 * prove the module zeroed its copy.
 */
function makeKeyring(entries: Record<string, Buffer>, activeKeyId: string) {
  const handed: Uint8Array[] = [];
  const keyring: PrivateGalleryCapabilityKeyring = {
    activeKeyId,
    keyIds: Object.freeze(Object.keys(entries)),
    getKey(id) {
      const stored = entries[id];
      if (stored === undefined) return undefined;
      const copy = Uint8Array.from(stored);
      handed.push(copy);
      return copy;
    },
  };
  return { keyring, handed };
}

const CONTEXT: PrivateGalleryCapabilityContext = {
  galleryId: "gallery-01",
  handle: Buffer.alloc(GALLERY_HANDLE_BYTES, 4).toString("base64url"),
  generation: 5,
};

const SECRET = Buffer.alloc(CAPABILITY_SECRET_BYTES, 9).toString("base64url");

// A fixed version-1 envelope built out of band (fixed key, fixed nonce), so a
// wire-format change — field order, base64 vs base64url, a renamed field — is a
// test failure, not a silent incompatibility with already-stored rows.
const GOLDEN_KEY_ID = "key-a";
const GOLDEN_KEY = keyOf(7);
const GOLDEN_ENVELOPE =
  '{"version":1,"algorithm":"A256GCM","keyId":"key-a","nonce":"AwMDAwMDAwMDAwMD","ciphertext":"Zq_ISRl5NQg5ESgWqAaURq5ti6X3xP86bI_s-6C0K_Ly9hZo2KrOCo3ZIA","tag":"CLrSzNK4T7pU1_dXlCZJVg"}';

describe("canonicalCapabilityAad", () => {
  it("is the exact UTF-8 of the fixed-order tuple", () => {
    expect(canonicalCapabilityAad(CONTEXT).toString("utf8")).toBe(
      `["private-gallery-capability-v1","gallery-01","${CONTEXT.handle}",5]`,
    );
  });

  it.each([
    ["a negative generation", { generation: -1 }],
    ["a fractional generation", { generation: 1.5 }],
    ["a NaN generation", { generation: Number.NaN }],
    ["an empty galleryId", { galleryId: "" }],
    ["an over-long galleryId", { galleryId: "g".repeat(129) }],
    ["a non-printable galleryId", { galleryId: "gallery 01" }],
    ["a non-base64url handle", { handle: "not/base64url" }],
    ["a too-short handle", { handle: Buffer.alloc(8, 1).toString("base64url") }],
    ["an over-long handle", { handle: Buffer.alloc(65, 1).toString("base64url") }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      canonicalCapabilityAad({ ...CONTEXT, ...override }),
    ).toThrow(PrivateGalleryCapabilityError);
    try {
      canonicalCapabilityAad({ ...CONTEXT, ...override });
    } catch (error) {
      expect((error as PrivateGalleryCapabilityError).reason).toBe(
        "malformed-context",
      );
    }
  });

  it("accepts the exact 128-bit handle floor and a larger handle", () => {
    for (const bytes of [GALLERY_HANDLE_BYTES, 32, 64]) {
      expect(() =>
        canonicalCapabilityAad({
          ...CONTEXT,
          handle: Buffer.alloc(bytes, 2).toString("base64url"),
        }),
      ).not.toThrow();
    }
  });
});

describe("assertCapabilitySecret", () => {
  it("accepts a 32-byte base64url value", () => {
    expect(() => assertCapabilitySecret(SECRET)).not.toThrow();
    expect(() => assertCapabilitySecret(generateCapabilitySecret())).not.toThrow();
  });

  it.each([
    ["empty", ""],
    ["a password", "hunter2"],
    ["16 bytes", Buffer.alloc(16, 1).toString("base64url")],
    ["48 bytes", Buffer.alloc(48, 1).toString("base64url")],
    ["padded base64", Buffer.alloc(32, 1).toString("base64")],
    ["standard-alphabet base64 with +/", "CQkJ+Qk/CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk"],
  ])("rejects %s", (_label, value) => {
    try {
      assertCapabilitySecret(value);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateGalleryCapabilityError);
      expect((error as PrivateGalleryCapabilityError).reason).toBe(
        "malformed-secret",
      );
    }
  });
});

describe("seal / open round trip", () => {
  it("recovers the exact secret", () => {
    const { keyring } = makeKeyring({ k1: keyOf(1) }, "k1");
    const { keyId, envelope } = sealCapability(keyring, CONTEXT, SECRET);

    expect(keyId).toBe("k1");
    expect(openCapability(keyring, CONTEXT, envelope)).toBe(SECRET);
  });

  it("uses a fresh nonce each time — two seals of the same input differ", () => {
    const { keyring } = makeKeyring({ k1: keyOf(1) }, "k1");
    const a = sealCapability(keyring, CONTEXT, SECRET).envelope;
    const b = sealCapability(keyring, CONTEXT, SECRET).envelope;

    expect(a).not.toBe(b);
    expect(parseCapabilityEnvelope(a).nonce).not.toBe(
      parseCapabilityEnvelope(b).nonce,
    );
  });

  it("opens a fixed golden envelope, proving the wire format is stable", () => {
    const { keyring } = makeKeyring({ [GOLDEN_KEY_ID]: GOLDEN_KEY }, GOLDEN_KEY_ID);
    expect(openCapability(keyring, CONTEXT, GOLDEN_ENVELOPE)).toBe(SECRET);
  });

  it("does not leak the key or the plaintext into the envelope string", () => {
    const { keyring } = makeKeyring({ k1: keyOf(0x2b) }, "k1");
    const { envelope } = sealCapability(keyring, CONTEXT, SECRET);

    expect(envelope).not.toContain(SECRET);
    expect(envelope).not.toContain(keyOf(0x2b).toString("base64url"));
    expect(envelope).not.toContain(keyOf(0x2b).toString("hex"));
  });

  it("zeroes its key copy on the success path", () => {
    const { keyring, handed } = makeKeyring({ k1: keyOf(1) }, "k1");
    const { envelope } = sealCapability(keyring, CONTEXT, SECRET);
    openCapability(keyring, CONTEXT, envelope);

    expect(handed.length).toBeGreaterThan(0);
    for (const buffer of handed) {
      expect(buffer.every((byte) => byte === 0)).toBe(true);
    }
  });
});

describe("fail-closed decryption", () => {
  function sealed(keyFill = 1) {
    const { keyring, handed } = makeKeyring({ k1: keyOf(keyFill) }, "k1");
    const { envelope } = sealCapability(keyring, CONTEXT, SECRET);
    return { keyring, handed, envelope };
  }

  function expectReason(run: () => unknown, reason: string) {
    try {
      run();
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateGalleryCapabilityError);
      expect((error as PrivateGalleryCapabilityError).reason).toBe(reason);
    }
  }

  it("refuses a context bound to a different gallery, handle, or generation", () => {
    const { keyring, envelope } = sealed();
    for (const override of [
      { galleryId: "gallery-02" },
      { handle: Buffer.alloc(GALLERY_HANDLE_BYTES, 5).toString("base64url") },
      { generation: 6 },
    ]) {
      expectReason(
        () => openCapability(keyring, { ...CONTEXT, ...override }, envelope),
        "auth-failed",
      );
    }
  });

  it("refuses a single-bit flip of the ciphertext, tag, or nonce", () => {
    const { keyring, envelope } = sealed();
    const parsed = parseCapabilityEnvelope(envelope);
    for (const field of ["ciphertext", "tag", "nonce"] as const) {
      const bytes = Buffer.from(parsed[field], "base64url");
      bytes[0] ^= 0x01;
      const tampered = JSON.stringify({
        ...parsed,
        [field]: bytes.toString("base64url"),
      });
      // A flipped nonce still decodes to 12 bytes, so it reaches the cipher and
      // fails authentication; a flipped tag likewise.
      expectReason(
        () => openCapability(keyring, CONTEXT, tampered),
        "auth-failed",
      );
    }
  });

  it("refuses an envelope whose keyId the keyring does not hold", () => {
    const { envelope } = sealed();
    const otherKeyring = makeKeyring({ k2: keyOf(2) }, "k2").keyring;
    expectReason(
      () => openCapability(otherKeyring, CONTEXT, envelope),
      "unknown-key",
    );
  });

  it("refuses when the keyId resolves to the wrong key bytes", () => {
    const { envelope } = sealed(1);
    // Same id, different bytes: the id is deliberately not in the AAD, so the
    // GCM tag is what catches it.
    const wrong = makeKeyring({ k1: keyOf(2) }, "k1").keyring;
    expectReason(() => openCapability(wrong, CONTEXT, envelope), "auth-failed");
  });

  it("refuses an unknown version or algorithm", () => {
    const { keyring, envelope } = sealed();
    const parsed = parseCapabilityEnvelope(envelope);
    expectReason(
      () =>
        openCapability(
          keyring,
          CONTEXT,
          JSON.stringify({ ...parsed, version: 2 }),
        ),
      "unknown-version",
    );
    expectReason(
      () =>
        openCapability(
          keyring,
          CONTEXT,
          JSON.stringify({ ...parsed, algorithm: "A128GCM" }),
        ),
      "unknown-algorithm",
    );
  });

  it("zeroes its key copy even when decryption fails", () => {
    const { envelope } = sealed(1);
    const { keyring, handed } = makeKeyring({ k1: keyOf(9) }, "k1");
    try {
      openCapability(keyring, CONTEXT, envelope);
    } catch {
      // expected
    }
    expect(handed.length).toBeGreaterThan(0);
    for (const buffer of handed) {
      expect(buffer.every((byte) => byte === 0)).toBe(true);
    }
  });

  it.each([
    ["an invalid base64url character", "x".repeat(42) + "!"],
    ["bytes that are not valid UTF-8", Buffer.alloc(43, 0xff)],
  ])(
    "classifies a decrypted-but-not-a-capability plaintext as malformed-secret (%s)",
    (_label, plaintext) => {
      // A 43-*byte* plaintext passes the envelope's exact-length check and
      // authenticates, but is not a well-formed capability secret.
      const key = keyOf(1);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(canonicalCapabilityAad(CONTEXT));
      const source =
        typeof plaintext === "string"
          ? Buffer.from(plaintext, "utf8")
          : plaintext;
      const ct = Buffer.concat([cipher.update(source), cipher.final()]);
      const envelope = JSON.stringify({
        version: 1,
        algorithm: "A256GCM",
        keyId: "k1",
        nonce: nonce.toString("base64url"),
        ciphertext: ct.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
      });
      const { keyring, handed } = makeKeyring({ k1: key }, "k1");
      expectReason(
        () => openCapability(keyring, CONTEXT, envelope),
        "malformed-secret",
      );
      for (const buffer of handed) {
        expect(buffer.every((byte) => byte === 0)).toBe(true);
      }
    },
  );
});

describe("parseCapabilityEnvelope", () => {
  const valid = () => {
    const { keyring } = makeKeyring({ k1: keyOf(1) }, "k1");
    return sealCapability(keyring, CONTEXT, SECRET).envelope;
  };

  it.each([
    ["not a string", 123 as unknown as string],
    ["empty", ""],
    ["over the length ceiling", `{"x":"${"a".repeat(600)}"}`],
    ["not JSON", "{not json"],
    ["a JSON array", "[]"],
    ["null", "null"],
    ["a JSON primitive", "42"],
    ["a missing field", '{"version":1,"algorithm":"A256GCM","keyId":"k1","nonce":"AA","ciphertext":"AA"}'],
    [
      "an extra field",
      '{"version":1,"algorithm":"A256GCM","keyId":"k1","nonce":"AwMDAwMDAwMDAwMD","ciphertext":"Zq_ISRl5NQg5ESgWqAaURq5ti6X3xP86bI_s-6C0K_Ly9hZo2KrOCo3ZIA","tag":"CLrSzNK4T7pU1_dXlCZJVg","extra":1}',
    ],
  ])("rejects %s as malformed-envelope", (_label, value) => {
    try {
      parseCapabilityEnvelope(value);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateGalleryCapabilityError);
      expect((error as PrivateGalleryCapabilityError).reason).toBe(
        "malformed-envelope",
      );
    }
  });

  it.each([
    ["an invalid keyId", "keyId", "Not_A_Key"],
    ["a wrong-length nonce", "nonce", "AAAA"],
    ["a nonce using the base64 (not -url) alphabet", "nonce", "+/v7+/v7+/v7"],
    // The golden tag with its last character bumped so its unused low bits are
    // non-zero — decodes to the same 16 bytes, re-encodes differently.
    ["a non-canonical tag", "tag", "CLrSzNK4T7pU1_dXlCZJVh"],
  ])("rejects %s as malformed-envelope", (_label, field, value) => {
    const parsed = parseCapabilityEnvelope(valid());
    try {
      parseCapabilityEnvelope(JSON.stringify({ ...parsed, [field]: value }));
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as PrivateGalleryCapabilityError).reason).toBe(
        "malformed-envelope",
      );
    }
  });

  it("round-trips a valid envelope through parse", () => {
    const envelope = valid();
    const parsed = parseCapabilityEnvelope(envelope);
    expect(JSON.stringify(parsed)).toBe(envelope);
    expect(capabilityEnvelopeKeyId(envelope)).toBe("k1");
  });
});

describe("rotation", () => {
  it("needs rotation when sealed under a retired key, then reseals under the active one", () => {
    const sealKeyring = makeKeyring({ k1: keyOf(1) }, "k1").keyring;
    const { envelope: old } = sealCapability(sealKeyring, CONTEXT, SECRET);

    // k1 retained, k2 now active.
    const rotated = makeKeyring({ k1: keyOf(1), k2: keyOf(2) }, "k2").keyring;
    expect(capabilityEnvelopeNeedsRotation(rotated, old)).toBe(true);
    // The old envelope still opens while k1 is retained.
    expect(openCapability(rotated, CONTEXT, old)).toBe(SECRET);

    const { keyId, envelope: fresh } = resealCapability(rotated, CONTEXT, old);
    expect(keyId).toBe("k2");
    expect(capabilityEnvelopeNeedsRotation(rotated, fresh)).toBe(false);
    expect(openCapability(rotated, CONTEXT, fresh)).toBe(SECRET);

    // Once k1 is removed, the old envelope no longer opens.
    const afterRetire = makeKeyring({ k2: keyOf(2) }, "k2").keyring;
    expect(() => openCapability(afterRetire, CONTEXT, old)).toThrow(
      /no key for id/,
    );
    expect(openCapability(afterRetire, CONTEXT, fresh)).toBe(SECRET);
  });
});

describe("generators", () => {
  it("generateCapabilitySecret is 256 bits of base64url and unique", () => {
    const a = generateCapabilitySecret();
    const b = generateCapabilitySecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(CAPABILITY_SECRET_BYTES);
    expect(() => assertCapabilitySecret(a)).not.toThrow();
  });

  it("generateGalleryHandle is at the 128-bit floor and unique", () => {
    const a = generateGalleryHandle();
    const b = generateGalleryHandle();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(GALLERY_HANDLE_BYTES);
    expect(GALLERY_HANDLE_BYTES).toBe(16);
    expect(() =>
      canonicalCapabilityAad({ ...CONTEXT, handle: a }),
    ).not.toThrow();
  });
});

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodePrivateGalleryAdminCredential,
  loadPrivateGalleryAdminCredential,
  parsePrivateGalleryAdminCredential,
  PRIVATE_GALLERY_ADMIN_HASH_BYTES,
  PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH,
  PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH,
  PRIVATE_GALLERY_ADMIN_SALT_BYTES,
  PRIVATE_GALLERY_ADMIN_SCRYPT_N,
  PRIVATE_GALLERY_ADMIN_SCRYPT_P,
  PRIVATE_GALLERY_ADMIN_SCRYPT_R,
  PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING,
  privateGalleryAdminCredentialGeneration,
  PrivateGalleryAdminCredentialError,
  verifyPrivateGalleryAdminSecret,
} from "@/lib/private-gallery-admin-credential";

const SECRET = randomBytes(32).toString("base64url");
const SALT = Buffer.alloc(PRIVATE_GALLERY_ADMIN_SALT_BYTES, 7);
const ENCODED = encodePrivateGalleryAdminCredential({ secret: SECRET, salt: SALT });

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PrivateGalleryAdminCredentialError) return error.reason;
    throw error;
  }
  throw new Error("expected a PrivateGalleryAdminCredentialError");
}

describe("the encoded format", () => {
  it("is a self-describing scrypt string carrying its own parameters", () => {
    const fields = ENCODED.split("$");
    expect(fields).toHaveLength(7);
    expect(fields[0]).toBe("scrypt");
    expect(fields[1]).toBe("1");
    expect(fields[2]).toBe(String(PRIVATE_GALLERY_ADMIN_SCRYPT_N));
    expect(fields[3]).toBe(String(PRIVATE_GALLERY_ADMIN_SCRYPT_R));
    expect(fields[4]).toBe(String(PRIVATE_GALLERY_ADMIN_SCRYPT_P));
  });

  it("round-trips through the parser", () => {
    const credential = parsePrivateGalleryAdminCredential(ENCODED);
    expect(credential.n).toBe(PRIVATE_GALLERY_ADMIN_SCRYPT_N);
    expect(credential.r).toBe(PRIVATE_GALLERY_ADMIN_SCRYPT_R);
    expect(credential.p).toBe(PRIVATE_GALLERY_ADMIN_SCRYPT_P);
    expect(credential.salt).toEqual(SALT);
    expect(credential.hash).toHaveLength(PRIVATE_GALLERY_ADMIN_HASH_BYTES);
  });

  it("is deterministic for one secret and salt, and differs for another salt", () => {
    expect(
      encodePrivateGalleryAdminCredential({ secret: SECRET, salt: SALT }),
    ).toBe(ENCODED);
    expect(
      encodePrivateGalleryAdminCredential({
        secret: SECRET,
        salt: Buffer.alloc(PRIVATE_GALLERY_ADMIN_SALT_BYTES, 8),
      }),
    ).not.toBe(ENCODED);
  });

  it("uses ADR-0015 §4's parameters, which need an explicit maxmem to run at all", () => {
    // Measured against the pinned Node major: 128 * N * r is exactly Node's
    // default maxmem, and OpenSSL rejects at >=. If this module ever stopped
    // passing maxmem explicitly, encoding would throw rather than quietly
    // weaken — but the parameters are pinned here so the pairing stays visible.
    expect(128 * PRIVATE_GALLERY_ADMIN_SCRYPT_N * PRIVATE_GALLERY_ADMIN_SCRYPT_R).toBe(
      33_554_432,
    );
    expect(() =>
      encodePrivateGalleryAdminCredential({ secret: SECRET, salt: SALT }),
    ).not.toThrow();
  });
});

describe("parsing refuses what it should", () => {
  it.each([
    ["a value that is not the format at all", "hunter2"],
    ["too few fields", "scrypt$1$32768$8$1$AAAA"],
    ["too many fields", `${ENCODED}$extra`],
    ["a different algorithm", ENCODED.replace(/^scrypt/, "bcrypt")],
  ])("refuses %s", (_label, value) => {
    expect(reason(() => parsePrivateGalleryAdminCredential(value))).toBe(
      "malformed",
    );
  });

  it("refuses an unknown version distinctly, so the format can evolve", () => {
    expect(
      reason(() =>
        parsePrivateGalleryAdminCredential(ENCODED.replace("$1$", "$2$")),
      ),
    ).toBe("unsupported-version");
  });

  it.each([
    ["N below ADR-0015 §4's floor", "16384", 2],
    ["N above the memory ceiling", "262144", 2],
    ["N not a power of two", "32769", 2],
    ["r below the floor", "4", 3],
    ["r above the ceiling", "64", 3],
    ["p below the floor", "0", 4],
    ["p above the ceiling", "8", 4],
  ])("refuses %s as weak parameters", (_label, value, field) => {
    const fields = ENCODED.split("$");
    fields[field as number] = value as string;
    expect(reason(() => parsePrivateGalleryAdminCredential(fields.join("$")))).toBe(
      "weak-parameters",
    );
  });

  it.each([
    ["hexadecimal", "0x8000"],
    ["exponential", "1e5"],
    ["padded with spaces", " 32768"],
    ["Infinity", "Infinity"],
  ])("refuses a %s cost parameter rather than coercing it", (_label, value) => {
    // `Number()` would accept every one of these and produce something
    // plausible; a cost parameter is the last place to allow that.
    const fields = ENCODED.split("$");
    fields[2] = value;
    expect(reason(() => parsePrivateGalleryAdminCredential(fields.join("$")))).toBe(
      "malformed",
    );
  });

  it("refuses parameters that are each allowed but ask for too much memory together", () => {
    // N = 2^17 and r = 32 are both inside their own ceilings; their product is
    // 512 MiB, which inside a login is an allocation failure rather than a
    // configuration error anyone can read.
    const fields = ENCODED.split("$");
    fields[2] = "131072";
    fields[3] = "32";
    expect(reason(() => parsePrivateGalleryAdminCredential(fields.join("$")))).toBe(
      "weak-parameters",
    );

    // Each on its own, with the other at the ADR's value, is accepted.
    const raisedN = ENCODED.split("$");
    raisedN[2] = "131072";
    expect(() =>
      parsePrivateGalleryAdminCredential(raisedN.join("$")),
    ).not.toThrow();
  });

  it("refuses a salt that is too short and a hash that is the wrong length", () => {
    const short = ENCODED.split("$");
    short[5] = Buffer.alloc(8, 1).toString("base64url");
    expect(reason(() => parsePrivateGalleryAdminCredential(short.join("$")))).toBe(
      "malformed",
    );

    const wrongHash = ENCODED.split("$");
    wrongHash[6] = Buffer.alloc(16, 1).toString("base64url");
    expect(
      reason(() => parsePrivateGalleryAdminCredential(wrongHash.join("$"))),
    ).toBe("malformed");
  });

  it("refuses a non-canonical base64url spelling", () => {
    const fields = ENCODED.split("$");
    const canonical = fields[6] as string;
    fields[6] = `${canonical.slice(0, canonical.length - 1)}${
      canonical.endsWith("A") ? "B" : "A"
    }`;
    // Either it decodes to different bytes (still a valid hash of nothing) or
    // it is non-canonical; both must be refused rather than silently accepted.
    const parsed = () => parsePrivateGalleryAdminCredential(fields.join("$"));
    try {
      parsed();
      // If it parsed, it must at least not verify the real secret.
      expect(
        verifyPrivateGalleryAdminSecret(
          parsePrivateGalleryAdminCredential(fields.join("$")),
          SECRET,
        ),
      ).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateGalleryAdminCredentialError);
    }
  });

  it("never puts the configured value in an error message", () => {
    try {
      parsePrivateGalleryAdminCredential(`${ENCODED}$extra`);
      throw new Error("expected a throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(ENCODED.split("$")[6]);
      expect(message).not.toContain(SECRET);
    }
  });
});

describe("verification", () => {
  const credential = parsePrivateGalleryAdminCredential(ENCODED);

  it("accepts the secret it was generated from", () => {
    expect(verifyPrivateGalleryAdminSecret(credential, SECRET)).toBe(true);
  });

  it("rejects a different secret", () => {
    expect(
      verifyPrivateGalleryAdminSecret(credential, randomBytes(32).toString("base64url")),
    ).toBe(false);
  });

  it("rejects a secret that differs by one character", () => {
    const nearly = `${SECRET.slice(0, -1)}${SECRET.endsWith("A") ? "B" : "A"}`;
    expect(verifyPrivateGalleryAdminSecret(credential, nearly)).toBe(false);
  });

  it("rejects an empty, over-long, or non-string secret without throwing", () => {
    expect(verifyPrivateGalleryAdminSecret(credential, "")).toBe(false);
    expect(
      verifyPrivateGalleryAdminSecret(
        credential,
        "x".repeat(PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH + 1),
      ),
    ).toBe(false);
    expect(
      verifyPrivateGalleryAdminSecret(
        credential,
        undefined as unknown as string,
      ),
    ).toBe(false);
  });

  it("accepts a secret at exactly the length bound", () => {
    const long = "x".repeat(PRIVATE_GALLERY_ADMIN_MAX_SECRET_LENGTH);
    const encoded = encodePrivateGalleryAdminCredential({
      secret: long,
      salt: SALT,
    });
    expect(
      verifyPrivateGalleryAdminSecret(
        parsePrivateGalleryAdminCredential(encoded),
        long,
      ),
    ).toBe(true);
  });
});

describe("the generation digest", () => {
  it("is derived from the encoded credential, and is not the credential", () => {
    const generation = privateGalleryAdminCredentialGeneration(ENCODED);
    expect(generation).not.toContain(ENCODED.split("$")[6]);
    expect(ENCODED).not.toContain(generation);
    // 32 bytes as unpadded base64url — inside the session module's own bound.
    expect(generation).toHaveLength(43);
  });

  it("is stable for one credential and changes with any part of it", () => {
    expect(privateGalleryAdminCredentialGeneration(ENCODED)).toBe(
      privateGalleryAdminCredentialGeneration(ENCODED),
    );
    const otherSalt = encodePrivateGalleryAdminCredential({
      secret: SECRET,
      salt: Buffer.alloc(PRIVATE_GALLERY_ADMIN_SALT_BYTES, 9),
    });
    expect(privateGalleryAdminCredentialGeneration(otherSalt)).not.toBe(
      privateGalleryAdminCredentialGeneration(ENCODED),
    );
  });

  it("is what the parser exposes, so a caller cannot bind a session to something else", () => {
    expect(parsePrivateGalleryAdminCredential(ENCODED).generation).toBe(
      privateGalleryAdminCredentialGeneration(ENCODED),
    );
  });
});

describe("generation refuses a chosen secret", () => {
  it("refuses one shorter than the generated floor (ADR-0015 §4)", () => {
    expect(
      reason(() =>
        encodePrivateGalleryAdminCredential({ secret: "correct-horse", salt: SALT }),
      ),
    ).toBe("invalid-parameter");
    expect(
      reason(() =>
        encodePrivateGalleryAdminCredential({
          secret: "x".repeat(PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH - 1),
          salt: SALT,
        }),
      ),
    ).toBe("invalid-parameter");
  });

  it("accepts one at exactly the floor", () => {
    expect(() =>
      encodePrivateGalleryAdminCredential({
        secret: "x".repeat(PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH),
        salt: SALT,
      }),
    ).not.toThrow();
  });

  it("refuses a salt that is too short", () => {
    expect(
      reason(() =>
        encodePrivateGalleryAdminCredential({
          secret: SECRET,
          salt: Buffer.alloc(8, 1),
        }),
      ),
    ).toBe("invalid-parameter");
  });

  it("refuses to emit parameters its own parser would reject", () => {
    // The self-check: a generator that printed a credential the application
    // then refused to load would fail as a broken deployment rather than a
    // failed command.
    expect(
      reason(() =>
        encodePrivateGalleryAdminCredential({ secret: SECRET, salt: SALT, n: 1024 }),
      ),
    ).toBe("weak-parameters");
  });
});

describe("loading from the environment", () => {
  const setting = PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING;

  it("reads and parses the configured value", () => {
    expect(
      loadPrivateGalleryAdminCredential({ [setting]: ENCODED }).generation,
    ).toBe(privateGalleryAdminCredentialGeneration(ENCODED));
  });

  it("tolerates surrounding whitespace from a pasted value", () => {
    expect(() =>
      loadPrivateGalleryAdminCredential({ [setting]: `  ${ENCODED}\n` }),
    ).not.toThrow();
  });

  it("reports an unset value as missing, distinctly from malformed", () => {
    expect(reason(() => loadPrivateGalleryAdminCredential({}))).toBe("missing");
    expect(reason(() => loadPrivateGalleryAdminCredential({ [setting]: "  " }))).toBe(
      "missing",
    );
    expect(
      reason(() => loadPrivateGalleryAdminCredential({ [setting]: "nonsense" })),
    ).toBe("malformed");
  });

  it("refuses a NEXT_PUBLIC_ mirror even when the real setting is fine", () => {
    expect(
      reason(() =>
        loadPrivateGalleryAdminCredential({
          [setting]: ENCODED,
          [`NEXT_PUBLIC_${setting}`]: ENCODED,
        }),
      ),
    ).toBe("invalid-parameter");
  });
});

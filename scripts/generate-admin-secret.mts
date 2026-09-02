/**
 * Owner-run: generate the administrator credential (ADR-0015 §4).
 *
 *     npm run admin:secret
 *
 * Prints two things — the **secret**, which goes into the operator's password
 * manager and is typed nowhere else, and the **hash**, which becomes the
 * deployment's `PRIVATE_GALLERY_ADMIN_SECRET_HASH`. Neither is written to a
 * file: this command's whole output is the operator's to place, and a
 * repository that wrote either to disk would be one `git add .` from publishing
 * it.
 *
 * The secret is generated here rather than chosen by the operator, which
 * ADR-0015 §4 makes a requirement of the decision rather than advice: the
 * boundary has to be *stronger* than a 256-bit customer capability, and a
 * memorable passphrase is not. `--secret` exists for the operator who already
 * generated one with their own tool, and it enforces a length floor rather than
 * accepting anything.
 *
 * Nothing here reads or writes the running application. It is not wired into
 * CI and imports no application configuration.
 */

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import {
  PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH,
  PRIVATE_GALLERY_ADMIN_SALT_BYTES,
  PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING,
  encodePrivateGalleryAdminCredential,
  parsePrivateGalleryAdminCredential,
  privateGalleryAdminCredentialGeneration,
  verifyPrivateGalleryAdminSecret,
} from "../src/lib/private-gallery-admin-credential-format.ts";

/** 32 bytes as base64url — the `openssl rand -base64 32` equivalent §4 names. */
const SECRET_BYTES = 32;

function generateSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      secret: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(
      [
        "Generate the administrator credential (ADR-0015 §4).",
        "",
        "  npm run admin:secret              generate a secret and its hash",
        "  npm run admin:secret -- --secret <value>",
        "                                    hash a secret you generated yourself",
        "",
        `A supplied secret must be at least ${PRIVATE_GALLERY_ADMIN_MIN_GENERATED_SECRET_LENGTH} characters.`,
        "Nothing is written to disk. Neither value is recoverable afterwards.",
        "",
      ].join("\n"),
    );
    return;
  }

  const supplied = values.secret;
  const generated = supplied === undefined;
  const secret = supplied ?? generateSecret();

  const encoded = encodePrivateGalleryAdminCredential({
    secret,
    salt: randomBytes(PRIVATE_GALLERY_ADMIN_SALT_BYTES),
  });

  // Verify what we are about to print, against the parser the application will
  // use. A credential an operator stores and cannot log in with is the worst
  // possible outcome of this command, and it costs one scrypt to rule out.
  const credential = parsePrivateGalleryAdminCredential(encoded);
  if (!verifyPrivateGalleryAdminSecret(credential, secret)) {
    throw new Error(
      "generated a credential that does not verify against its own secret; refusing to print it",
    );
  }

  const lines = [
    "",
    "Administrator credential (ADR-0015 §4)",
    "======================================",
    "",
  ];

  if (generated) {
    lines.push(
      "SECRET — store this in your password manager now. It is not recoverable.",
      "",
      `  ${secret}`,
      "",
    );
  } else {
    lines.push(
      "SECRET — the one you supplied; not reprinted here.",
      "",
    );
  }

  lines.push(
    `${PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING} — set this as a Sensitive`,
    "environment variable on the deployment (never NEXT_PUBLIC_, never committed):",
    "",
    `  ${encoded}`,
    "",
    "Notes",
    "-----",
    "  * Rotating this variable and redeploying ends every live administrator",
    "    session immediately (ADR-0015 §2). That is the revocation path; there is",
    "    no password-reset flow, deliberately.",
    `  * Session binding digest: ${privateGalleryAdminCredentialGeneration(encoded)}`,
    "    (derived from the hash, stored in the session table — not a credential.)",
    "",
  );

  process.stdout.write(lines.join("\n"));
}

main();

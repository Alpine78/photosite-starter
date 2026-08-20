/**
 * Signed Sanity webhook parsing and invalidation planning.
 *
 * Signature verification happens over the exact bounded UTF-8 bytes before
 * JSON parsing. The route receives only a closed result: a finite cache-tag
 * set or a classified rejection. No document body, secret, signature, or
 * idempotency key is exposed to logging code.
 */

import "server-only";

import {
  isValidSignature,
  SIGNATURE_HEADER_NAME,
} from "@sanity/webhook";

import {
  getSanityBroadInvalidationTags,
  getSanityDocumentInvalidationTags,
  isKnownSanityPublicDocumentType,
  type SanityPublicCacheTag,
} from "@/lib/sanity-cache";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";

export const MAX_SANITY_WEBHOOK_BODY_BYTES = 16 * 1024;
export const SANITY_WEBHOOK_SECRET_SETTING = "SANITY_WEBHOOK_SECRET";
const PUBLIC_SANITY_WEBHOOK_SECRET_SETTING =
  "NEXT_PUBLIC_SANITY_WEBHOOK_SECRET";

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;.*)?$/i;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;

export type SanityWebhookErrorClass =
  | "configuration"
  | "unsupported-media-type"
  | "invalid-size"
  | "invalid-signature"
  | "malformed-payload"
  | "wrong-source"
  | "unknown-document-type";

export class SanityWebhookError extends Error {
  readonly errorClass: SanityWebhookErrorClass;
  readonly status: number;

  constructor(errorClass: SanityWebhookErrorClass, status: number) {
    super(`[sanity-revalidation] Webhook rejected: ${errorClass}`);
    this.name = "SanityWebhookError";
    this.errorClass = errorClass;
    this.status = status;
  }
}

type SanityWebhookEnvironment = Record<string, string | undefined>;

type DocumentState = {
  readonly _id: string;
  readonly _type: string;
};

type WebhookOperation = "create" | "update" | "delete" | "reconcile";

export type SanityWebhookPlan = {
  readonly operation: WebhookOperation;
  readonly tags: readonly SanityPublicCacheTag[];
  readonly broadFallback: boolean;
};

function fail(errorClass: SanityWebhookErrorClass, status: number): never {
  throw new SanityWebhookError(errorClass, status);
}

function readSecret(environment: SanityWebhookEnvironment): string {
  const secret = environment[SANITY_WEBHOOK_SECRET_SETTING];
  if (
    environment[PUBLIC_SANITY_WEBHOOK_SECRET_SETTING] !== undefined ||
    secret === undefined ||
    secret === "[SENSITIVE]" ||
    secret.length < 32
  ) {
    return fail("configuration", 500);
  }
  return secret;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function readDocumentState(value: unknown): DocumentState | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["_id", "_type"])) {
    return fail("malformed-payload", 400);
  }

  const { _id: id, _type: type } = value;
  if (
    typeof id !== "string" ||
    !DOCUMENT_ID_PATTERN.test(id) ||
    id.startsWith("drafts.") ||
    id.startsWith("versions.") ||
    typeof type !== "string" ||
    !TYPE_PATTERN.test(type)
  ) {
    return fail("malformed-payload", 400);
  }

  if (!isKnownSanityPublicDocumentType(type)) {
    return fail("unknown-document-type", 400);
  }

  return { _id: id, _type: type };
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return fail("invalid-size", 400);
    if (Number(declaredLength) > MAX_SANITY_WEBHOOK_BODY_BYTES) {
      return fail("invalid-size", 413);
    }
  }

  if (request.body === null) return fail("invalid-size", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let tooLarge = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SANITY_WEBHOOK_BODY_BYTES) {
        await reader.cancel();
        tooLarge = true;
        break;
      }
      chunks.push(value);
    }
  } catch {
    return fail("malformed-payload", 400);
  }

  if (tooLarge) return fail("invalid-size", 413);
  if (size === 0) return fail("invalid-size", 400);

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return fail("malformed-payload", 400);
  }
}

function parsePayload(
  rawBody: string,
  expected: Pick<SanityConfig, "projectId" | "dataset">,
): SanityWebhookPlan {
  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    return fail("malformed-payload", 400);
  }

  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(
      value,
      ["schemaVersion", "projectId", "dataset", "operation"],
      ["before", "after"],
    ) ||
    value.schemaVersion !== 1 ||
    typeof value.projectId !== "string" ||
    typeof value.dataset !== "string" ||
    !["create", "update", "delete", "reconcile"].includes(
      String(value.operation),
    )
  ) {
    return fail("malformed-payload", 400);
  }

  if (
    value.projectId !== expected.projectId ||
    value.dataset !== expected.dataset
  ) {
    return fail("wrong-source", 403);
  }

  const operation = value.operation as WebhookOperation;
  const before = readDocumentState(value.before);
  const after = readDocumentState(value.after);

  if (
    (operation === "create" && (after == null || before != null)) ||
    (operation === "delete" && after != null) ||
    (operation === "update" && after == null) ||
    (operation === "reconcile" && (before != null || after != null)) ||
    (before != null &&
      after != null &&
      (before._id !== after._id || before._type !== after._type))
  ) {
    return fail("malformed-payload", 400);
  }

  const oldStateRequired = operation === "update" || operation === "delete";
  const broadFallback =
    operation === "reconcile" || (oldStateRequired && before == null);
  const types = [before?._type, after?._type].filter(
    (type): type is string => type !== undefined,
  );

  return {
    operation,
    broadFallback,
    tags: broadFallback
      ? getSanityBroadInvalidationTags()
      : getSanityDocumentInvalidationTags(types),
  };
}

export async function readSanityWebhook(
  request: Request,
  options: {
    readonly environment?: SanityWebhookEnvironment;
    readonly config?: Pick<SanityConfig, "projectId" | "dataset">;
  } = {},
): Promise<SanityWebhookPlan> {
  if (!JSON_CONTENT_TYPE.test(request.headers.get("content-type") ?? "")) {
    return fail("unsupported-media-type", 415);
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    idempotencyKey === null ||
    !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    return fail("malformed-payload", 400);
  }

  const rawBody = await readBoundedBody(request);
  const signature = request.headers.get(SIGNATURE_HEADER_NAME);
  const secret = readSecret(options.environment ?? process.env);

  if (
    signature === null ||
    !(await isValidSignature(rawBody, signature, secret))
  ) {
    return fail("invalid-signature", 401);
  }

  return parsePayload(rawBody, options.config ?? getSanityConfig());
}

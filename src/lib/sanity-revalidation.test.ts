import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import { describe, expect, it } from "vitest";

import {
  MAX_SANITY_WEBHOOK_BODY_BYTES,
  readSanityWebhook,
  SANITY_WEBHOOK_SECRET_SETTING,
} from "@/lib/sanity-revalidation";
import { SANITY_PUBLIC_CACHE_TAGS } from "@/lib/sanity-cache";

const endpoint = "https://studio.example/api/revalidate";
const secret = "fixture-webhook-secret-with-at-least-32-bytes";
const config = { projectId: "zp7mbokg", dataset: "production" };

const articleUpdate = {
  schemaVersion: 1,
  projectId: config.projectId,
  dataset: config.dataset,
  operation: "update",
  before: { _id: "article-1", _type: "article" },
  after: { _id: "article-1", _type: "article" },
};

async function signedRequest(
  payload: unknown,
  overrides: {
    readonly body?: string;
    readonly signatureBody?: string;
    readonly contentType?: string;
    readonly idempotencyKey?: string;
  } = {},
): Promise<Request> {
  const body = overrides.body ?? JSON.stringify(payload);
  const signature = await encodeSignatureHeader(
    overrides.signatureBody ?? body,
    Date.now(),
    secret,
  );

  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": overrides.contentType ?? "application/json",
      "idempotency-key": overrides.idempotencyKey ?? "fixture-delivery-1",
      [SIGNATURE_HEADER_NAME]: signature,
    },
    body,
  });
}

async function read(request: Request) {
  return readSanityWebhook(request, {
    config,
    environment: { [SANITY_WEBHOOK_SECRET_SETTING]: secret },
  });
}

describe("readSanityWebhook", () => {
  it("verifies the raw body and returns the closed article invalidation set", async () => {
    const plan = await read(await signedRequest(articleUpdate));

    expect(plan).toEqual({
      operation: "update",
      broadFallback: false,
      tags: [
        SANITY_PUBLIC_CACHE_TAGS.articles,
        SANITY_PUBLIC_CACHE_TAGS.categories,
        SANITY_PUBLIC_CACHE_TAGS.metadata,
        SANITY_PUBLIC_CACHE_TAGS.sitemap,
      ],
    });
  });

  it("rejects a signature made over different bytes before parsing", async () => {
    await expect(
      read(
        await signedRequest(articleUpdate, {
          signatureBody: JSON.stringify({ ...articleUpdate, operation: "delete" }),
        }),
      ),
    ).rejects.toMatchObject({ errorClass: "invalid-signature", status: 401 });
  });

  it("rejects a payload from another project or dataset", async () => {
    await expect(
      read(
        await signedRequest({
          ...articleUpdate,
          projectId: "another-project",
        }),
      ),
    ).rejects.toMatchObject({ errorClass: "wrong-source", status: 403 });
  });

  it("rejects unknown document types without doing invalidation work", async () => {
    await expect(
      read(
        await signedRequest({
          ...articleUpdate,
          before: { _id: "future-1", _type: "futureType" },
          after: { _id: "future-1", _type: "futureType" },
        }),
      ),
    ).rejects.toMatchObject({
      errorClass: "unknown-document-type",
      status: 400,
    });
  });

  it("rejects draft and version identities from the public boundary", async () => {
    for (const id of ["drafts.article-1", "versions.release.article-1"]) {
      await expect(
        read(
          await signedRequest({
            ...articleUpdate,
            before: { _id: id, _type: "article" },
            after: { _id: id, _type: "article" },
          }),
        ),
      ).rejects.toMatchObject({ errorClass: "malformed-payload" });
    }
  });

  it("uses the one-tag broad fallback when an update has no old state", async () => {
    const plan = await read(
      await signedRequest({
        ...articleUpdate,
        before: null,
      }),
    );

    expect(plan).toEqual({
      operation: "update",
      broadFallback: true,
      tags: [SANITY_PUBLIC_CACHE_TAGS.all],
    });
  });

  it("accepts duplicate delivery as the same idempotent invalidation plan", async () => {
    const first = await read(
      await signedRequest(articleUpdate, { idempotencyKey: "same-delivery" }),
    );
    const replay = await read(
      await signedRequest(articleUpdate, { idempotencyKey: "same-delivery" }),
    );

    expect(replay).toEqual(first);
  });

  it("accepts the signed operator reconciliation payload as a bounded broad purge", async () => {
    const plan = await read(
      await signedRequest({
        schemaVersion: 1,
        projectId: config.projectId,
        dataset: config.dataset,
        operation: "reconcile",
      }),
    );

    expect(plan).toEqual({
      operation: "reconcile",
      broadFallback: true,
      tags: [SANITY_PUBLIC_CACHE_TAGS.all],
    });
  });

  it("rejects malformed, extra, or inconsistent payload fields", async () => {
    const cases = [
      { ...articleUpdate, unexpected: true },
      { ...articleUpdate, operation: "delete", after: articleUpdate.after },
      {
        ...articleUpdate,
        after: { _id: "article-2", _type: "article" },
      },
    ];

    for (const payload of cases) {
      await expect(read(await signedRequest(payload))).rejects.toMatchObject({
        errorClass: "malformed-payload",
        status: 400,
      });
    }
  });

  it("bounds the body before signature verification or JSON parsing", async () => {
    const body = JSON.stringify({ value: "x".repeat(MAX_SANITY_WEBHOOK_BODY_BYTES) });
    await expect(
      read(await signedRequest({}, { body })),
    ).rejects.toMatchObject({ errorClass: "invalid-size", status: 413 });
  });

  it("requires JSON, an idempotency key, and a configured strong secret", async () => {
    await expect(
      read(await signedRequest(articleUpdate, { contentType: "text/plain" })),
    ).rejects.toMatchObject({ errorClass: "unsupported-media-type", status: 415 });

    await expect(
      read(await signedRequest(articleUpdate, { idempotencyKey: "" })),
    ).rejects.toMatchObject({ errorClass: "malformed-payload", status: 400 });

    await expect(
      readSanityWebhook(await signedRequest(articleUpdate), {
        config,
        environment: { [SANITY_WEBHOOK_SECRET_SETTING]: "too-short" },
      }),
    ).rejects.toMatchObject({ errorClass: "configuration", status: 500 });

    await expect(
      readSanityWebhook(await signedRequest(articleUpdate), {
        config,
        environment: {
          [SANITY_WEBHOOK_SECRET_SETTING]: secret,
          NEXT_PUBLIC_SANITY_WEBHOOK_SECRET: "public-copy",
        },
      }),
    ).rejects.toMatchObject({ errorClass: "configuration", status: 500 });
  });
});

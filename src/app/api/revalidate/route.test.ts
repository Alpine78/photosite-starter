import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  readSanityWebhook: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: dependencies.revalidateTag }));
vi.mock("@/lib/sanity-revalidation", () => {
  class SanityWebhookError extends Error {
    constructor(
      readonly errorClass: string,
      readonly status: number,
    ) {
      super(errorClass);
    }
  }

  return {
    readSanityWebhook: dependencies.readSanityWebhook,
    SanityWebhookError,
  };
});

import { POST } from "@/app/api/revalidate/route";
import { SanityWebhookError } from "@/lib/sanity-revalidation";

const request = new Request("https://studio.example/api/revalidate", {
  method: "POST",
  body: "{}",
});

beforeEach(() => {
  vi.restoreAllMocks();
  dependencies.readSanityWebhook.mockReset();
  dependencies.revalidateTag.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/revalidate", () => {
  it("hard-expires every planned tag and returns no cache details", async () => {
    dependencies.readSanityWebhook.mockResolvedValue({
      operation: "update",
      broadFallback: false,
      tags: ["sanity:articles", "sanity:metadata"],
    });

    const result = await POST(request.clone());
    const body = (await result.json()) as Record<string, unknown>;

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.revalidateTag.mock.calls).toEqual([
      ["sanity:articles", { expire: 0 }],
      ["sanity:metadata", { expire: 0 }],
    ]);
    expect(body).toEqual({
      status: "accepted",
      correlationId: expect.any(String),
    });
  });

  it("returns a retryable 503 when managed invalidation fails", async () => {
    dependencies.readSanityWebhook.mockResolvedValue({
      operation: "delete",
      broadFallback: false,
      tags: ["sanity:galleries"],
    });
    dependencies.revalidateTag.mockImplementation(() => {
      throw new Error("provider detail that must not escape");
    });

    const result = await POST(request.clone());
    const body = (await result.json()) as Record<string, unknown>;

    expect(result.status).toBe(503);
    expect(body).toEqual({
      status: "failed",
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("provider detail");
  });

  it("preserves classified rejection status without logging request data", async () => {
    dependencies.readSanityWebhook.mockRejectedValue(
      new SanityWebhookError("invalid-signature", 401),
    );

    const result = await POST(request.clone());

    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({
      status: "rejected",
      correlationId: expect.any(String),
    });
    expect(dependencies.revalidateTag).not.toHaveBeenCalled();
  });
});

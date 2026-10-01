import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PrivateGalleryPreviewMintQueue,
  PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT,
  PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE,
} from "@/lib/private-gallery-preview-mint-queue";

afterEach(() => vi.useRealTimers());

describe("private proof preview mint admission", () => {
  it("caps concurrent requests and removes an aborted queued card", async () => {
    const queue = new PrivateGalleryPreviewMintQueue();
    const active: Array<() => void> = [];
    let started = 0;
    const task = () => new Promise<void>((resolve) => {
      started += 1;
      active.push(resolve);
    });
    const running = Array.from({ length: PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT }, () =>
      queue.enqueue(new AbortController().signal, task));
    const skipped = new AbortController();
    const skippedTask = queue.enqueue(skipped.signal, task);
    await Promise.resolve();
    expect(started).toBe(PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT);
    skipped.abort();
    await expect(skippedTask).rejects.toMatchObject({ name: "AbortError" });
    active.forEach((release) => release());
    await Promise.all(running);
    expect(started).toBe(PRIVATE_GALLERY_PREVIEW_MINT_MAX_IN_FLIGHT);
  });

  it("admits no more than 50 mints in a rolling minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    const queue = new PrivateGalleryPreviewMintQueue();
    let started = 0;
    const task = async () => { started += 1; };
    await Promise.all(Array.from({ length: PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE }, () =>
      queue.enqueue(new AbortController().signal, task)));
    expect(started).toBe(PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE);

    const next = queue.enqueue(new AbortController().signal, task);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(started).toBe(PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(started).toBe(PRIVATE_GALLERY_PREVIEW_MINT_MAX_PER_MINUTE + 1);
  });
});

import { describe, expect, it } from "vitest";
import { readingProgress } from "@/lib/browser-reading-geometry";

describe("readingProgress", () => {
  it("is zero before the body reaches the top of the viewport", () => {
    expect(readingProgress({ top: 300, height: 4000 }, 800)).toBe(0);
  });

  it("follows the body's travel through the viewport in whole percent", () => {
    expect(readingProgress({ top: -1200, height: 4000 }, 800)).toBe(38);
  });

  it("reaches 100 once the end of the body is visible", () => {
    expect(readingProgress({ top: -3200, height: 4000 }, 800)).toBe(100);
    expect(readingProgress({ top: -5000, height: 4000 }, 800)).toBe(100);
  });

  it("treats a body shorter than the viewport as read only once it fits entirely", () => {
    expect(readingProgress({ top: 100, height: 500 }, 800)).toBe(100);
    expect(readingProgress({ top: 400, height: 500 }, 800)).toBe(0);
  });

  it("never reports progress from invalid geometry", () => {
    expect(readingProgress({ top: Number.NaN, height: 4000 }, 800)).toBe(0);
    expect(readingProgress({ top: 0, height: 0 }, 800)).toBe(0);
    expect(readingProgress({ top: 0, height: 4000 }, 0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { isLightboxZoomed } from "@/lib/lightbox-zoom-state";

describe("isLightboxZoomed", () => {
  it("is zoomed when the current level is above the level it opened at", () => {
    expect(isLightboxZoomed(2, 1)).toBe(true);
    expect(isLightboxZoomed(1.0001, 1)).toBe(true);
  });

  it("is not zoomed at exactly the level it opened at", () => {
    // ADR-0005 can cap an already-large image so initial === secondary === max;
    // the zoom toggle is then a no-op and the caption must stay visible.
    expect(isLightboxZoomed(1, 1)).toBe(false);
    expect(isLightboxZoomed(0.5, 0.5)).toBe(false);
  });

  it("is not zoomed when the current level is below the opening level", () => {
    // Transient, during a pinch-to-close gesture.
    expect(isLightboxZoomed(0.8, 1)).toBe(false);
  });

  it("fails closed to not zoomed for a non-finite level", () => {
    expect(isLightboxZoomed(Number.NaN, 1)).toBe(false);
    expect(isLightboxZoomed(Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(isLightboxZoomed(2, Number.NaN)).toBe(false);
  });
});

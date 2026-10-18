import { describe, expect, it } from "vitest";
import { fragmentIntersectsViewport, tabFragmentScrollCorrection } from "./content-tab-fragment";

describe("native tab-fragment layout policy", () => {
  it.each([[180, 204], [-1, 23], [719, 743]])("accepts a currently intersecting target (%s,%s)", (top, bottom) => {
    expect(fragmentIntersectsViewport(top, bottom, 720)).toBe(true);
  });
  it.each([[-24, 0, 720], [720, 744, 720], [20, 20, 720], [20, 44, 0], [NaN, 44, 720], [20, Infinity, 720]])(
    "does not restore a target elsewhere or with invalid geometry", (top, bottom, viewport) => {
      expect(fragmentIntersectsViewport(top, bottom, viewport)).toBe(false);
    });
  it("preserves the actual viewport offset instead of jumping to a new reading line", () => {
    expect(tabFragmentScrollCorrection(189, -41, 400, 170)).toBe(-230);
  });
  it("never compensates more than its own shrink when several groups collapse", () => {
    const first = tabFragmentScrollCorrection(189, -311, 400, 170);
    const second = tabFragmentScrollCorrection(189, -311 - first, 500, 230);
    expect(first).toBe(-230);
    expect(second).toBe(-270);
    expect(-311 - first - second).toBe(189);
  });
  it("handles distinct local transitions without carrying a stale global offset", () => {
    const first = tabFragmentScrollCorrection(189, -41, 400, 170);
    const second = tabFragmentScrollCorrection(230, -40, 500, 230);
    expect(-41 - first).toBe(189);
    expect(-40 - second).toBe(230);
  });
  it.each([[189, 189, 400, 170], [189, 190, 400, 170], [189, 188.5, 400, 170], [189, -41, 170, 400], [189, -41, 400, 400], [NaN, -41, 400, 170], [189, -41, Infinity, 170], [189, -41, 400, 0]])(
    "does nothing when the browser already preserved the target or the layout is ineligible", (before, after, oldHeight, newHeight) => {
      expect(tabFragmentScrollCorrection(before, after, oldHeight, newHeight)).toBe(0);
    });
});

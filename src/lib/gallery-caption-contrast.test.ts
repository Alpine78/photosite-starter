import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps overlay text above AA even over an entirely white photograph", () => {
  const css = readFileSync("src/components/gallery-figure.css", "utf8");
  const rule = css.match(/\.gallery-caption--overlay\s*\{([^}]+)\}/)![1];
  expect(rule).toMatch(/color:\s*#fff;/);
  const alpha = Number(rule.match(/background:\s*rgb\(0 0 0 \/ ([\d.]+)\)/)![1]);
  const channel = 1 - alpha;
  const luminance = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
});

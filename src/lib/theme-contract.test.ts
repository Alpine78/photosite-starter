import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The theme contract (AB#36) lives in CSS — `src/app/globals.css` — so this
 * suite reads that file as text and checks the three properties a role/name
 * journey test cannot see:
 *
 *  1. Light and dark are *explicit* (AC4): a bare `:root` light palette, a dark
 *     palette reachable by OS preference *and* by an explicit `data-theme`
 *     pin, and `color-scheme` declared in every palette.
 *  2. The two dark blocks (OS-preference and `data-theme="dark"`) define the
 *     same token values — they are duplicated in source and would otherwise
 *     drift silently.
 *  3. Text and focus roles meet WCAG 2.1 AA contrast (AC5) in both palettes.
 *
 * The contrast maths composites a `--foreground`-derived role over its
 * `--background` in sRGB. `color-mix(in oklab, … N%, transparent)` composited
 * over an opaque background is very close to `N%·fg + (1−N%)·bg`, and slightly
 * conservative for these near-neutral inks — good enough for a `≥ 4.5`
 * assertion with margin.
 */

const cssPath = fileURLToPath(
  new URL("../app/globals.css", import.meta.url),
);
const css = readFileSync(cssPath, "utf8");

type Rgb = readonly [number, number, number];

/** Contents of the first top-level `{ … }` block after `selector`. */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

function customProperties(block: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    props.set(match[1], match[2].trim());
  }
  return props;
}

function parseColor(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const rgb = value.match(
    /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*[\d.]+)?\s*\)$/i,
  );
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`unhandled colour syntax: ${value}`);
}

/** Alpha of an `rgb(r g b / a)` value, or 1 when opaque. */
function alphaOf(value: string): number {
  const match = value.match(/\/\s*([\d.]+)\s*\)/);
  return match ? Number(match[1]) : 1;
}

function mixPercent(value: string): number {
  const match = value.match(/var\(--foreground\)\s+(\d+(?:\.\d+)?)%/);
  if (!match) throw new Error(`not a foreground mix: ${value}`);
  return Number(match[1]) / 100;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** Straight-alpha composite of `fg` at `alpha` over opaque `bg`. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(alpha * fg[i] + (1 - alpha) * bg[i])) as
    unknown as Rgb;
}

const lightRoot = customProperties(ruleBody(css, ":root {"));
const pinnedDark = customProperties(ruleBody(css, ':root[data-theme="dark"] {'));
const preferenceDark = customProperties(
  ruleBody(css, ':root:not([data-theme="light"]) {'),
);

/** Tailwind red-700 / red-400 in sRGB — the pinned `--danger` values. */
const DANGER_SRGB = {
  "oklch(50.5% 0.213 27.518)": [193, 0, 7],
  "oklch(70.4% 0.191 22.216)": [248, 113, 113],
} as const satisfies Record<string, Rgb>;

/** Resolve a token to an sRGB colour + alpha within one palette's scope. */
function resolveToken(
  name: string,
  primitives: Map<string, string>,
): { color: Rgb; alpha: number } {
  const raw = primitives.get(name);
  if (raw === undefined) throw new Error(`token missing: ${name}`);
  if (raw.startsWith("color-mix")) {
    const fg = parseColor(primitives.get("--foreground")!);
    return { color: fg, alpha: mixPercent(raw) };
  }
  if (raw === "var(--foreground)") {
    return { color: parseColor(primitives.get("--foreground")!), alpha: 1 };
  }
  if (raw === "var(--background)") {
    return { color: parseColor(primitives.get("--background")!), alpha: 1 };
  }
  if (raw.startsWith("oklch")) {
    const srgb = (DANGER_SRGB as Record<string, Rgb>)[raw];
    if (!srgb) throw new Error(`unpinned oklch value: ${raw}`);
    return { color: srgb, alpha: alphaOf(raw) };
  }
  return { color: parseColor(raw), alpha: alphaOf(raw) };
}

function palettes(): { name: string; props: Map<string, string> }[] {
  return [
    { name: "light", props: lightRoot },
    // The pinned-dark block only overrides the primitives; the derived text
    // roles stay on `:root`, so merge for a complete dark palette.
    {
      name: "dark",
      props: new Map([...lightRoot, ...pinnedDark]),
    },
  ];
}

describe("theme contract: explicit light/dark (AC4)", () => {
  it("declares color-scheme in every palette", () => {
    expect(ruleBody(css, ":root {")).toMatch(/color-scheme:\s*light/);
    expect(ruleBody(css, ':root:not([data-theme="light"]) {')).toMatch(
      /color-scheme:\s*dark/,
    );
    expect(ruleBody(css, ':root[data-theme="dark"] {')).toMatch(
      /color-scheme:\s*dark/,
    );
  });

  it("reaches dark by OS preference AND by an explicit data-theme pin", () => {
    // OS preference, unless a light pin opts out.
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/,
    );
    // Explicit pin, wins even in a light OS.
    expect(css).toContain(':root[data-theme="dark"]');
  });

  it("keeps the two dark blocks in lockstep", () => {
    expect(Object.fromEntries(pinnedDark)).toEqual(
      Object.fromEntries(preferenceDark),
    );
    // and every dark override names a primitive that exists in the light root
    for (const key of pinnedDark.keys()) {
      if (key === "color-scheme") continue;
      expect(lightRoot.has(key)).toBe(true);
    }
  });

  it("keeps the dark interaction wash stronger than the resting surface fill", () => {
    // Folding `dark:hover:bg-white/10` into the `/5` resting fill would erase
    // the dark hover affordance (Codex plan-review finding 1). Light kept both
    // at `black/5` before this refactor, so only dark carries a distinction —
    // and the wash must be the heavier of the two.
    expect(alphaOf(pinnedDark.get("--surface-hover")!)).toBeGreaterThan(
      alphaOf(pinnedDark.get("--surface-muted")!),
    );
  });
});

describe("theme contract: text + focus contrast is AA (AC5)", () => {
  const textRoles = ["--body", "--muted", "--subtle"] as const;

  for (const { name, props } of palettes()) {
    const background = parseColor(props.get("--background")!);

    for (const role of textRoles) {
      it(`${role} on --background meets 4.5:1 (${name})`, () => {
        const { color, alpha } = resolveToken(role, props);
        const effective = over(color, background, alpha);
        expect(contrast(effective, background)).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`--danger text meets 4.5:1 (${name})`, () => {
      const { color } = resolveToken("--danger", props);
      expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
    });

    it(`--focus indicator meets 3:1 vs every surface (${name})`, () => {
      const { color: focus } = resolveToken("--focus", props);
      for (const surface of ["--background", "--surface"] as const) {
        const { color, alpha } = resolveToken(surface, props);
        const effective = over(color, background, alpha);
        expect(contrast(focus, effective)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`--accent-foreground on --accent meets 4.5:1 (${name})`, () => {
      const fg = resolveToken("--accent-foreground", props);
      const bg = resolveToken("--accent", props);
      expect(contrast(fg.color, bg.color)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("theme contract: token vocabulary (AC1)", () => {
  const themeInline = ruleBody(css, "@theme inline {");
  // page + surface, text roles, borders, accent, danger, focus, type.
  const required = [
    "--color-background",
    "--color-foreground",
    "--color-surface",
    "--color-surface-muted",
    "--color-surface-hover",
    "--color-body",
    "--color-muted",
    "--color-subtle",
    "--color-border",
    "--color-border-control",
    "--color-border-strong",
    "--color-accent",
    "--color-accent-foreground",
    "--color-danger",
    "--color-focus",
    "--font-sans",
    "--font-mono",
  ];

  for (const token of required) {
    it(`registers ${token} as a Tailwind theme value`, () => {
      expect(themeInline).toContain(`${token}:`);
    });
  }

  it("redeclares the shared corner-radius scale as an owned override point", () => {
    const theme = ruleBody(css, "@theme {");
    expect(theme).toMatch(/--radius-sm:/);
    expect(theme).toMatch(/--radius-md:/);
    expect(theme).toMatch(/--radius-lg:/);
  });

  it("applies the focus token through one base rule", () => {
    expect(css).toMatch(
      /:focus-visible\s*\{\s*outline-color:\s*var\(--color-focus\)/,
    );
  });

  it("pins --danger to the Tailwind red-700 / red-400 values", () => {
    expect(lightRoot.get("--danger")).toBe("oklch(50.5% 0.213 27.518)");
    expect(pinnedDark.get("--danger")).toBe("oklch(70.4% 0.191 22.216)");
  });
});

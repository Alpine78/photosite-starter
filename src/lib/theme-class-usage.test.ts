import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tailwind silently generates nothing for a class it does not know, so a misspelt or invented colour
 * token renders as whatever it inherits, and neither the build nor a role-based journey test notices.
 * This reads every source file for colour utilities and requires each to name a token registered in
 * `@theme`, or to be on one of the closed lists below.
 *
 * It reads the raw text rather than parsing it, so it finds a class in any string form. The cost is that a
 * hyphenated word in a comment or in copy can look like a class. That is rare: list it in
 * `NOT_COLOURS`, or reword it.
 */

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(srcRoot, "app/globals.css"), "utf8");
const themeStart = css.indexOf("@theme inline {");
/** Only `@theme` makes a utility. A `--color-*` declared anywhere else generates nothing. */
const TOKENS = new Set([...css.slice(themeStart, css.indexOf("}", themeStart)).matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]));

/** Tailwind utilities that share a colour utility's prefix but are not colours. */
const NOT_COLOURS = new Set([
  "bg-linear-to-b", "bg-linear-to-t",
  "border-b", "border-b-0", "border-b-2", "border-collapse", "border-l", "border-l-2", "border-l-4", "border-t", "border-y",
  "outline-none", "outline-offset-2", "outline-offset-4",
  "text-base", "text-center", "text-inherit", "text-left", "text-lg", "text-right", "text-sm", "text-xl", "text-xs",
]);
const TRANSPARENT = new Set(["bg-transparent", "border-transparent"]);
const RAW_COLOURS = new Set(["bg-black", "bg-white", "outline-white", "text-black", "text-white"]);
/** The documented photographic treatments (`docs/theme-contract.md`). Nowhere else may name a raw colour. */
const MAY_USE_RAW_COLOURS = new Set(["components/hero-overlay.tsx", "components/youtube-embed.tsx"]);

const PREFIX = "bg|text|border|ring|outline|divide|fill|stroke|placeholder|decoration|accent|caret";
const UTILITY = new RegExp(`(?<![\\w-])!?((?:${PREFIX})-([a-z][a-z0-9-]*))(?:/[\\w.\\[\\]-]+)?!?(?![\\w-])`, "g");
const ARBITRARY_COLOUR = new RegExp(`(?<![\\w-])(?:${PREFIX})-\\[(?:#|rgb|hsl|oklch|color|red|black|white)[^\\]]*\\]`, "g");

function unknownColourClasses(source: string, file = "any.tsx"): readonly string[] {
  const unknown = new Set<string>([...source.matchAll(ARBITRARY_COLOUR)].map((match) => match[0]));
  for (const match of source.matchAll(UTILITY)) {
    const [, name, token] = match;
    if (TOKENS.has(token) || NOT_COLOURS.has(name) || TRANSPARENT.has(name)) continue;
    if (RAW_COLOURS.has(name) && MAY_USE_RAW_COLOURS.has(file)) continue;
    unknown.add(name);
  }
  return [...unknown];
}

const sources = (readdirSync(srcRoot, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."));

describe("colour classes", () => {
  it("name a registered token everywhere in the application", () => {
    const offending = sources.flatMap((file) => unknownColourClasses(readFileSync(join(srcRoot, file), "utf8"), file).map((name) => `${file}: ${name}`));
    expect(offending).toEqual([]);
  });

  it.each([
    ["a JSX attribute", `<p className="text-invented" />`],
    ["a template literal", "const a = `flex hover:text-invented p-2`;"],
    ["a variant and an opacity", `const a = "dark:text-invented/50";`],
    ["a decimal opacity", `const a = "text-invented/12.5";`],
    ["an arbitrary opacity", `const a = "text-invented/[0.5]";`],
    ["important, in front and behind", `const a = "!text-invented"; const b = "text-invented!";`],
    ["single quotes", `const a = 'text-invented';`],
    ["a ternary inside a template", "<p className={`p-2 ${on ? \"text-invented\" : \"text-muted\"}`} />"],
    ["a multi-line attribute", `<p className="p-2\n  text-invented\n  m-2" />`],
    ["after a string that looks like a comment", `<input accept="image/*" /><p className="text-invented" />`],
    ["after a trailing comment with a backtick", "const b = 1; // uses `foo\nconst a = \"text-invented\";"],
  ])("are found in %s", (_name, source) => {
    expect(unknownColourClasses(source)).toEqual(["text-invented"]);
  });

  it("find a raw arbitrary colour, and leave an arbitrary size alone", () => {
    expect(unknownColourClasses(`<p className="bg-[#123456] text-[red] text-[0.9rem]" />`)).toEqual(["bg-[#123456]", "text-[red]"]);
  });

  it("leave registered tokens and listed utilities alone", () => {
    expect(unknownColourClasses(`<p className="text-muted bg-surface border-border-strong text-sm border-t bg-transparent" />`)).toEqual([]);
  });

  it("allow a raw colour only in the documented photographic treatments", () => {
    expect(unknownColourClasses(`<p className="bg-black text-white" />`, "components/hero-overlay.tsx")).toEqual([]);
    expect(unknownColourClasses(`<p className="bg-black text-white" />`, "components/new-card.tsx")).toEqual(["bg-black", "text-white"]);
  });

  it("read their tokens from @theme", () => {
    expect(themeStart).toBeGreaterThan(-1);
    expect(TOKENS).toContain("muted");
    expect(TOKENS).toContain("border-strong");
  });

  it("flag copy that looks like a class, which has to be reworded or listed", () => {
    expect(unknownColourClasses(`const a = "A text-based border-crossing story";`)).toEqual(["text-based", "border-crossing"]);
  });
});

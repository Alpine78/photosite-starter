import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tailwind silently generates nothing for a class it does not know, so a misspelt or invented colour
 * token renders as whatever it inherits, and neither the build nor a role-based journey test notices.
 * This reads every source string for colour utilities and requires each to name a token in
 * `globals.css`, or to be on one of the two closed lists below.
 */

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(srcRoot, "app/globals.css"), "utf8");
const TOKENS = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]));

/** Tailwind utilities that share a colour utility's prefix but are not colours. */
const NOT_COLOURS = new Set([
  "bg-linear-to-b", "bg-linear-to-t",
  "border-b", "border-b-0", "border-b-2", "border-collapse", "border-l", "border-l-2", "border-l-4", "border-t", "border-y",
  "outline-none", "outline-offset-2", "outline-offset-4",
  "text-base", "text-center", "text-inherit", "text-left", "text-lg", "text-right", "text-sm", "text-xl", "text-xs",
]);
/** The documented photographic treatments and transparency (`docs/theme-contract.md`). */
const NOT_TOKENS = new Set(["bg-black", "bg-transparent", "bg-white", "border-transparent", "outline-white", "text-black", "text-white"]);

const UTILITY = /(?:^|[\s:!])((?:bg|text|border|ring|outline|divide|fill|stroke|placeholder|decoration|accent|caret)-([a-z][a-z0-9-]*))(?:\/\d+)?(?=$|\s)/g;

function unknownColourClasses(source: string): readonly string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const unknown = new Set<string>();
  for (const literal of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    for (const match of (literal[1] ?? literal[2] ?? "").matchAll(UTILITY)) {
      if (!TOKENS.has(match[2]) && !NOT_COLOURS.has(match[1]) && !NOT_TOKENS.has(match[1])) unknown.add(match[1]);
    }
  }
  return [...unknown];
}

const sources = (readdirSync(srcRoot, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."));

describe("colour classes", () => {
  it("name a registered token everywhere in the application", () => {
    const offending = sources.flatMap((file) => unknownColourClasses(readFileSync(join(srcRoot, file), "utf8")).map((name) => `${file}: ${name}`));
    expect(offending).toEqual([]);
  });

  it("are recognized in every form a component writes them", () => {
    expect(unknownColourClasses(`<p className="text-invented" />`)).toEqual(["text-invented"]);
    expect(unknownColourClasses("const a = `flex hover:bg-invented p-2`;")).toEqual(["bg-invented"]);
    expect(unknownColourClasses(`const a = "dark:border-invented/50";`)).toEqual(["border-invented"]);
  });

  it("leave registered tokens, listed utilities and prose alone", () => {
    expect(unknownColourClasses(`<p className="text-muted bg-surface border-border-strong text-sm border-t bg-black" />`)).toEqual([]);
    expect(unknownColourClasses(`// "text-invented"\nconst a = "accented text-heavy-handed words";`)).toEqual(["text-heavy-handed"]);
  });
});

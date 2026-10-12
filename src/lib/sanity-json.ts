/** Opt-in validation for an already byte-bounded UTF-8 Sanity response (AB#263). */
import "server-only";

export const MAX_STRICT_SANITY_JSON_DEPTH = 64;
export const MAX_STRICT_SANITY_JSON_NODES = 100_000;
const MAX_TEXT_LENGTH = 1024 * 1024;

function invalid(): never {
  throw new TypeError("Invalid bounded content JSON");
}

/**
 * Scan decoded keys before native parsing can discard duplicates. Values,
 * including containers, count as nodes; keys don't. Nesting is bounded before
 * recursion. Numeric semantics stay native; no general parser/model is added.
 */
export function parseSanityJsonWithoutDuplicates(source: string): unknown {
  if (typeof source !== "string" || source.length > MAX_TEXT_LENGTH) invalid();
  let offset = 0;
  let nodes = 0;
  const space = () => {
    while (offset < source.length && /[ \t\r\n]/.test(source[offset])) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const c = source[offset++];
      if (c === "\\") offset++;
      else if (c === '"') {
        try { return JSON.parse(source.slice(start, offset)) as string; }
        catch { invalid(); }
      }
    }
    invalid();
  };
  const value = (depth: number): void => {
    if (depth > MAX_STRICT_SANITY_JSON_DEPTH || ++nodes > MAX_STRICT_SANITY_JSON_NODES) invalid();
    space();
    const c = source[offset];
    if (c === '"') { string(); return; }
    if (c === "{" || c === "[") {
      offset++;
      const end = c === "{" ? "}" : "]";
      const keys = new Set<string>();
      space();
      if (source[offset] === end) { offset++; return; }
      for (;;) {
        if (c === "{") {
          space();
          if (source[offset] !== '"') invalid();
          const key = string();
          if (keys.has(key)) invalid();
          keys.add(key);
          space();
          if (source[offset++] !== ":") invalid();
        }
        value(depth + 1);
        space();
        const separator = source[offset++];
        if (separator === end) return;
        if (separator !== ",") invalid();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset))?.[0];
    if (!token) invalid();
    offset += token.length;
  };
  try {
    value(0);
    space();
    if (offset !== source.length) invalid();
    return JSON.parse(source);
  } catch {
    // Native syntax errors can echo the response; retain no message or cause.
    return invalid();
  }
}

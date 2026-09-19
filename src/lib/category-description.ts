/**
 * The short, localized editorial introduction of one public category.
 *
 * A category owns neither a second heading nor a media sequence: the route
 * already renders its label as the sole h1. The description is consequently
 * restricted to paragraphs and lists with modest inline structure. This keeps
 * category landing pages useful without creating a second content-page model.
 */

export type CategoryDescriptionInlineMark = "emphasis";

export type CategoryDescriptionInlineSpan = {
  readonly text: string;
  readonly marks?: readonly CategoryDescriptionInlineMark[];
  /** A root-relative path or an absolute http(s) URL. */
  readonly href?: string;
};

export type CategoryDescriptionParagraph = {
  readonly type: "paragraph";
  readonly spans: readonly CategoryDescriptionInlineSpan[];
  readonly key?: string;
};

export type CategoryDescriptionList = {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly {
    readonly spans: readonly CategoryDescriptionInlineSpan[];
    readonly key?: string;
  }[];
  readonly key?: string;
};

export type CategoryDescriptionBlock =
  | CategoryDescriptionParagraph
  | CategoryDescriptionList;

export const MAX_CATEGORY_DESCRIPTION_BLOCKS = 6;
export const MAX_CATEGORY_DESCRIPTION_SPANS = 20;
export const MAX_CATEGORY_DESCRIPTION_LIST_ITEMS = 20;
export const MAX_CATEGORY_DESCRIPTION_SPAN_TEXT_LENGTH = 300;

export const CATEGORY_DESCRIPTION_INTERNAL_LINK_PATH =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

function assertText(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_CATEGORY_DESCRIPTION_SPAN_TEXT_LENGTH
  ) {
    throw new TypeError(
      `${field} must be non-empty and at most ${MAX_CATEGORY_DESCRIPTION_SPAN_TEXT_LENGTH} characters`,
    );
  }
}

function assertHref(href: string): void {
  if (CATEGORY_DESCRIPTION_INTERNAL_LINK_PATH.test(href)) return;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") return;
  } catch {
    // Fall through to the shared error below.
  }
  throw new TypeError(
    `Category description link href must be http(s) or root-relative: ${href}`,
  );
}

function assertSpans(
  spans: readonly CategoryDescriptionInlineSpan[],
  field: string,
): void {
  if (!Array.isArray(spans) || spans.length === 0 || spans.length > MAX_CATEGORY_DESCRIPTION_SPANS) {
    throw new TypeError(
      `${field} must have between 1 and ${MAX_CATEGORY_DESCRIPTION_SPANS} spans`,
    );
  }
  for (const span of spans) {
    assertText(span.text, `${field} span text`);
    if (span.marks !== undefined) {
      const marks: unknown = span.marks;
      if (
        !Array.isArray(marks) ||
        new Set(marks).size !== marks.length ||
        marks.some((mark: unknown) => mark !== "emphasis")
      ) {
        throw new TypeError("Category description has an unknown or duplicate inline mark");
      }
    }
    if (span.href !== undefined) {
      if (typeof span.href !== "string") {
        throw new TypeError("Category description link href must be a string");
      }
      assertHref(span.href);
    }
  }
}

/** Defends the public renderer against malformed CMS or import data. */
export function assertCategoryDescriptionBlocks(
  blocks: readonly CategoryDescriptionBlock[],
): void {
  if (
    !Array.isArray(blocks) ||
    blocks.length === 0 ||
    blocks.length > MAX_CATEGORY_DESCRIPTION_BLOCKS
  ) {
    throw new TypeError(
      `Category description must have between 1 and ${MAX_CATEGORY_DESCRIPTION_BLOCKS} blocks`,
    );
  }
  for (const block of blocks) {
    if (block.type === "paragraph") {
      assertSpans(block.spans, "Category description paragraph");
      continue;
    }
    if (block.type === "list") {
      if (typeof block.ordered !== "boolean") {
        throw new TypeError("Category description list.ordered must be a boolean");
      }
      if (
        !Array.isArray(block.items) ||
        block.items.length === 0 ||
        block.items.length > MAX_CATEGORY_DESCRIPTION_LIST_ITEMS
      ) {
        throw new TypeError(
          `Category description list must have between 1 and ${MAX_CATEGORY_DESCRIPTION_LIST_ITEMS} items`,
        );
      }
      for (const item of block.items) {
        assertSpans(item.spans, "Category description list item");
      }
      continue;
    }
    throw new TypeError(
      `Category description block kind is not allowed: ${(block as { type?: unknown }).type}`,
    );
  }
}

/** Bounded text runs for paragraph/list links. No HTML or provider fields escape. */
export type ContentInlineSpan = { readonly text: string; readonly href?: string };
export const MAX_CONTENT_INLINE_SPANS = 100;
export const MAX_CONTENT_INLINE_TEXT = 10000;
export const MAX_CONTENT_INLINE_HREF = 2048;
export const MAX_CONTENT_RICH_ITEMS = 100;

export function isContentInlineHref(value: unknown): value is string {
  if (
    typeof value !== "string" || !value.length || value.length > MAX_CONTENT_INLINE_HREF ||
    /[\s\u0000-\u001f\u007f\\]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)
  ) return false;
  if (/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !/^\/%(?:2f|5c)/i.test(value)) return true;
  if (!/^https?:\/\//.test(value)) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function readContentInlineSpans(value: unknown): ContentInlineSpan[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CONTENT_INLINE_SPANS) {
    throw new TypeError("Invalid inline span count");
  }
  const spans = value.map((span: unknown) => {
    if (!span || typeof span !== "object" || Array.isArray(span)) throw new TypeError("Invalid inline span");
    const row = span as Record<string, unknown>;
    if (
      Object.keys(row).some(key => !["_key", "_type", "text", "href"].includes(key)) ||
      (row._type != null && row._type !== "contentInlineSpan") ||
      typeof row.text !== "string" || !row.text.length || row.text.length > MAX_CONTENT_INLINE_TEXT ||
      (row.href != null && (!isContentInlineHref(row.href) || !row.text.trim()))
    ) throw new TypeError("Invalid inline text or link");
    return { text: row.text, ...(row.href == null ? {} : { href: row.href as string }) };
  });
  const text = spans.map(span => span.text).join("");
  if (!text.trim() || text.length > MAX_CONTENT_INLINE_TEXT) throw new TypeError("Invalid inline text length");
  return spans;
}

export function readContentRichItems(value: unknown): ContentInlineSpan[][] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CONTENT_RICH_ITEMS) {
    throw new TypeError("Invalid rich list count");
  }
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("Invalid rich list item");
    const row = item as Record<string, unknown>;
    if (
      Object.keys(row).some(key => !["_key", "_type", "spans"].includes(key)) ||
      (row._type != null && row._type !== "contentRichListItem")
    ) throw new TypeError("Invalid rich list fields");
    return readContentInlineSpans(row.spans);
  });
}

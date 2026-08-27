import { serializeJsonLd, type JsonLdValue } from "@/lib/structured-data";

type JsonLdProps = Readonly<{
  /** One JSON-LD entity, or several to emit as separate blocks. */
  data: JsonLdValue | readonly JsonLdValue[];
}>;

/**
 * Renders one or more `<script type="application/ld+json">` blocks.
 *
 * A native `<script>` is the right tool for JSON-LD — it is data, not code, so
 * `next/script` (built for loading executable JS) does not apply. Every block
 * goes through `serializeJsonLd`, never a bare `JSON.stringify`, so an authored
 * string containing `</script>` cannot terminate it. Several entities render as
 * several blocks rather than one `@graph`: the site's entities are not linked,
 * and search engines accept multiple blocks per page.
 */
export function JsonLd({ data }: JsonLdProps) {
  const blocks = Array.isArray(data)
    ? (data as readonly JsonLdValue[])
    : [data as JsonLdValue];

  return (
    <>
      {blocks.map((block, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(block) }}
        />
      ))}
    </>
  );
}

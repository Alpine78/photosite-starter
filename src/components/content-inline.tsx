import type { ContentInlineSpan } from "@/lib/content-inline";

/** Native links work without hydration and never prefetch third-party content. */
export function ContentInline({ spans }: { readonly spans: readonly ContentInlineSpan[] }) {
  return <>{spans.map((span, index) => span.href === undefined ? span.text : (
    <a key={index} href={span.href} rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
      {span.text}
    </a>
  ))}</>;
}

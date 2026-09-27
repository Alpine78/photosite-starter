import type { BuiltInLabels } from "@/lib/deployment-config";
import type {
  GallerySection,
  GallerySectionInlineSpan,
  GallerySectionIntroBlock,
} from "@/lib/gallery-sections";

type GallerySectionIntroProps = {
  readonly label: string;
  readonly intro?: GallerySection["intro"];
  readonly photoCount?: number;
  readonly locale: string;
  readonly labels: BuiltInLabels;
};

function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}

function InlineSpan({ span }: { readonly span: GallerySectionInlineSpan }) {
  const content = span.marks?.includes("emphasis") ? (
    <em>{span.text}</em>
  ) : (
    span.text
  );

  if (span.href === undefined) return <>{content}</>;

  return (
    <a
      href={span.href}
      className="underline underline-offset-4 transition-colors hover:text-foreground"
      {...(isExternalHref(span.href)
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {content}
    </a>
  );
}

function IntroBlock({
  block,
  index,
}: {
  readonly block: GallerySectionIntroBlock;
  readonly index: number;
}) {
  if (block.type === "paragraph") {
    return (
      <p key={block.key ?? index} className="text-body">
        {block.spans.map((span, spanIndex) => (
          <InlineSpan key={spanIndex} span={span} />
        ))}
      </p>
    );
  }

  const ListTag = block.ordered ? "ol" : "ul";
  return (
    <ListTag
      key={block.key ?? index}
      className={`text-body ${
        block.ordered ? "list-decimal" : "list-disc"
      } ml-5 space-y-1`}
    >
      {block.items.map((item, itemIndex) => (
        <li key={item.key ?? itemIndex}>
          {item.spans.map((span, spanIndex) => (
            <InlineSpan key={spanIndex} span={span} />
          ))}
        </li>
      ))}
    </ListTag>
  );
}

/**
 * The active gallery filter's heading and public photograph count on its
 * first slice. A named section may also supply its authored short intro.
 * Continuation slices omit this editorial framing (ADR-0003 decision 3).
 * Intro blocks have already been validated by the section boundary.
 */
export function GallerySectionIntro({
  label,
  intro,
  photoCount,
  locale,
  labels,
}: GallerySectionIntroProps) {
  return (
    <div className="mt-6 max-w-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{label}</h2>
        {photoCount !== undefined && (
          <p className="text-sm text-muted">
            {new Intl.NumberFormat(locale).format(photoCount)}{" "}
            {photoCount === 1 ? labels.gallery.photoSingular : labels.gallery.photoPlural}
          </p>
        )}
      </div>
      {intro !== undefined && (
        <div className="mt-3 space-y-3 text-base leading-7">
          {intro.map((block, index) => (
            <IntroBlock key={block.key ?? index} block={block} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

import type {
  GallerySection,
  GallerySectionInlineSpan,
  GallerySectionIntroBlock,
} from "@/lib/gallery-sections";

type GallerySectionIntroProps = {
  /** The active named section, resolved server-side on its first, uncursored slice. */
  readonly section: GallerySection;
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
 * A named gallery section's own heading and optional short introduction.
 *
 * ADR-0003 decision 3: the first page of a selected section renders its
 * authored label as a level-2 heading, whether or not it carries an
 * introduction — so the heading here is unconditional on `section` being
 * supplied at all, and only the blocks beneath it are conditional on
 * `section.intro`. The caller (`ContentGallery`) renders this component only
 * on the first, uncursored slice of a named section — the one state
 * `result.selectedSection` marks — so no continuation or `All` view repeats
 * it.
 *
 * The block set is deliberately narrow — paragraphs and lists only, already
 * validated server-side by `assertGallerySectionIntroBlocks` — so this is a
 * pure renderer with no re-validation of its own.
 */
export function GallerySectionIntro({ section }: GallerySectionIntroProps) {
  return (
    <div className="mt-6 max-w-2xl">
      <h2 className="text-xl font-semibold tracking-tight">
        {section.label}
      </h2>
      {section.intro !== undefined && (
        <div className="mt-3 space-y-3 text-base leading-7">
          {section.intro.map((block, index) => (
            <IntroBlock key={block.key ?? index} block={block} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

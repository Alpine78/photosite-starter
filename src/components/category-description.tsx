import type {
  CategoryDescriptionBlock,
  CategoryDescriptionInlineSpan,
} from "@/lib/category-description";

type CategoryDescriptionProps = {
  readonly blocks: readonly CategoryDescriptionBlock[];
};

function InlineSpan({ span }: { readonly span: CategoryDescriptionInlineSpan }) {
  const text = span.marks?.includes("emphasis") ? <em>{span.text}</em> : span.text;
  if (span.href === undefined) return <>{text}</>;

  const external = span.href.startsWith("http://") || span.href.startsWith("https://");
  return (
    <a
      href={span.href}
      className="underline underline-offset-4 transition-colors hover:text-foreground"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {text}
    </a>
  );
}

/** Category introduction beneath the page's sole h1. */
export function CategoryDescription({ blocks }: CategoryDescriptionProps) {
  return (
    <div className="mt-4 max-w-2xl space-y-3 text-base leading-7 text-body">
      {blocks.map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <p key={block.key ?? index}>
              {block.spans.map((span, spanIndex) => (
                <InlineSpan key={spanIndex} span={span} />
              ))}
            </p>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List
            key={block.key ?? index}
            className={`${block.ordered ? "list-decimal" : "list-disc"} ml-5 space-y-1`}
          >
            {block.items.map((item, itemIndex) => (
              <li key={item.key ?? itemIndex}>
                {item.spans.map((span, spanIndex) => (
                  <InlineSpan key={spanIndex} span={span} />
                ))}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

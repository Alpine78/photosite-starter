import { MediaFigure } from "@/components/media-figure";
import { buildHeadingIds } from "@/lib/content-headings";
import type { ContentBlock } from "@/lib/content-page";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import { YoutubeEmbed } from "@/components/youtube-embed";

type ContentBodyProps = {
  blocks: readonly ContentBlock[];
  /**
   * The page's own locale labels. Passed in rather than read from the
   * deployment default: a body renders inside every configured locale route
   * space, and a prefixed locale's page must not caption its video in another
   * language.
   */
  labels: BuiltInLabels;
};

/**
 * Renders the shared body-block set ADR-0003 decision 2 gives both content
 * variants. Each block maps to one semantic HTML element or component, and the
 * page title owns the single `h1`, so an authored heading starts at level 2.
 *
 * A media block here is a content placement, never a gallery item: it does not
 * enter a gallery's grid, lightbox sequence, sections, or pagination.
 *
 * Level-2 headings carry the ids the derived table of contents links to. Both
 * sides read them from `buildHeadingIds`, so the fragment a link writes and the
 * anchor a heading renders cannot drift apart.
 */
export function ContentBody({ blocks, labels }: ContentBodyProps) {
  const headingIds = buildHeadingIds(blocks);

  return (
    <div className="space-y-6">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={block.key ?? index} className="leading-7 text-foreground/80">
                {block.text}
              </p>
            );

          case "heading":
            if (block.level === 2) {
              return (
                <h2
                  key={block.key ?? index}
                  id={headingIds.get(index)}
                  // Anchored headings are jump targets, so they keep clear of a
                  // future sticky header rather than landing under it.
                  className="mt-10 scroll-mt-24 text-2xl font-semibold tracking-tight first:mt-0"
                >
                  {block.text}
                </h2>
              );
            }
            return (
              <h3
                key={block.key ?? index}
                className="mt-6 text-xl font-medium tracking-tight"
              >
                {block.text}
              </h3>
            );

          case "blockquote":
            return (
              <blockquote
                key={block.key ?? index}
                className="border-l-4 border-black/20 pl-4 italic text-foreground/70 dark:border-white/25"
              >
                <p>{block.text}</p>
                {block.attribution && (
                  <footer className="mt-1 text-sm not-italic text-foreground/70">
                    — {block.attribution}
                  </footer>
                )}
              </blockquote>
            );

          case "media":
            // A video placement is modelled but not yet playable anywhere on
            // the site, so it renders nothing rather than a control that leads
            // nowhere or a placeholder claiming a feature. Video delivery is a
            // roadmap item; the same omission is why a video cover falls back
            // to the deployment's default Open Graph image.
            if (block.media.type !== "image") return null;
            return (
              <MediaFigure
                key={block.key ?? index}
                image={block.media}
                sizes={imageRenderProfiles.articleContent.sizes}
              />
            );

          case "list":
            if (block.ordered) {
              return (
                <ol
                  key={block.key ?? index}
                  className="list-decimal space-y-1 pl-6 text-foreground/80"
                >
                  {block.items.map((item, i) => (
                    <li key={i} className="leading-7">
                      {item}
                    </li>
                  ))}
                </ol>
              );
            }
            return (
              <ul
                key={block.key ?? index}
                className="list-disc space-y-1 pl-6 text-foreground/80"
              >
                {block.items.map((item, i) => (
                  <li key={i} className="leading-7">
                    {item}
                  </li>
                ))}
              </ul>
            );

          case "youtube":
            return (
              <YoutubeEmbed
                key={block.key ?? index}
                videoId={block.videoId}
                title={block.title}
                labels={labels.media}
                watchLabel={labels.actions.watchOnYouTube}
              />
            );
        }
      })}
    </div>
  );
}

import Image from "next/image";
import type { ContentBlock } from "@/lib/articles";
import { builtInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import { YoutubeEmbed } from "@/components/youtube-embed";

type ArticleBodyProps = {
  blocks: ContentBlock[];
};

/**
 * Renders a typed content block list. Each block maps to one semantic HTML
 * element or component. New block types are added here and in the Article
 * type — nothing else needs to change.
 */
export function ArticleBody({ blocks }: ArticleBodyProps) {
  return (
    <div className="space-y-6">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={index} className="leading-7 text-foreground/80">
                {block.text}
              </p>
            );

          case "heading":
            if (block.level === 2) {
              return (
                <h2
                  key={index}
                  className="mt-10 text-2xl font-semibold tracking-tight first:mt-0"
                >
                  {block.text}
                </h2>
              );
            }
            return (
              <h3
                key={index}
                className="mt-6 text-xl font-medium tracking-tight"
              >
                {block.text}
              </h3>
            );

          case "blockquote":
            return (
              <blockquote
                key={index}
                className="border-l-4 border-black/20 pl-4 italic text-foreground/70 dark:border-white/25"
              >
                <p>{block.text}</p>
                {block.attribution && (
                  <footer className="mt-1 text-sm not-italic text-foreground/50">
                    — {block.attribution}
                  </footer>
                )}
              </blockquote>
            );

          case "media":
            if (block.media.type !== "image") return null;
            return (
              <figure key={index}>
                <Image
                  src={block.media.rendition.src}
                  alt={block.media.alt}
                  width={block.media.rendition.width}
                  height={block.media.rendition.height}
                  sizes={imageRenderProfiles.articleContent.sizes}
                  className="h-auto w-full rounded-lg"
                />
                {(block.media.caption || block.media.credit) && (
                  <figcaption className="mt-2 text-sm text-foreground/60">
                    {block.media.caption}
                    {block.media.caption && block.media.credit && " — "}
                    {block.media.credit}
                  </figcaption>
                )}
              </figure>
            );

          case "list":
            if (block.ordered) {
              return (
                <ol
                  key={index}
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
                key={index}
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
                key={index}
                videoId={block.videoId}
                title={block.title}
                labels={builtInLabels.media}
                watchLabel={builtInLabels.actions.watchOnYouTube}
              />
            );
        }
      })}
    </div>
  );
}

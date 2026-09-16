import { miniGalleryNames } from "@/lib/content-mini-gallery";
import { ContentMiniGallery } from "@/components/content-mini-gallery";
import { ContentBodyFigure } from "@/components/content-body-figure";
import { GalleryLightbox } from "@/components/gallery-lightbox";
import { buildContentBodyLightboxSlides } from "@/lib/content-body-lightbox-server";
import { indexContentBodyImages } from "@/lib/content-body-media";
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
  /**
   * Browser source-size hint for a body media block, matching whatever column
   * width the caller actually renders this body in — the article variant's own
   * `<main>` and the gallery variant's narrower wrapper inside its wider page
   * are not the same box, so this cannot be a single hardcoded default for
   * every caller. Defaults to `contentBody`, tuned for the article's `<main>`.
   */
  sizes?: string;
  miniGallerySizes?: string;
};

/**
 * Renders the shared body-block set ADR-0003 decision 2 gives both content
 * variants. Each block maps to one semantic HTML element or component, and the
 * page title owns the single `h1`, so an authored heading starts at level 2.
 *
 * A media block here is a content placement, never a gallery item: on a gallery
 * variant page it does not enter the curated grid, its sections, or its
 * pagination, and its lightbox sequence is its own — a separate provider
 * instance mounted here, ordered by the body's own image blocks and nothing
 * else. An image placement opens that fullscreen viewer once its script has
 * run (`ContentBodyFigure`); a video placement still renders nothing and never
 * becomes a slide.
 *
 * Every heading (h2, h3, h4) carries the id the derived table of contents
 * links to. Both sides read them from `buildHeadingIds`, so the fragment a
 * link writes and the anchor a heading renders cannot drift apart.
 */
export function ContentBody({
  blocks,
  labels,
  sizes = imageRenderProfiles.contentBody.sizes,
  miniGallerySizes = imageRenderProfiles.contentMiniGallery.sizes,
}: ContentBodyProps) {
  const galleryNames = miniGalleryNames(blocks, labels.miniGallery.label);
  const headingIds = buildHeadingIds(blocks);
  const bodyImages = indexContentBodyImages(blocks);
  const slides = buildContentBodyLightboxSlides(blocks);

  const body = (
    <div className="space-y-6">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "mini-gallery":
            return (
              <ContentMiniGallery
                key={block.key ?? index}
                block={block}
                labels={labels}
                name={galleryNames.get(index)!}
                sizes={miniGallerySizes}
              />
            );
          case "paragraph":
            return (
              <p key={block.key ?? index} className="leading-7 text-body">
                {block.text}
              </p>
            );

          case "heading": {
            // Every level is a jump target (AB#21), so every level keeps
            // clear of a future sticky header rather than landing under it.
            const id = headingIds.get(index);
            if (block.level === 2) {
              return (
                <h2
                  key={block.key ?? index}
                  id={id}
                  className="mt-10 scroll-mt-24 text-2xl font-semibold tracking-tight first:mt-0"
                >
                  {block.text}
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3
                  key={block.key ?? index}
                  id={id}
                  className="mt-6 scroll-mt-24 text-xl font-medium tracking-tight"
                >
                  {block.text}
                </h3>
              );
            }
            return (
              <h4
                key={block.key ?? index}
                id={id}
                className="mt-4 scroll-mt-24 text-lg font-medium tracking-tight"
              >
                {block.text}
              </h4>
            );
          }

          case "blockquote":
            return (
              <blockquote
                key={block.key ?? index}
                className="border-l-4 border-border-control pl-4 italic text-muted"
              >
                <p>{block.text}</p>
                {block.attribution && (
                  <footer className="mt-1 text-sm not-italic text-muted">
                    — {block.attribution}
                  </footer>
                )}
              </blockquote>
            );

          case "media": {
            // A video placement is modelled but not yet playable anywhere on
            // the site, so it renders nothing rather than a control that leads
            // nowhere or a placeholder claiming a feature. Video delivery is a
            // roadmap item; the same omission is why a video cover falls back
            // to the deployment's default Open Graph image.
            if (block.media.type !== "image") return null;
            const bodyImage = bodyImages.get(index);
            // Unreachable: `bodyImages` is derived from these same blocks with
            // the same image predicate. The guard keeps the type honest.
            if (bodyImage === undefined) return null;
            return (
              <ContentBodyFigure
                key={block.key ?? index}
                image={block.media}
                sizes={sizes}
                index={bodyImage.index}
                itemId={bodyImage.itemId}
                openLabel={labels.lightbox.openImage}
              />
            );
          }

          case "list":
            if (block.ordered) {
              return (
                <ol
                  key={block.key ?? index}
                  className="list-decimal space-y-1 pl-6 text-body"
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
                className="list-disc space-y-1 pl-6 text-body"
              >
                {block.items.map((item, i) => (
                  <li key={i} className="leading-7">
                    {item}
                  </li>
                ))}
              </ul>
            );

          case "table":
            return (
              // The scroll container is the accessible element, not the table:
              // a wide comparison table has to be reachable by keyboard alone,
              // and a scrollable box is only keyboard-scrollable once it can
              // hold focus. `tabIndex` is unconditional rather than applied by
              // script once the table actually overflows, so the keyboard path
              // survives with JavaScript off — the cost is one tab stop on a
              // table narrow enough not to need it.
              //
              // Named with `aria-label` rather than `aria-labelledby` pointing
              // at the caption: the name is the same either way, and this needs
              // no generated id, so two tables sharing a caption cannot collide
              // with each other or with a heading's own anchor namespace.
              // `<caption>` still names the table itself natively.
              <div
                key={block.key ?? index}
                role="region"
                aria-label={block.caption ?? labels.table.label}
                tabIndex={0}
                className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <table className="w-full border-collapse text-left text-sm">
                  {block.caption !== undefined && (
                    <caption className="mb-2 text-left text-sm text-muted">
                      {block.caption}
                    </caption>
                  )}
                  <thead>
                    <tr>
                      {block.headers.map((header, column) => (
                        <th
                          key={column}
                          scope="col"
                          className="border-b border-border-strong px-3 py-2 font-semibold whitespace-nowrap text-foreground"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, column) => (
                          <td
                            key={column}
                            className="border-b border-border-control px-3 py-2 align-top text-body"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

  // No image placements: no viewer, no trigger context, nothing to hydrate.
  if (slides.length === 0) return body;

  // The body's own lightbox sequence. A gallery variant page also mounts a
  // second, entirely separate `GalleryLightbox` for its curated grid; the two
  // share no context and no slide list. No `enquiryBasePath` — a body
  // photograph is not a curated placement (AB#60), so it shows no enquiry
  // control — and no `continuation`, because a body sequence is bounded.
  return (
    <GalleryLightbox slides={slides} labels={labels.lightbox}>
      {body}
    </GalleryLightbox>
  );
}

import Image from "next/image";
import Link from "next/link";
import { formatDate } from "@/lib/date-format";
import { imageRenderProfiles } from "@/lib/image-delivery";
import type { ImageMedia } from "@/lib/media";

export type StoryCardEntry = {
  readonly contentId: string;
  readonly title: string;
  readonly summary?: string;
  /**
   * ISO 8601 date: the page's effective event date (`eventDate ?? publishedAt`,
   * AB#150, ADR-0017) — never the raw `publishedAt`.
   */
  readonly eventDate: string;
  readonly author: string;
  readonly cover?: ImageMedia;
  /** The one canonical detail route, whichever listing the card appears in. */
  readonly href: string;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * One story card, shared by the story listings and the home page's latest
 * stories so the two never drift apart.
 *
 * The cover renders at its native ratio — `h-auto w-full` over the rendition's
 * true intrinsic dimensions — so a card never crops the photograph it presents;
 * the design proposal's fixed 3:2 crop is deliberately not reproduced (AB#173).
 * The summary is clamped to three lines on the card only. A page with no cover
 * renders as a text card rather than borrowing an image. The title is an `h3`:
 * every place a card appears sits under an `h2` section heading.
 */
export function StoryCard({
  entry,
  locale,
}: {
  readonly entry: StoryCardEntry;
  readonly locale: string;
}) {
  return (
    <Link href={entry.href} className={`group flex h-full flex-col gap-4 ${focusRing}`}>
      {entry.cover && (
        <Image
          src={entry.cover.rendition.src}
          alt={entry.cover.alt}
          width={entry.cover.rendition.width}
          height={entry.cover.rendition.height}
          sizes={imageRenderProfiles.contentListingGrid.sizes}
          className="h-auto w-full rounded-sm bg-surface-muted"
        />
      )}
      <div className="flex flex-1 flex-col">
        <h3 className="text-xl font-semibold leading-snug tracking-tight transition-colors group-hover:text-link-hover sm:text-2xl">
          {entry.title}
        </h3>
        {entry.summary && (
          <p className="mt-2 line-clamp-3 max-w-prose text-base leading-relaxed text-muted sm:text-lg">
            {entry.summary}
          </p>
        )}
        <p className="mt-3 text-sm text-muted">
          <span>{entry.author}</span>
          <span className="mx-1.5">·</span>
          <time dateTime={entry.eventDate}>{formatDate(entry.eventDate, locale)}</time>
        </p>
      </div>
    </Link>
  );
}

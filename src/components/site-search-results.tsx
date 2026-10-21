import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";

import { formatDate } from "@/lib/date-format";
import { imageRenderProfiles } from "@/lib/image-delivery";
import { narrowSearchText, type SiteSearchLabels } from "@/lib/site-search-copy";
import { highlightSegments } from "@/lib/site-search-query";
import type {
  SiteSearchGroup,
  SiteSearchHit,
  SiteSearchResponse,
} from "@/lib/site-search-types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Text with the query's words highlighted. The segments are strings rendered as
 * text nodes inside `<mark>`, never markup, so a title containing `<b>` or a
 * query containing `<script>` is shown as the characters it is.
 */
function Highlighted({
  text,
  tokens,
}: {
  readonly text: string;
  readonly tokens: readonly string[];
}) {
  return (
    <>
      {highlightSegments(text, tokens).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="bg-transparent font-bold text-inherit">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The thumbnail slot: a fixed box in which the image keeps its native ratio and
 * is shown whole (`object-contain`), never cropped. A hit with no cover shows an
 * empty muted box of the same size so the rows stay aligned.
 */
function Thumbnail({ hit }: { readonly hit: SiteSearchHit }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-muted"
    >
      {hit.thumbnail !== undefined && (
        <Image
          src={hit.thumbnail.src}
          alt=""
          width={hit.thumbnail.width}
          height={hit.thumbnail.height}
          sizes={imageRenderProfiles.searchResultThumbnail.sizes}
          className="h-full w-full object-contain"
        />
      )}
    </span>
  );
}

function Row({
  hit,
  tokens,
  locale,
  kindLabel,
  showSummary,
}: {
  readonly hit: SiteSearchHit;
  readonly tokens: readonly string[];
  readonly locale: string;
  readonly kindLabel: string;
  readonly showSummary: boolean;
}) {
  return (
    <li>
      <Link
        href={hit.href}
        // Never prefetched. A prefetch is a request the visitor did not make:
        // in the dialog it would announce to the host which pages a half-typed
        // query matches, which is the query told by inference (ADR-0033 §5).
        prefetch={false}
        className={`group flex items-center gap-4 border-b border-border py-3 ${focusRing}`}
      >
        <Thumbnail hit={hit} />
        <span className="min-w-0">
          <span className="block text-lg font-medium leading-snug group-hover:underline group-hover:underline-offset-4 group-focus-visible:underline group-focus-visible:underline-offset-4">
            <Highlighted text={hit.title} tokens={tokens} />
          </span>
          <span className="block text-sm text-muted">
            {kindLabel}
            {hit.eventDate !== undefined && (
              <>
                <span aria-hidden="true"> · </span>
                <time dateTime={hit.eventDate}>{formatDate(hit.eventDate, locale)}</time>
              </>
            )}
          </span>
          {showSummary && hit.summary !== undefined && (
            <span className="mt-1 line-clamp-2 block text-sm text-body">
              <Highlighted text={hit.summary} tokens={tokens} />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function Group({
  idPrefix,
  heading,
  group,
  tokens,
  locale,
  kindLabel,
  labels,
  showSummary,
  showCapNotice,
}: {
  readonly idPrefix: string;
  readonly heading: string;
  readonly group: SiteSearchGroup;
  readonly tokens: readonly string[];
  readonly locale: string;
  readonly kindLabel: string;
  readonly labels: SiteSearchLabels;
  readonly showSummary: boolean;
  readonly showCapNotice: boolean;
}) {
  if (group.hits.length === 0) return null;
  const headingId = `${idPrefix}-heading`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-sm font-semibold uppercase tracking-[0.14em] text-muted"
      >
        {/* The heading's own text-muted, which the theme contract keeps at
            4.5:1; a further opacity took the count below it (AB#387). */}
        {heading} <span className="font-normal">({group.total})</span>
      </h2>
      <ul className="mt-2">
        {group.hits.map((hit) => (
          <Row
            key={`${hit.kind}:${hit.id}`}
            hit={hit}
            tokens={tokens}
            locale={locale}
            kindLabel={kindLabel}
            showSummary={showSummary}
          />
        ))}
      </ul>
      {showCapNotice && group.total > group.hits.length && (
        <p className="mt-3 text-sm text-muted">
          {narrowSearchText(labels, group.hits.length)}
        </p>
      )}
    </section>
  );
}

/**
 * The grouped hits of one search, shared by the dialog and the results page so
 * the two cannot drift. It renders nothing for an empty response: the caller
 * owns the empty, too-short and unavailable states, because their wording and
 * live-region behavior differ between the two surfaces.
 */
export function SiteSearchResults({
  idPrefix,
  response,
  tokens,
  locale,
  labels,
  showSummary = false,
  showCapNotice = false,
}: {
  /** Makes the group heading ids unique where two result lists could coexist. */
  readonly idPrefix: string;
  readonly response: SiteSearchResponse;
  readonly tokens: readonly string[];
  readonly locale: string;
  readonly labels: SiteSearchLabels;
  readonly showSummary?: boolean;
  readonly showCapNotice?: boolean;
}) {
  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
      <Group
        idPrefix={`${idPrefix}-stories`}
        heading={labels.storiesHeading}
        group={response.stories}
        tokens={tokens}
        locale={locale}
        kindLabel={labels.storyKind}
        labels={labels}
        showSummary={showSummary}
        showCapNotice={showCapNotice}
      />
      <Group
        idPrefix={`${idPrefix}-services`}
        heading={labels.servicesHeading}
        group={response.services}
        tokens={tokens}
        locale={locale}
        kindLabel={labels.serviceKind}
        labels={labels}
        showSummary={showSummary}
        showCapNotice={showCapNotice}
      />
    </div>
  );
}

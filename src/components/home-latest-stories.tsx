import Link from "next/link";
import { StoryCard, type StoryCardEntry } from "@/components/story-card";
import type { BuiltInLabels } from "@/lib/deployment-config";

type HomeLatestStoriesProps = {
  readonly entries: readonly StoryCardEntry[];
  /** The story root, or omitted where this locale has none to link to. */
  readonly storiesHref?: string;
  readonly locale: string;
  readonly labels: BuiltInLabels;
};

/**
 * The home page's latest stories (AB#252, design frame 05): the most recently
 * updated public stories as cards, with a link to the whole story root. It
 * renders nothing without entries, so an empty section never announces itself.
 * Cards come from the shared `StoryCard`, so a cover keeps its native ratio and
 * a page with none stays a text card.
 */
export function HomeLatestStories({
  entries,
  storiesHref,
  locale,
  labels,
}: HomeLatestStoriesProps) {
  if (entries.length === 0) return null;

  return (
    <section
      id="home-latest-stories"
      aria-labelledby="home-latest-stories-heading"
      className="border-t border-border py-16 sm:py-20"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              {labels.pages.stories}
            </p>
            <h2
              id="home-latest-stories-heading"
              className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {labels.contentTree.latestContent}
            </h2>
          </div>
          {storiesHref !== undefined && (
            <Link
              href={storiesHref}
              className="text-base underline underline-offset-4 transition-colors hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {labels.homeLatestStories.allStories}
              <span aria-hidden="true"> →</span>
            </Link>
          )}
        </div>
        <ul className="grid items-start gap-x-10 gap-y-14 sm:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.contentId}>
              <StoryCard entry={entry} locale={locale} labels={labels} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

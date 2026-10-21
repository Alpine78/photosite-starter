import Link from "next/link";
import { MediaFigure } from "@/components/media-figure";
import type { HomePhotographerIntroduction } from "@/lib/home-content";

type Props = {
  introduction: HomePhotographerIntroduction;
  contactLabel: string;
  servicesLabel: string;
  contactHref: string;
  servicesHref: string;
};

/** The optional introduction keeps its mobile order when enlarged text exhausts row capacity. */
export function HomePhotographerIntroduction({
  introduction,
  contactLabel,
  servicesLabel,
  contactHref,
  servicesHref,
}: Props) {
  return (
    <section
      aria-labelledby="photographer-introduction-heading"
      className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:px-6 md:flex md:flex-wrap md:gap-12 lg:py-20"
    >
      <MediaFigure
        image={introduction.portrait}
        // AB#383: the largest image of the first mobile screen.
        eager
        sizes="(min-width: 1152px) 320px, (min-width: 768px) 320px, (min-width: 416px) 384px, calc(100vw - 32px)"
        className="w-full max-w-sm md:min-w-0 md:max-w-[320px] md:basis-[320px] md:shrink-0"
      />
      <div className="min-w-0 [overflow-wrap:anywhere] md:basis-80 md:grow">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          {introduction.eyebrow}
        </p>
        <h2
          id="photographer-introduction-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          {introduction.storyHref ? (
            <Link href={introduction.storyHref} className="rounded-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              {introduction.heading}
            </Link>
          ) : introduction.heading}
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-body sm:text-lg">
          {introduction.text}
        </p>
        {introduction.facts.length > 0 && (
          <dl className="mt-8 grid gap-5 border-t border-border pt-6 sm:grid-cols-3">
            {introduction.facts.map((fact, index) => (
              <div key={index}>
                <dt className="text-sm font-semibold">{fact.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={contactHref}
            className="inline-flex min-h-11 items-center rounded-full bg-accent px-6 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {contactLabel}
          </Link>
          <Link
            href={servicesHref}
            className="inline-flex min-h-11 items-center rounded-full border border-border-control px-6 text-sm font-medium transition-colors hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {servicesLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

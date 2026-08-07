import { Fragment } from "react";
import Link from "next/link";

export type BreadcrumbStep = {
  readonly label: string;
  /** Absolute route path. The step the visitor is on has none. */
  readonly href?: string;
};

type BreadcrumbsProps = {
  /** Accessible name of the navigation landmark, in the page's locale. */
  label: string;
  steps: readonly BreadcrumbStep[];
};

/**
 * Ancestry navigation as an ordered list inside a named landmark.
 *
 * The separators are decorative and hidden from assistive technology: the list
 * already conveys the sequence, and a screen reader announcing "slash" between
 * every step reads as noise. The final step is the current page, so it is text
 * marked `aria-current` rather than a link back to itself.
 */
export function Breadcrumbs({ label, steps }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className="text-sm text-foreground/60">
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((step, index) => (
          <Fragment key={step.href ?? `${index}-${step.label}`}>
            {index > 0 && <li aria-hidden="true">/</li>}
            <li className="truncate">
              {step.href === undefined ? (
                <span aria-current="page" className="text-foreground/80">
                  {step.label}
                </span>
              ) : (
                <Link
                  href={step.href}
                  className="hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {step.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

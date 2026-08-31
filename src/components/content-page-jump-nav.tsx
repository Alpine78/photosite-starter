import Link from "next/link";
import type { ContentHeading } from "@/lib/content-headings";

type ContentPageJumpNavProps = {
  /** Accessible name of the nav landmark, and its own visible heading. */
  label: string;
  /** The body's level-2 headings, already carrying their anchor ids. */
  headings: readonly ContentHeading[];
  /**
   * An additional link rendered before the heading list. The gallery variant
   * uses this for its link to the image grid (ADR-0003 decision 3); the
   * article variant, which has no grid to jump to, omits it.
   */
  leadingLink?: { readonly href: string; readonly label: string };
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * The page-jump navigation ADR-0003 decision 3 derives from a body's
 * structure rather than an authoring toggle. Shared by both content variants
 * so a body-derived link and the anchor it targets can never drift between
 * two independent renderings of the same rule.
 *
 * Renders nothing when there is nothing to jump to: no headings and no
 * leading link.
 */
export function ContentPageJumpNav({
  label,
  headings,
  leadingLink,
}: ContentPageJumpNavProps) {
  if (headings.length === 0 && leadingLink === undefined) return null;

  return (
    <nav
      aria-label={label}
      className="mt-8 border-l-2 border-border pl-4"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </p>
      <ol className="mt-2 space-y-1 text-sm">
        {leadingLink && (
          <li>
            <Link
              href={leadingLink.href}
              className={`text-muted underline underline-offset-4 hover:text-foreground ${focusRing}`}
            >
              {leadingLink.label}
            </Link>
          </li>
        )}
        {headings.map((heading) => (
          <li key={heading.id}>
            <Link
              href={`#${heading.id}`}
              className={`text-muted underline underline-offset-4 hover:text-foreground ${focusRing}`}
            >
              {heading.text}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

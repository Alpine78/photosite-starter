import Link from "next/link";
import {
  nestContentHeadings,
  type ContentHeading,
  type ContentHeadingNode,
} from "@/lib/content-headings";

type ContentPageJumpNavProps = {
  /** Accessible name of the nav landmark, and its own visible heading. */
  label: string;
  /** The body's headings (levels 2-4), already carrying their anchor ids. */
  headings: readonly ContentHeading[];
  /**
   * An additional link rendered before the heading list. The gallery variant
   * uses this for its link to the image grid (ADR-0003 decision 3); the
   * article variant, which has no grid to jump to, omits it.
   */
  leadingLink?: { readonly href: string; readonly label: string };
};

const linkClassName =
  "text-muted underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * One heading entry and, when it has any, the nested `<ol>` of its own
 * children — recursion rather than one hand-unrolled level per depth, though
 * `nestContentHeadings` never produces more than AB#21's three levels.
 */
function ContentHeadingEntry({ node }: { node: ContentHeadingNode }) {
  return (
    <li>
      <Link href={`#${node.id}`} className={linkClassName}>
        {node.text}
      </Link>
      {node.children.length > 0 && <ContentHeadingList nodes={node.children} />}
    </li>
  );
}

function ContentHeadingList({ nodes }: { nodes: readonly ContentHeadingNode[] }) {
  return (
    <ol className="mt-1 space-y-1 pl-4">
      {nodes.map((node) => (
        <ContentHeadingEntry key={node.id} node={node} />
      ))}
    </ol>
  );
}

/**
 * The page-jump navigation ADR-0003 decision 3 derives from a body's
 * structure rather than an authoring toggle. Shared by both content variants
 * so a body-derived link and the anchor it targets can never drift between
 * two independent renderings of the same rule.
 *
 * Renders nothing when there is nothing to jump to: no headings and no
 * leading link. `headings` is nested by `nestContentHeadings` into a real
 * `<ol>` hierarchy (AB#21): a level-3 heading's `<li>` sits inside the
 * preceding level-2 entry's own nested `<ol>`, and likewise for level 4 under
 * level 3. The gallery's leading link to `#gallery`, when present, stays the
 * first entry in the top-level list, ahead of the whole heading tree.
 */
export function ContentPageJumpNav({
  label,
  headings,
  leadingLink,
}: ContentPageJumpNavProps) {
  if (headings.length === 0 && leadingLink === undefined) return null;

  const tree = nestContentHeadings(headings);

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
            <Link href={leadingLink.href} className={linkClassName}>
              {leadingLink.label}
            </Link>
          </li>
        )}
        {tree.map((node) => (
          <ContentHeadingEntry key={node.id} node={node} />
        ))}
      </ol>
    </nav>
  );
}

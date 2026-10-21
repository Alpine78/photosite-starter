"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ContentFragmentLink } from "@/components/content-fragment-link";
import { measureReadingChapter, readingProgress } from "@/lib/browser-reading-geometry";
import type { ContentHeadingNode } from "@/lib/content-headings";
import type { BuiltInLabels } from "@/lib/deployment-config";

type Labels = BuiltInLabels["readingPosition"];
type Reading = { readonly id?: string; readonly percent: number };

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled])";

const subscribeNothing = () => () => {};

function flatten(nodes: readonly ContentHeadingNode[], top: number, into: Map<string, number>, order: string[]) {
  for (const node of nodes) {
    into.set(node.id, top);
    order.push(node.id);
    flatten(node.children, top, into, order);
  }
}

/**
 * The article contents list as the AB#372 reading-position surface: progress,
 * read/current/upcoming state and the remember switch in one place. On a wide
 * screen it is the existing sticky side column; below 64rem the same single
 * navigation landmark collapses into a sticky bar that opens it as a bottom
 * sheet. Server and no-script rendering show the complete, fully expanded list
 * with native fragment links; every enhancement is applied after hydration.
 */
export function ArticleReadingContents({ label, tree, labels, sectionsLabel, footer }: {
  readonly label: string;
  readonly tree: readonly ContentHeadingNode[];
  readonly labels: Labels;
  readonly sectionsLabel: string;
  readonly footer?: ReactNode;
}) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [reading, setReading] = useState<Reading>({ percent: 0 });
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const wasOpen = useRef(false);
  const id = useId();

  const { topOf, order, byId } = useMemo(() => {
    const topOf = new Map<string, number>();
    const order: string[] = [];
    tree.forEach((node, index) => flatten([node], index, topOf, order));
    const byId = new Map<string, ContentHeadingNode>();
    const walk = (nodes: readonly ContentHeadingNode[]) => nodes.forEach((node) => { byId.set(node.id, node); walk(node.children); });
    walk(tree);
    return { topOf, order, byId };
  }, [tree]);

  useEffect(() => {
    const body = rootRef.current?.closest("article")?.querySelector("[data-content-body]");
    const headings = order.map((headingId) => document.getElementById(headingId));
    if (!body || headings.some((heading) => heading === null)) return;
    const elements = headings as HTMLElement[];
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const chapter = measureReadingChapter(body, elements);
      const rect = body.getBoundingClientRect();
      const percent = readingProgress({ top: rect.top, height: rect.height }, window.innerHeight);
      const current = chapter.kind === "heading" ? chapter.id : undefined;
      setReading((previous) => previous.id === current && previous.percent === percent ? previous : { id: current, percent });
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(measure); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [order]);

  const closeSheet = useCallback((returnFocus: boolean) => {
    restoreFocus.current = returnFocus;
    setSheetOpen(false);
  }, []);

  useEffect(() => {
    if (!sheetOpen) {
      // The close control disappears with the sheet; return focus to the bar it
      // opened from, except after a link moved the reader to its chapter.
      if (wasOpen.current && restoreFocus.current) barRef.current?.focus({ preventScroll: true });
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    restoreFocus.current = true;
    closeRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeSheet(true); return; }
      if (event.key !== "Tab") return;
      // Only the sheet itself: the bar behind the backdrop is not part of it.
      const root = panelRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    // A wide-screen resize turns the sheet back into the side column.
    const wide = window.matchMedia("(width >= 64rem)");
    const resize = () => { if (wide.matches) closeSheet(false); };
    document.addEventListener("keydown", keydown);
    wide.addEventListener("change", resize);
    return () => {
      document.removeEventListener("keydown", keydown);
      wide.removeEventListener("change", resize);
    };
  }, [sheetOpen, closeSheet]);

  const currentTop = reading.id === undefined ? (hydrated ? 0 : undefined) : topOf.get(reading.id);
  const currentNode = reading.id === undefined ? undefined : byId.get(reading.id);
  const progress = labels.progress.replace("{percent}", String(reading.percent));

  const entry = (node: ContentHeadingNode, top: number | undefined, depth: number): ReactNode => {
    const isCurrent = node.id === reading.id;
    // A top-level section opens while it is current; deeper lists follow their
    // already visible parent, so the current H4 is never hidden by default.
    const open = !hydrated || (toggled[node.id] ?? (depth > 0 || top === currentTop));
    const subId = `${id}-${node.id}`;
    const state = depth > 0 || currentTop === undefined || top === undefined ? undefined
      : top < currentTop ? "read" : top === currentTop ? "current" : "upcoming";
    return (
      <li key={node.id} data-reading-state={state} data-open={node.children.length > 0 && open ? "" : undefined}>
        <span className="reading-contents__row">
          <ContentFragmentLink href={`#${node.id}`} className={`reading-contents__link ${focusRing}`}>
            <span aria-current={isCurrent ? "location" : undefined}>{node.text}</span>
            {isCurrent && <span className="reading-contents__now">{labels.readingNow}</span>}
          </ContentFragmentLink>
          {hydrated && node.children.length > 0 && (
            <button type="button" className={`reading-contents__toggle ${focusRing}`}
              aria-expanded={open} aria-controls={subId} aria-label={`${labels.subsections}: ${node.text}`}
              onClick={() => setToggled((previous) => ({ ...previous, [node.id]: !open }))}>
              <span aria-hidden="true">{node.children.length}</span>
            </button>
          )}
        </span>
        {node.children.length > 0 && (
          <ol id={subId} className="reading-contents__sub" hidden={!open}>
            {node.children.map((child) => entry(child, undefined, depth + 1))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <div ref={rootRef} className={`reading-contents${hydrated ? " reading-contents--enhanced" : ""}${sheetOpen ? " reading-contents--open" : ""}`}>
      <button ref={barRef} type="button" className={`reading-contents__bar ${focusRing}`}
        aria-expanded={sheetOpen} aria-controls={`${id}-panel`} aria-haspopup="dialog"
        style={{ "--reading-progress": `${reading.percent}%` } as CSSProperties}
        onClick={() => setSheetOpen(true)}>
        <span className="reading-contents__bar-text">
          <small>{currentNode === undefined ? label : `${(currentTop ?? 0) + 1}/${tree.length}`}</small>
          <span>{currentNode === undefined ? sectionsLabel : currentNode.text}</span>
        </span>
        <em>{currentNode === undefined ? labels.open : `${reading.percent} %`}</em>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {/* Without script the bar cannot open anything: content-reading-layout.css
          keeps the complete inline list under @media (scripting: none) (AB#388). */}
      {sheetOpen && <div className="reading-contents__backdrop" aria-hidden="true" onClick={() => closeSheet(true)} />}
      <div ref={panelRef} id={`${id}-panel`} className="reading-contents__panel"
        role={sheetOpen ? "dialog" : undefined} aria-modal={sheetOpen ? true : undefined}
        aria-labelledby={sheetOpen ? `${id}-title` : undefined}>
        <div className="reading-contents__sheet-head">
          <div>
            <p id={`${id}-title`} className="reading-contents__sheet-title">{label}</p>
            <p className="text-sm text-subtle">{progress} · {sectionsLabel}</p>
          </div>
          <button ref={closeRef} type="button" className={`reading-contents__close ${focusRing}`}
            aria-label={labels.close} onClick={() => closeSheet(true)}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
        </div>
        <nav aria-label={label} className="content-reading-nav reading-contents__nav"
          onClickCapture={(event) => {
            if (sheetOpen && event.target instanceof Element && event.target.closest("a[href]")) closeSheet(false);
          }}>
          <div className="reading-contents__head">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
            {hydrated && <p className="text-sm text-muted">{progress}</p>}
          </div>
          {hydrated && (
            <div className="reading-contents__progress" aria-hidden="true">
              <i style={{ inlineSize: `${reading.percent}%` }} />
            </div>
          )}
          <ol className="reading-contents__list">
            {tree.map((node, index) => entry(node, index, 0))}
          </ol>
          {/* The switch sits with what it remembers and scrolls with the pane. */}
          {footer !== undefined && <div className="reading-contents__footer">{footer}</div>}
        </nav>
      </div>
    </div>
  );
}

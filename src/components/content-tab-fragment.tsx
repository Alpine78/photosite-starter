"use client";

import { Component, createRef, type ReactNode } from "react";
import { fragmentIntersectsViewport, tabFragmentScrollCorrection } from "@/lib/content-tab-fragment";

type Props = { enhanced: boolean; children: ReactNode };
type Snapshot = { target: HTMLElement; top: number; height: number; href: string };
const MODAL = "dialog[open], [aria-modal='true']";

/**
 * A before-mutation snapshot is intentionally a class lifecycle: a layout effect
 * cannot read the old DOM in the same commit. No scroll subscriptions or retries.
 */
export class ContentTabFragment extends Component<Props, Record<string, never>, Snapshot | null> {
  private root = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: Readonly<Props>): Snapshot | null {
    if (previous.enhanced || !this.props.enhanced || document.querySelector(MODAL)) return null;
    const root = this.root.current;
    const target = document.querySelector(":target");
    if (!root || !(target instanceof HTMLElement) || !/^H[234]$/.test(target.tagName) ||
        !root.parentElement?.contains(target) || root.contains(target) ||
        !(root.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
    const bounds = target.getBoundingClientRect();
    if (!fragmentIntersectsViewport(bounds.top, bounds.bottom, window.innerHeight)) return null;
    return { target, top: bounds.top, height: root.getBoundingClientRect().height, href: window.location.href };
  }

  componentDidUpdate(
    _previous: Readonly<Props>,
    _state: Readonly<Record<string, never>>,
    snapshot?: Snapshot | null,
  ): void {
    const root = this.root.current;
    if (!snapshot || !root?.isConnected || !snapshot.target.isConnected ||
        window.location.href !== snapshot.href || document.querySelector(":target") !== snapshot.target ||
        document.querySelector(MODAL)) return;
    const correction = tabFragmentScrollCorrection(snapshot.top,
      snapshot.target.getBoundingClientRect().top, snapshot.height, root.getBoundingClientRect().height);
    if (correction === 0) return;
    // Each group compensates at most its own shrink, even when several update together.
    try { window.scrollBy({ top: correction, behavior: "instant" }); }
    catch { /* An unavailable scroll API must not break the readable table fallback. */ }
  }

  render() {
    return <div ref={this.root} data-content-tabs className={this.props.enhanced ? "space-y-4" : "space-y-6"}>
      {this.props.children}
    </div>;
  }
}

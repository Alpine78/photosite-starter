"use client";

import type { MouseEvent, ReactNode } from "react";

/** Keep the native anchor action, while registering its entry with Next's
 * documented History API integration. An unregistered native hash entry has
 * null state and can leave the wrong page rendered after a client-route Back.
 * The state is opaque: no framework fields are inspected or reconstructed.
 */
export function recordContentFragmentNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  if (typeof window === "undefined" || event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      event.currentTarget.hash === window.location.hash) return;
  try {
    window.history.pushState(window.history.state, "", event.currentTarget.href);
  } catch {
    // History may be unavailable. The unprevented anchor still navigates.
  }
}

export function ContentFragmentLink({ href, className, children }: {
  readonly href: `#${string}`;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <a href={href} className={className} onClick={recordContentFragmentNavigation}>{children}</a>;
}

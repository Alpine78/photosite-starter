"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Shared by the site header and gallery sections: retain each bar's own focus pin. */
export function useScrollReveal({
  enabled = true,
  keepExpanded = false,
  keyboardFocusOnly = false,
}: {
  enabled?: boolean;
  keepExpanded?: boolean;
  keyboardFocusOnly?: boolean;
} = {}) {
  const ref = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);
  const pathname = usePathname();
  const subscribedPathname = useRef(pathname);
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    setHidden(false);
  }

  useEffect(() => {
    if (!enabled) return;

    // Safari's elastic overscroll can report positions outside the document.
    const scrollY = () => Math.max(0, Math.min(
      window.scrollY,
      Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight),
    ));
    // Persistent layouts can subscribe before Next restores the new page's
    // scroll position. Do not use the previous page's position as its baseline;
    // a native restoration event will establish any Back/Forward position.
    const routeChanged = subscribedPathname.current !== pathname;
    subscribedPathname.current = pathname;
    let lastY = routeChanged ? 0 : scrollY();
    const onScroll = () => {
      const currentY = scrollY();
      const element = ref.current;
      const focused = document.activeElement;
      const focusPins = element?.contains(focused) &&
        (!keyboardFocusOnly || focused?.matches(":focus-visible"));
      // Compact and desktop markup coexist. Only a displayed disclosure pins
      // the header; Safari pointer activation need not move focus to its button.
      const expandedPins = keepExpanded && element !== null &&
        Array.from(element.querySelectorAll('[aria-expanded="true"]'))
          .some((control) => control.getClientRects().length > 0);
      if (currentY === 0 || focusPins || expandedPins || currentY < lastY) {
        setHidden(false);
      } else if (currentY > lastY) {
        setHidden(true);
      }
      // Keep the baseline current even while a disclosure or focus pins it.
      lastY = currentY;
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        setHidden(false);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled, keepExpanded, keyboardFocusOnly, pathname]);

  return { ref, hidden };
}

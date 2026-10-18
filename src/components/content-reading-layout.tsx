import type { ReactNode } from "react";
import {
  ContentPageJumpNav,
  hasContentPageJumpNav,
  type ContentPageJumpNavProps,
} from "@/components/content-page-jump-nav";
import "@/components/content-reading-layout.css";

/** Presentation only: one native contents list, before the existing editorial body. */
export function ContentReadingLayout({
  intro,
  centered = false,
  children,
  ...navigation
}: ContentPageJumpNavProps & {
  readonly intro?: ReactNode;
  readonly centered?: boolean;
  readonly children: ReactNode;
}) {
  const hasNavigation = hasContentPageJumpNav(navigation.headings, navigation.leadingLink);
  return (
    <div className={`content-reading-layout${centered ? " content-reading-layout--centered" : ""}`}>
      {intro !== undefined && <div className="content-reading-intro">{intro}</div>}
      <div className={`content-reading-row${hasNavigation ? " content-reading-row--with-nav" : ""}`}>
        {hasNavigation && (
          <div className="content-reading-nav-column">
            <ContentPageJumpNav {...navigation} />
          </div>
        )}
        <div className="content-reading-body">{children}</div>
      </div>
    </div>
  );
}

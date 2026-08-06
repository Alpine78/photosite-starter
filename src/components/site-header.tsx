"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { NavigationItem } from "@/lib/site-settings";

type SiteHeaderProps = {
  siteName: string;
  navigation: NavigationItem[];
  labels: BuiltInLabels["navigation"];
};

/**
 * Returns true when `href` is the current route. Exact match for the home
 * route ("/"), prefix match for sections so nested pages keep the parent
 * nav item active.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({ siteName, navigation, labels }: SiteHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    // The site chrome stays above page content. A hero whose overlay is taller
    // than its image — a wide frame on a narrow screen — otherwise spills over
    // the header and swallows taps on the menu button and the open menu panel.
    <header className="relative z-10 border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {siteName}
        </Link>

        {/* Desktop navigation */}
        <nav aria-label={labels.main} className="hidden sm:block">
          <ul className="flex items-center gap-6">
            {navigation.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`text-sm transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      active
                        ? "font-medium text-foreground"
                        : "text-foreground/70"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          className="inline-flex items-center gap-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:hidden"
        >
          {menuOpen ? labels.closeMenu : labels.menu}
        </button>
      </div>

      {/* Mobile navigation panel */}
      {menuOpen && (
        <nav
          id="mobile-nav"
          aria-label={labels.main}
          className="border-t border-black/10 px-4 pb-4 dark:border-white/15 sm:hidden"
        >
          <ul className="flex flex-col gap-1 pt-2">
            {navigation.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={`block py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      active
                        ? "font-medium text-foreground"
                        : "text-foreground/70"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}

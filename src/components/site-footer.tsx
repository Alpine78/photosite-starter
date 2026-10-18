import Link from "next/link";
import { BrandMarks } from "@/components/brand-mark";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { PublicImageRendition } from "@/lib/media";
import type { ResolvedNavigationLink } from "@/lib/site-navigation";
import type { ContactInfo, SocialLink } from "@/lib/site-settings";

type SiteFooterProps = {
  /** This locale's site name (`resolveSiteName`), the brand block's name. */
  siteName: string;
  /** The canonical origin's host, shown under the name as the site's address. */
  siteHost: string;
  /** The header's brand mark and its dark-theme variant, at the footer's scale. */
  logo?: PublicImageRendition;
  logoDark?: PublicImageRendition;
  contact: ContactInfo;
  socialLinks: SocialLink[];
  /** Already resolved against this locale's tree; see `site-navigation.ts`. */
  footerLinks: readonly ResolvedNavigationLink[];
  copyrightHolder: string;
  labels: Pick<BuiltInLabels, "footer" | "navigation">;
};

const linkClasses =
  "transition-colors hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/** Capitalizes a lowercase platform identifier for display, e.g. "instagram" → "Instagram". */
function platformLabel(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/**
 * Site-wide footer rendered on every page. All content comes from
 * SiteSettings — nothing is hardcoded. Server component: it has no
 * interactivity, so it stays out of the client bundle.
 */
export function SiteFooter({
  siteName,
  siteHost,
  logo,
  logoDark,
  contact,
  socialLinks,
  footerLinks,
  copyrightHolder,
  labels,
}: SiteFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border [overflow-wrap:anywhere]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:pt-16">
        {/* The proposal's footer brand: the mark beside the name and the
            site's address. The mark is decorative, as in the header. */}
        <div className="flex items-center gap-5">
          {logo !== undefined && (
            <BrandMarks logo={logo} logoDark={logoDark} placement="footer" />
          )}
          <p className="min-w-0 text-[0.9375rem] text-muted">
            <span className="block text-[1.0625rem] font-semibold text-foreground">
              {siteName}
            </span>
            {siteHost}
          </p>
        </div>

        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {/* Contact */}
          <section aria-labelledby="footer-contact-heading">
            <h2
              id="footer-contact-heading"
              className="text-base font-semibold tracking-tight"
            >
              {labels.footer.contact}
            </h2>
            <address className="mt-4 flex flex-col gap-2 text-base not-italic text-muted">
              <a href={`mailto:${contact.email}`} className={linkClasses}>
                {contact.email}
              </a>
              {contact.phone && (
                <a
                  href={`tel:${contact.phone.replace(/\s+/g, "")}`}
                  className={linkClasses}
                >
                  {contact.phone}
                </a>
              )}
              {contact.address && <span>{contact.address}</span>}
              {contact.businessId && (
                <span>
                  {labels.footer.businessId}: {contact.businessId}
                </span>
              )}
            </address>
          </section>

          {/* Quick navigation */}
          {footerLinks.length > 0 && (
            <nav aria-label={labels.navigation.footer}>
              <h2 className="text-base font-semibold tracking-tight">
                {labels.footer.explore}
              </h2>
              <ul className="mt-4 flex flex-col gap-2">
                {footerLinks.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`text-base text-muted ${linkClasses}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {/* Social */}
          {socialLinks.length > 0 && (
            <section aria-labelledby="footer-social-heading">
              <h2
                id="footer-social-heading"
                className="text-base font-semibold tracking-tight"
              >
                {labels.footer.follow}
              </h2>
              <ul className="mt-4 flex flex-col gap-2">
                {socialLinks.map((social) => (
                  <li key={social.url}>
                    <a
                      href={social.url}
                      aria-label={social.label}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-base text-muted ${linkClasses}`}
                    >
                      {platformLabel(social.platform)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <p className="mt-8 border-t border-border pt-6 text-sm text-subtle">
          © {year} {copyrightHolder}. {labels.footer.rightsReserved}
        </p>
      </div>
    </footer>
  );
}

import Link from "next/link";
import { getDefaultLocaleLabels } from "@/lib/deployment-config";
import type { ResolvedNavigationLink } from "@/lib/site-navigation";
import type { ContactInfo, SocialLink } from "@/lib/site-settings";

type SiteFooterProps = {
  contact: ContactInfo;
  socialLinks: SocialLink[];
  /** Already resolved against this locale's tree; see `site-navigation.ts`. */
  footerLinks: readonly ResolvedNavigationLink[];
  copyrightHolder: string;
};

const linkClasses =
  "hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

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
  contact,
  socialLinks,
  footerLinks,
  copyrightHolder,
}: SiteFooterProps) {
  const year = new Date().getFullYear();
  const labels = getDefaultLocaleLabels();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {/* Contact */}
          <section aria-labelledby="footer-contact-heading">
            <h2
              id="footer-contact-heading"
              className="text-sm font-semibold tracking-tight"
            >
              {labels.footer.contact}
            </h2>
            <address className="mt-3 flex flex-col gap-1 text-sm not-italic text-muted">
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
              <h2 className="text-sm font-semibold tracking-tight">
                {labels.footer.explore}
              </h2>
              <ul className="mt-3 flex flex-col gap-1">
                {footerLinks.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`text-sm text-muted ${linkClasses}`}
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
                className="text-sm font-semibold tracking-tight"
              >
                {labels.footer.follow}
              </h2>
              <ul className="mt-3 flex flex-col gap-1">
                {socialLinks.map((social) => (
                  <li key={social.url}>
                    <a
                      href={social.url}
                      aria-label={social.label}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm text-muted ${linkClasses}`}
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

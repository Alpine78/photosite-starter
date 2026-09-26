import Link from "next/link";
import type { ContactCallToAction as ContactCallToActionContent } from "@/lib/contact-call-to-action";

type Props = {
  content: ContactCallToActionContent;
  contactLabel: string;
  headingId: string;
};

/** Shared presentation; each page decides independently whether it has copy. */
export function ContactCallToAction({ content, contactLabel, headingId }: Props) {
  return (
    <section aria-labelledby={headingId} className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-10">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h2 id={headingId} className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {content.heading}
          </h2>
          <p className="mt-2 max-w-2xl text-body">{content.text}</p>
        </div>
        <Link
          href="/contact"
          className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-full bg-accent px-6 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 md:self-auto"
        >
          {contactLabel}
        </Link>
      </div>
    </section>
  );
}

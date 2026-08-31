"use client";

import { useId, type ReactNode } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { ContactPrivacyNotice } from "@/lib/site-settings";

/**
 * The deployment-authored processing summary shown inside a submission form.
 *
 * The four statements — what is collected, why, who receives it, how long it is
 * kept — are `SiteSettings.contact.privacyNotice`, authored per deployment
 * (ADR-0004 §5). A clone owns its own wording; this component only lays it out.
 * A caller may pass `extra` for one generic sentence the authored notice cannot
 * know — the gallery enquiry adds that the selected item's reference travels
 * with the message.
 */
export function PrivacyNotice({
  labels,
  notice,
  extra,
}: {
  labels: BuiltInLabels["contact"];
  notice: ContactPrivacyNotice;
  extra?: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-black/10 p-4 text-sm text-foreground/70 dark:border-white/15"
    >
      <h2 id={headingId} className="font-medium text-foreground">
        {labels.privacyTitle}
      </h2>
      <dl className="mt-3 space-y-2">
        {(
          [
            [labels.privacyCollected, notice.collected],
            [labels.privacyPurpose, notice.purpose],
            [labels.privacyRecipient, notice.recipient],
            [labels.privacyRetention, notice.retention],
          ] as const
        ).map(([term, description]) => (
          <div key={term} className="sm:flex sm:gap-2">
            <dt className="font-medium text-foreground sm:min-w-32">{term}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
      {extra !== undefined && <p className="mt-3">{extra}</p>}
    </section>
  );
}

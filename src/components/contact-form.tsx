"use client";

import { PrivacyNotice } from "@/components/privacy-notice";
import { SubmissionForm } from "@/components/submission-form";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { ContactPrivacyNotice } from "@/lib/site-settings";
import type { ContactSubjectOption } from "@/lib/contact-details";

/**
 * The contact form: a thin wrapper over {@link SubmissionForm} that posts to
 * `/api/contact` and renders the authored privacy notice after the fields. The
 * status machine, idempotency lifecycle, honeypot, and accessibility treatment
 * all live in `SubmissionForm`, shared with the gallery-item enquiry form.
 */
export function ContactForm({
  labels,
  privacyNotice,
  services,
  initialSubject,
}: {
  labels: BuiltInLabels["contact"];
  privacyNotice: ContactPrivacyNotice;
  services: readonly ContactSubjectOption[];
  initialSubject: string;
}) {
  return (
    <SubmissionForm
      endpoint="/api/contact"
      context={{ kind: "contact" }}
      services={services}
      initialSubject={initialSubject}
      labels={labels}
      notice={<PrivacyNotice labels={labels} notice={privacyNotice} collapsible />}
    />
  );
}

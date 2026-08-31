"use client";

import { PrivacyNotice } from "@/components/privacy-notice";
import { SubmissionForm } from "@/components/submission-form";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { ContactPrivacyNotice } from "@/lib/site-settings";

/**
 * The contact form: a thin wrapper over {@link SubmissionForm} that posts to
 * `/api/contact` and renders the authored privacy notice after the fields. The
 * status machine, idempotency lifecycle, honeypot, and accessibility treatment
 * all live in `SubmissionForm`, shared with the gallery-item enquiry form.
 */
export function ContactForm({
  labels,
  privacyNotice,
}: {
  labels: BuiltInLabels["contact"];
  privacyNotice: ContactPrivacyNotice;
}) {
  return (
    <SubmissionForm
      endpoint="/api/contact"
      context={{ kind: "contact" }}
      labels={labels}
      notice={<PrivacyNotice labels={labels} notice={privacyNotice} />}
    />
  );
}

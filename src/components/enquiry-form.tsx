"use client";

import { PrivacyNotice } from "@/components/privacy-notice";
import { SubmissionForm } from "@/components/submission-form";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { ContactPrivacyNotice } from "@/lib/site-settings";

/**
 * The gallery-item enquiry form (AB#60): a thin wrapper over
 * {@link SubmissionForm} that posts to `/api/enquiry` with the public item
 * context (`kind`/`locale`/`contentId`/`itemId`), shows which gallery the
 * enquiry is about above the fields, and renders the same authored privacy
 * notice as the contact form plus one generic line stating that a reference to
 * the photograph travels with the message.
 *
 * The server page keys this component by `itemId`, so navigating from one
 * `?enquire=` URL to another starts a fresh form rather than carrying a stale
 * `submissionId` or outcome across.
 */
export function EnquiryForm({
  locale,
  contentId,
  itemId,
  galleryTitle,
  labels,
  privacyNotice,
}: {
  locale: string;
  contentId: string;
  itemId: string;
  galleryTitle: string;
  labels: BuiltInLabels;
  privacyNotice: ContactPrivacyNotice;
}) {
  return (
    <SubmissionForm
      endpoint="/api/enquiry"
      context={{ kind: "enquiry", locale, contentId, itemId }}
      labels={labels.contact}
      unavailableMessage={labels.enquiry.unavailable}
      intro={
        <p className="text-sm text-muted">
          {labels.enquiry.aboutItem.replace("{gallery}", galleryTitle)}
        </p>
      }
      notice={
        <PrivacyNotice
          labels={labels.contact}
          notice={privacyNotice}
          extra={labels.enquiry.itemContextNotice}
        />
      }
    />
  );
}

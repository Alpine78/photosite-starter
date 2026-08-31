"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CONTACT_FIELD_MAX_LENGTHS,
  CONTACT_FIELD_NAMES,
  parseContactMessage,
  type ContactFieldIssue,
  type ContactFieldName,
} from "@/lib/contact-message";
import {
  CONTACT_CONTENT_TYPE,
  CONTACT_HONEYPOT_FIELD,
  CONTACT_SUBMISSION_ID_FIELD,
} from "@/lib/contact-request";
import type { BuiltInLabels } from "@/lib/deployment-config";

/**
 * The shared submission form.
 *
 * Extracted from the contact form so the gallery-item enquiry (AB#60) reuses
 * the exact same status machine, idempotency lifecycle, hydration guard, focus
 * management, error summary, and hidden honeypot rather than a second copy of
 * that accessibility- and security-sensitive machinery. `ContactForm` and
 * `EnquiryForm` are thin wrappers over this.
 *
 * It submits with `fetch` (not a native POST) because the endpoints accept only
 * `application/json`, a content type an HTML form cannot produce and a
 * cross-origin script cannot send without a CORS preflight the site never
 * answers. Validation is `parseContactMessage`, the same pure module the
 * endpoints run; the server still validates every submission.
 *
 * The submission is de-duplicated on retry by a `submissionId` bound to the
 * *complete* semantic submission — the validated message, the endpoint, and the
 * enquiry context — so the same words submitted for a different photograph, or
 * to a different endpoint, cannot reuse a key the provider already saw.
 */

/**
 * What accompanies a submission beyond the three contact fields. A discriminated
 * type, not a bag of strings: the enquiry context cannot collide with a field
 * name, and only an `"enquiry"` context puts anything extra in the body.
 */
export type SubmissionContext =
  | { readonly kind: "contact" }
  | {
      readonly kind: "enquiry";
      readonly locale: string;
      readonly contentId: string;
      readonly itemId: string;
    };

type SubmissionFormProps = {
  endpoint: "/api/contact" | "/api/enquiry";
  context: SubmissionContext;
  labels: BuiltInLabels["contact"];
  /** Rendered above the fields — an enquiry's item context. */
  intro?: ReactNode;
  /** Rendered after the fields, before submit — the privacy notice section. */
  notice?: ReactNode;
  /**
   * Copy for an endpoint `404` whose body is `{reason:"item-unavailable"}` —
   * the enquiry endpoint's answer for an item that cannot be enquired about.
   * Shown as a non-retryable failure. Absent for the contact form, which has
   * no such response.
   */
  unavailableMessage?: string;
};

type FormValues = Record<ContactFieldName, string>;

const EMPTY_VALUES: FormValues = { name: "", email: "", message: "" };

type FormStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "succeeded" }
  | { kind: "field-errors"; issues: readonly ContactFieldIssue[] }
  | { kind: "failed"; message: string; retryable: boolean; reference?: string };

/**
 * A per-submission identifier the endpoint passes to the delivery provider as
 * an idempotency key. Only used to de-duplicate a retry, so a non-cryptographic
 * fallback is acceptable where `randomUUID` is unavailable — an insecure origin
 * during local development on a LAN address, which production never is.
 */
function createSubmissionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/** The body a submission POSTs, beyond name/email/message. */
function contextBody(context: SubmissionContext): Record<string, string> {
  return context.kind === "enquiry"
    ? {
        kind: "curated",
        locale: context.locale,
        contentId: context.contentId,
        itemId: context.itemId,
      }
    : {};
}

/** Never notifies: whether the client is running is not a value that changes. */
const subscribeToNothing = () => () => {};

const fieldClasses =
  "w-full rounded-md border border-border-control bg-background px-3 py-2 text-base " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "aria-[invalid=true]:border-danger";

export function SubmissionForm({
  endpoint,
  context,
  labels,
  intro,
  notice,
  unavailableMessage,
}: SubmissionFormProps) {
  const formId = useId();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  /**
   * Whether React is listening yet. Until it is, a click on the submit button
   * is a *native* form submission, and a native submission of a form with no
   * method puts every field in a GET query string — the one place ADR-0004 §5
   * forbids form data to appear. Disabling the button until hydration removes
   * that window; the `method` and `action` below make even an unexpected native
   * submit a POST to the endpoint, which answers 415 and leaks nothing.
   */
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const summaryRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const submissionIdRef = useRef<string | undefined>(undefined);
  const submittedSnapshotRef = useRef<string | undefined>(undefined);

  const fieldId = (field: ContactFieldName) => `${formId}-${field}`;
  const errorId = (field: ContactFieldName) => `${formId}-${field}-error`;

  const issues = status.kind === "field-errors" ? status.issues : [];

  useEffect(() => {
    if (status.kind === "field-errors") summaryRef.current?.focus();
    if (status.kind === "succeeded" || status.kind === "failed") {
      outcomeRef.current?.focus();
    }
  }, [status]);

  function messageFor(issue: ContactFieldIssue): string {
    switch (issue.code) {
      case "required":
        return labels.fieldErrors.required;
      case "invalid-email":
        return labels.fieldErrors.invalidEmail;
      case "too-long":
        return labels.fieldErrors.tooLong.replace(
          "{max}",
          String(CONTACT_FIELD_MAX_LENGTHS[issue.field]),
        );
    }
  }

  function updateField(field: ContactFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));

    setStatus((current) => {
      if (current.kind === "field-errors") {
        const remaining = current.issues.filter(
          (issue) => issue.field !== field,
        );
        return remaining.length > 0
          ? { kind: "field-errors", issues: remaining }
          : { kind: "idle" };
      }
      if (current.kind === "succeeded" || current.kind === "failed") {
        return { kind: "idle" };
      }
      return current;
    });
  }

  /**
   * The identifier stays the same while the *complete* submission does —
   * message, endpoint, and enquiry context — so pressing retry after a timeout
   * cannot deliver a second copy of a message that got through. Editing
   * anything, or submitting the same words about a different photograph, mints
   * a new one.
   */
  function submissionIdFor(snapshot: string): string {
    if (
      submissionIdRef.current === undefined ||
      submittedSnapshotRef.current !== snapshot
    ) {
      submissionIdRef.current = createSubmissionId();
      submittedSnapshotRef.current = snapshot;
    }
    return submissionIdRef.current;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "submitting") return;

    const validated = parseContactMessage(values);
    if (!validated.ok) {
      setStatus({ kind: "field-errors", issues: validated.issues });
      return;
    }

    setStatus({ kind: "submitting" });

    const submissionId = submissionIdFor(
      JSON.stringify({ message: validated.message, endpoint, context }),
    );

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": CONTACT_CONTENT_TYPE },
        body: JSON.stringify({
          ...validated.message,
          ...contextBody(context),
          [CONTACT_HONEYPOT_FIELD]: honeypot,
          [CONTACT_SUBMISSION_ID_FIELD]: submissionId,
        }),
      });
    } catch {
      setStatus({
        kind: "failed",
        message: labels.errorRetryable,
        retryable: true,
      });
      return;
    }

    const body: unknown = await response.json().catch(() => undefined);
    const payload = (body ?? {}) as {
      issues?: readonly ContactFieldIssue[];
      correlationId?: string;
      retryable?: boolean;
      reason?: string;
    };

    if (response.ok) {
      setValues(EMPTY_VALUES);
      submissionIdRef.current = undefined;
      submittedSnapshotRef.current = undefined;
      setStatus({ kind: "succeeded" });
      return;
    }

    if (response.status === 422 && payload.issues !== undefined) {
      setStatus({ kind: "field-errors", issues: payload.issues });
      return;
    }

    // The enquiry endpoint's one non-generic client-facing answer: the item
    // cannot be enquired about. A retry cannot change that.
    if (
      response.status === 404 &&
      payload.reason === "item-unavailable" &&
      unavailableMessage !== undefined
    ) {
      setStatus({
        kind: "failed",
        message: unavailableMessage,
        retryable: false,
        reference: payload.correlationId,
      });
      return;
    }

    const failedUpstream = response.status >= 500;
    const retryable =
      response.status === 429 || (failedUpstream && payload.retryable === true);

    const message =
      !failedUpstream && response.status !== 429
        ? labels.errorRequest
        : retryable
          ? labels.errorRetryable
          : labels.errorPermanent;

    setStatus({
      kind: "failed",
      message,
      retryable,
      reference: payload.correlationId,
    });
  }

  return (
    <div className="max-w-2xl">
      {(status.kind === "succeeded" || status.kind === "failed") && (
        <div
          ref={outcomeRef}
          tabIndex={-1}
          role="status"
          className={`mb-8 rounded-md border p-4 ${
            status.kind === "succeeded"
              ? "border-border-control"
              : "border-danger"
          }`}
        >
          {status.kind === "succeeded" ? (
            <>
              <p className="font-medium">{labels.successTitle}</p>
              <p className="mt-1 text-muted">{labels.successBody}</p>
            </>
          ) : (
            <>
              <p>{status.message}</p>
              {status.reference !== undefined && (
                <p className="mt-1 text-sm text-muted">
                  {labels.referenceLabel}:{" "}
                  <code className="font-mono">{status.reference}</code>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {issues.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="mb-8 rounded-md border border-danger p-4"
        >
          <h2 className="font-medium">{labels.errorSummaryTitle}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.code}`}>
                <a
                  href={`#${fieldId(issue.field)}`}
                  className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {labels[`${issue.field}Label`]}: {messageFor(issue)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* `noValidate` hands validation to the shared rules above. `method` and
          `action` are never used by the submitting path — they exist so a
          submission that somehow escapes it cannot become a GET carrying the
          fields in the URL, and they point at this form's own endpoint so the
          415 defense holds per endpoint. */}
      <form
        method="post"
        action={endpoint}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-6"
      >
        {intro}

        {CONTACT_FIELD_NAMES.map((field) => {
          const issue = issues.find((candidate) => candidate.field === field);
          const multiline = field === "message";

          return (
            <div key={field}>
              <label
                htmlFor={fieldId(field)}
                className="block text-sm font-medium"
              >
                {labels[`${field}Label`]}
                <span aria-hidden="true" className="ml-0.5 text-subtle">
                  {labels.requiredMark}
                </span>
              </label>

              {multiline ? (
                <textarea
                  id={fieldId(field)}
                  name={field}
                  rows={8}
                  required
                  maxLength={CONTACT_FIELD_MAX_LENGTHS[field]}
                  aria-invalid={issue !== undefined}
                  aria-describedby={issue === undefined ? undefined : errorId(field)}
                  value={values[field]}
                  onChange={(event) => updateField(field, event.target.value)}
                  className={`mt-2 ${fieldClasses}`}
                />
              ) : (
                <input
                  id={fieldId(field)}
                  name={field}
                  type={field === "email" ? "email" : "text"}
                  autoComplete={field === "email" ? "email" : "name"}
                  required
                  maxLength={CONTACT_FIELD_MAX_LENGTHS[field]}
                  aria-invalid={issue !== undefined}
                  aria-describedby={issue === undefined ? undefined : errorId(field)}
                  value={values[field]}
                  onChange={(event) => updateField(field, event.target.value)}
                  className={`mt-2 ${fieldClasses}`}
                />
              )}

              {issue !== undefined && (
                <p
                  id={errorId(field)}
                  className="mt-2 text-sm text-danger"
                >
                  {messageFor(issue)}
                </p>
              )}
            </div>
          );
        })}

        {/*
          The honeypot. Hidden from sight and from the accessibility tree, and
          removed from the tab order, so no person can reach it — which is what
          makes a value in it evidence rather than a guess.
        */}
        <div aria-hidden="true" className="hidden">
          <label htmlFor={`${formId}-${CONTACT_HONEYPOT_FIELD}`}>
            {labels.honeypotLabel}
          </label>
          <input
            id={`${formId}-${CONTACT_HONEYPOT_FIELD}`}
            name={CONTACT_HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </div>

        {notice}

        <button
          type="submit"
          disabled={!hydrated || status.kind === "submitting"}
          className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {status.kind === "submitting"
            ? labels.submitting
            : status.kind === "failed" && status.retryable
              ? labels.retry
              : labels.submit}
        </button>
      </form>
    </div>
  );
}

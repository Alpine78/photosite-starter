"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
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
import type { ContactPrivacyNotice } from "@/lib/site-settings";

/**
 * The contact form.
 *
 * It submits with `fetch` rather than as a native form POST, because the
 * endpoint accepts only `application/json` — a content type an HTML form
 * cannot produce and a cross-origin script cannot send without winning a CORS
 * preflight this site never answers. That single choice is what makes the
 * endpoint's content-type check a real cross-site request control, and it is
 * the reason this component exists at all.
 *
 * Validation rules are imported, not restated: `parseContactMessage` is the
 * same pure module the endpoint runs, so a value the form accepts is a value
 * the server accepts, and there is no second copy of the rules to drift. The
 * server still validates every submission — the client copy exists to answer
 * immediately, never to be trusted.
 *
 * Accessibility is structural rather than added on. Every field has a visible
 * `<label>`, errors are announced through a summary that takes focus and links
 * to the fields that caused them, each field points at its own message with
 * `aria-describedby`, and the delivery outcome is a polite live region so a
 * screen reader hears it without losing the caret.
 */

type ContactFormProps = {
  labels: BuiltInLabels["contact"];
  privacyNotice: ContactPrivacyNotice;
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

/** Never notifies: whether the client is running is not a value that changes. */
const subscribeToNothing = () => () => {};

const fieldClasses =
  "w-full rounded-md border border-black/20 bg-background px-3 py-2 text-base " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "aria-[invalid=true]:border-red-700 dark:border-white/25 dark:aria-[invalid=true]:border-red-400";

export function ContactForm({ labels, privacyNotice }: ContactFormProps) {
  const formId = useId();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  /**
   * Whether React is listening yet.
   *
   * Until it is, a click on the submit button is a *native* form submission,
   * and a native submission of a form with no method puts every field in a GET
   * query string — the one place ADR-0004 §5 forbids form data to appear, and
   * from there into a referrer and a hosting-provider request log. Disabling
   * the button until hydration removes that window entirely; the `method` and
   * `action` below make even an unexpected native submit a POST to the
   * endpoint, which answers 415 and leaks nothing.
   *
   * Read as an external store rather than set from an effect: the server
   * snapshot is what the prerendered HTML must contain, and the client
   * snapshot is what the hydrated page must contain. That is exactly the
   * distinction `useSyncExternalStore` exists to express.
   */
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const summaryRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const submissionIdRef = useRef<string | undefined>(undefined);
  const submittedValuesRef = useRef<string | undefined>(undefined);

  const fieldId = (field: ContactFieldName) => `${formId}-${field}`;
  const errorId = (field: ContactFieldName) => `${formId}-${field}-error`;

  const issues = status.kind === "field-errors" ? status.issues : [];

  /**
   * Moves focus to whatever the last submission produced: the error summary,
   * so the reason is the next thing read, or the outcome message, so a success
   * is not silently below the button that caused it.
   */
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
    // A message the visitor has started fixing should stop being reported as
    // wrong; the next submission decides again.
    setStatus((current) =>
      current.kind === "field-errors" ? { kind: "idle" } : current,
    );
  }

  /**
   * The identifier stays the same while the message does, so pressing retry
   * after a timeout cannot deliver a second copy of a message that did get
   * through. Editing anything mints a new one, because an edited message is a
   * different message and must not be de-duplicated against the old one.
   */
  function submissionIdFor(snapshot: string): string {
    if (
      submissionIdRef.current === undefined ||
      submittedValuesRef.current !== snapshot
    ) {
      submissionIdRef.current = createSubmissionId();
      submittedValuesRef.current = snapshot;
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

    const submissionId = submissionIdFor(JSON.stringify(validated.message));

    let response: Response;
    try {
      response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": CONTACT_CONTENT_TYPE },
        body: JSON.stringify({
          ...validated.message,
          [CONTACT_HONEYPOT_FIELD]: honeypot,
          [CONTACT_SUBMISSION_ID_FIELD]: submissionId,
        }),
      });
    } catch {
      // The request never reached the server, so nothing was delivered and
      // trying again is the right advice.
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
    };

    if (response.ok) {
      setValues(EMPTY_VALUES);
      // The next enquiry is a new message and must not reuse this key.
      submissionIdRef.current = undefined;
      submittedValuesRef.current = undefined;
      setStatus({ kind: "succeeded" });
      return;
    }

    if (response.status === 422 && payload.issues !== undefined) {
      setStatus({ kind: "field-errors", issues: payload.issues });
      return;
    }

    // A refused request means this page's state no longer matches what the
    // endpoint accepts; a 5xx means delivery itself failed. The two need
    // different advice, and only the second is worth retrying as-is.
    const retryable = response.status === 429 || response.status === 503;
    const message =
      response.status < 500 && !retryable
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
              ? "border-black/15 dark:border-white/20"
              : "border-red-700 dark:border-red-400"
          }`}
        >
          {status.kind === "succeeded" ? (
            <>
              <p className="font-medium">{labels.successTitle}</p>
              <p className="mt-1 text-foreground/70">{labels.successBody}</p>
            </>
          ) : (
            <>
              <p>{status.message}</p>
              {status.reference !== undefined && (
                <p className="mt-1 text-sm text-foreground/70">
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
          className="mb-8 rounded-md border border-red-700 p-4 dark:border-red-400"
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

      {/* `noValidate` hands validation to the shared rules above, so the
          endpoint and the form report the same problems in the same words
          instead of the browser reporting its own in parallel. The `method`
          and `action` are never used by the submitting path — they exist so a
          submission that somehow escapes it cannot become a GET carrying the
          fields in the URL. */}
      <form
        method="post"
        action="/api/contact"
        onSubmit={handleSubmit}
        noValidate
        className="space-y-6"
      >
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
                <span aria-hidden="true" className="ml-0.5 text-foreground/60">
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
                  className="mt-2 text-sm text-red-700 dark:text-red-400"
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
          makes a value in it evidence rather than a guess. `aria-hidden` is
          safe here precisely because the field is never part of the task a
          person is performing.
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

        <section
          aria-labelledby={`${formId}-privacy`}
          className="rounded-md border border-black/10 p-4 text-sm text-foreground/70 dark:border-white/15"
        >
          <h2 id={`${formId}-privacy`} className="font-medium text-foreground">
            {labels.privacyTitle}
          </h2>
          <dl className="mt-3 space-y-2">
            {(
              [
                [labels.privacyCollected, privacyNotice.collected],
                [labels.privacyPurpose, privacyNotice.purpose],
                [labels.privacyRecipient, privacyNotice.recipient],
                [labels.privacyRetention, privacyNotice.retention],
              ] as const
            ).map(([term, description]) => (
              <div key={term} className="sm:flex sm:gap-2">
                <dt className="font-medium text-foreground sm:min-w-32">
                  {term}
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <button
          type="submit"
          disabled={!hydrated || status.kind === "submitting"}
          className="rounded-md bg-foreground px-5 py-2.5 font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
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

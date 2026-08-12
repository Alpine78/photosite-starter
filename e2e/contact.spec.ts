import type { Locator, Page } from "@playwright/test";
import { contactSinkFailureAddress } from "@/lib/contact-delivery-sink";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The contact journey: a visitor fills the form, submits it, and is told
 * accessibly what happened — whether the message got through or not.
 *
 * Everything runs against the sink delivery adapter selected in
 * `harness-environment.ts`, so the real route, the real request boundary, the
 * real validation, the real failure classification, and the real response
 * contract are exercised while nothing leaves the machine. No credential is
 * configured, no provider is reached, and no real mailbox is involved, which is
 * what makes it safe to publish a failure trace.
 *
 * **How a failure is produced.** The sink reports a chosen delivery failure for
 * a reply-to address on the reserved `delivery-failure.test` domain, so the
 * failure states are reached by typing an address rather than by breaking the
 * deployment or stubbing the endpoint. The endpoint still runs end to end: what
 * the visitor is told is the route's own answer, not the test's. See
 * `src/lib/contact-delivery-sink.ts` for why that cannot happen to a real
 * enquiry or in a production deployment.
 *
 * Fields are located by the form control names the application owns, never by
 * their labels: a clone rebrands its UI language, and a journey that asserted
 * on "Name" would fail the moment it ran in another one. Where wording is
 * unavoidable — which advice a failure gives — the built-in label is imported
 * rather than written out, so a translation cannot silently change what this
 * gate means. Every address uses a reserved domain that resolves nowhere, so a
 * retained screenshot contains nothing that could belong to a person.
 */

/** Application-owned route, not authored content: safe to name here. */
const CONTACT_PATH = "/contact";

/** The unprefixed route under test belongs to the harness's default locale. */
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).contact;

const SYNTHETIC_ENQUIRY = {
  name: "Harness Visitor",
  email: "visitor@harness.test",
  message: "Automated public-journey check. No reply is expected.",
} as const;

type EnquiryField = keyof typeof SYNTHETIC_ENQUIRY;

function field(page: Page, name: EnquiryField): Locator {
  return page.locator(`[name="${name}"]`);
}

/**
 * Scoped to the form: the compact layout also renders a menu button, and a
 * journey that runs on both viewports must mean the same control in each.
 */
function submitButton(page: Page): Locator {
  return page.locator("form").getByRole("button", { name: /\S/ });
}

/**
 * Both scoped to the page's own content: Next.js keeps a route announcer in the
 * document that also carries `role="alert"`.
 */
function errorSummary(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

function deliveryOutcome(page: Page): Locator {
  return page.getByRole("main").getByRole("status");
}

async function openContactForm(page: Page): Promise<void> {
  await page.goto(CONTACT_PATH, { waitUntil: "domcontentloaded" });
  // The button is disabled until the form is listening, and a click before
  // then would be a native submission rather than the journey under test.
  await expect(submitButton(page)).toBeEnabled();
}

async function fillEnquiry(
  page: Page,
  enquiry: Record<EnquiryField, string>,
): Promise<void> {
  for (const [name, value] of Object.entries(enquiry)) {
    await field(page, name as EnquiryField).fill(value);
  }
}

type DeliveryAttempt = {
  readonly status: number;
  /** The idempotency key the page sent with this attempt. */
  readonly submissionId?: string;
  readonly correlationId?: string;
  readonly retryable?: boolean;
};

/**
 * The submission identifier out of a request body, and nothing else out of it.
 *
 * The body also carries what the visitor wrote. Only the key is lifted from it,
 * so an assertion message or a retained trace built from these records holds an
 * opaque identifier rather than the enquiry itself.
 */
function readSubmissionId(postData: string | null): string | undefined {
  if (postData === null) return undefined;

  try {
    const sent: unknown = JSON.parse(postData);
    if (typeof sent !== "object" || sent === null) return undefined;

    const { submissionId } = sent as { submissionId?: unknown };
    return typeof submissionId === "string" ? submissionId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every submission the page sent, as the endpoint answered it.
 *
 * Recorded from the responses rather than read back out of the banner, because
 * the banner is unmounted while a submission is in flight: an assertion that
 * watched it change could pass against the gap instead of against the new
 * answer. Counting attempts is also the only way to tell a retry that reached
 * the endpoint from one that merely redisplayed the last result.
 *
 * The request is read through the response, so each answer stays paired with
 * the body that provoked it — which is what lets a test check that a retry
 * carried the *same* key rather than merely that it happened.
 */
function recordDeliveryAttempts(page: Page): DeliveryAttempt[] {
  const attempts: DeliveryAttempt[] = [];

  page.on("response", (response) => {
    const request = response.request();
    if (request.method() !== "POST") return;
    if (new URL(response.url()).pathname !== "/api/contact") return;

    const submissionId = readSubmissionId(request.postData());

    void response
      .json()
      .catch(() => ({}))
      .then((body: { correlationId?: string; retryable?: boolean }) => {
        attempts.push({
          status: response.status(),
          submissionId,
          correlationId: body?.correlationId,
          retryable: body?.retryable,
        });
      });
  });

  return attempts;
}

test("a visitor can submit the contact form and is told it was sent", async ({
  page,
  externalRequests,
}) => {
  await test.step("the contact route renders a labelled form", async () => {
    await openContactForm(page);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Every control a visitor fills has to carry an accessible name, whatever
    // language the deployment renders it in.
    for (const name of ["name", "email", "message"] as const) {
      await expect(field(page, name)).toHaveAccessibleName(/\S/);
    }

    // The hidden field is reachable by neither sight nor keyboard, which is
    // what makes a value in it evidence rather than a guess.
    await expect(page.locator('[name="company"]')).toBeHidden();
  });

  await test.step("an incomplete submission is reported before it is sent", async () => {
    await submitButton(page).click();

    const summary = errorSummary(page);
    await expect(summary).toBeVisible();
    // Focus moves to the summary, so the reason is the next thing announced.
    await expect(summary).toBeFocused();

    await expect(summary.getByRole("link")).toHaveCount(3);
    await field(page, "name").fill(SYNTHETIC_ENQUIRY.name);
    // Editing one field removes only that field's stale error. The remaining
    // problems stay announced and linked until the visitor addresses them.
    await expect(summary.getByRole("link")).toHaveCount(2);
  });

  await test.step("a complete submission reports success accessibly", async () => {
    await fillEnquiry(page, SYNTHETIC_ENQUIRY);
    await submitButton(page).click();

    const outcome = deliveryOutcome(page);
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText(labels.successTitle);

    // A sent message is cleared, so the next visitor to this tab does not
    // resend it and a retained screenshot holds no submitted content.
    await expect(field(page, "message")).toHaveValue("");

    // Once the visitor starts another enquiry, the previous message's outcome
    // must not remain over the new form state.
    await field(page, "name").fill(SYNTHETIC_ENQUIRY.name);
    await expect(outcome).toBeHidden();
    await field(page, "name").fill("");
  });

  // The endpoint is the site's own. Delivery happens server-side, so the
  // browser reaches no third-party origin even while sending an enquiry.
  expect(externalRequests).toEqual([]);
});

test("an unusable address is reported against the field that caused it", async ({
  page,
}) => {
  const attempts = recordDeliveryAttempts(page);
  await openContactForm(page);

  await fillEnquiry(page, {
    ...SYNTHETIC_ENQUIRY,
    email: "harness.visitor.at.example",
  });
  await submitButton(page).click();

  const summary = errorSummary(page);
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();

  // One field is wrong, so one problem is listed. A summary that reported the
  // filled fields too would make the visitor hunt for the real one.
  const problems = summary.getByRole("link");
  await expect(problems).toHaveCount(1);

  const email = field(page, "email");

  await test.step("the field carries its own state and its own message", async () => {
    await expect(email).toHaveAttribute("aria-invalid", "true");
    for (const name of ["name", "message"] as const) {
      await expect(field(page, name)).toHaveAttribute("aria-invalid", "false");
    }

    // The field names the element describing it, and that element says
    // something — an `aria-describedby` pointing at nothing is worse than none.
    const describedBy = await email.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    // An attribute selector, because React's generated ids are not bare CSS
    // identifiers and would have to be escaped in one.
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/\S/);
  });

  await test.step("the summary takes the visitor to the field to fix", async () => {
    await expect(problems).toHaveAttribute(
      "href",
      `#${await email.getAttribute("id")}`,
    );

    await problems.click();
    await expect(email).toBeFocused();
  });

  await test.step("correcting it clears the report and lets the message through", async () => {
    await email.fill(SYNTHETIC_ENQUIRY.email);
    await expect(summary).toBeHidden();
    await expect(email).toHaveAttribute("aria-invalid", "false");

    await submitButton(page).click();
    await expect(deliveryOutcome(page)).toContainText(labels.successTitle);
  });

  // The address never reached the endpoint: the form and the endpoint run the
  // same rules, and the form answers immediately rather than spending a request
  // to be told what it already knew.
  await expect.poll(() => attempts.map((attempt) => attempt.status)).toEqual([
    200,
  ]);
});

test("a delivery failure that may pass later is announced, referenced, and retried", async ({
  page,
  externalRequests,
}) => {
  const attempts = recordDeliveryAttempts(page);
  await openContactForm(page);

  const sendLabel = labels.submit;
  await expect(submitButton(page)).toHaveText(sendLabel);

  await fillEnquiry(page, {
    ...SYNTHETIC_ENQUIRY,
    email: contactSinkFailureAddress("provider-unavailable"),
  });
  await submitButton(page).click();

  const outcome = deliveryOutcome(page);

  await test.step("the visitor is told, is given a reference, and is offered a retry", async () => {
    await expect(outcome).toBeVisible();
    // Focus moves to the outcome, so a failure is not left silently below the
    // button that caused it.
    await expect(outcome).toBeFocused();
    await expect(outcome).toContainText(labels.errorRetryable);

    // A reference a person can quote when asking what happened. It is the only
    // thing the endpoint logged about the attempt.
    await expect(outcome.locator("code")).toHaveText(/\S/);

    // The button stops saying "send" and starts offering the retry, because a
    // failure that waiting can fix is a different offer from a first attempt.
    await expect(submitButton(page)).toHaveText(labels.retry);

    await expect
      .poll(() => attempts.map((attempt) => attempt.status))
      .toEqual([503]);
    expect(attempts[0].retryable).toBe(true);
    expect(attempts[0].submissionId).toEqual(expect.stringMatching(/\S/));
  });

  await test.step("retrying resends the same message under the same key", async () => {
    await submitButton(page).click();

    await expect.poll(() => attempts.length).toBe(2);
    await expect(outcome).toContainText(labels.errorRetryable);

    const [first, second] = attempts;

    // Each attempt is correlated on its own, so two references that differ are
    // proof the retry reached the endpoint instead of repeating what the page
    // already held.
    expect(second.correlationId).toEqual(expect.stringMatching(/\S/));
    expect(second.correlationId).not.toBe(first.correlationId);
    await expect(outcome.locator("code")).toHaveText(second.correlationId!);

    // The key, by contrast, must not change. It is what a provider de-duplicates
    // a retry on, and it is the only thing standing between a message that timed
    // out after the provider accepted it and a second copy of that message in the
    // owner's mailbox. A retry that minted a fresh key would still pass every
    // assertion above while quietly losing that protection.
    expect(second.submissionId).toBe(first.submissionId);
  });

  await test.step("correcting the address starts a new message that gets through", async () => {
    await field(page, "email").fill(SYNTHETIC_ENQUIRY.email);
    // Editing after a failure is a new message, so neither the old outcome nor
    // the retry it offered may stand over it.
    await expect(outcome).toBeHidden();
    await expect(submitButton(page)).toHaveText(sendLabel);

    await submitButton(page).click();
    await expect(outcome).toContainText(labels.successTitle);
    await expect
      .poll(() => attempts.map((attempt) => attempt.status))
      .toEqual([503, 503, 200]);

    // The other half of the contract: an edited message is a different message
    // and must not be de-duplicated against the one before it, or correcting a
    // mistake would be answered with the delivery of the mistake.
    const [first, , third] = attempts;
    expect(third.submissionId).toEqual(expect.stringMatching(/\S/));
    expect(third.submissionId).not.toBe(first.submissionId);
  });

  // A failed delivery is the endpoint's business. It must not become a request
  // the browser makes to anyone else.
  expect(externalRequests).toEqual([]);
});

test("a delivery failure a retry cannot fix points the visitor at the direct address", async ({
  page,
  externalRequests,
}) => {
  const attempts = recordDeliveryAttempts(page);
  await openContactForm(page);

  await fillEnquiry(page, {
    ...SYNTHETIC_ENQUIRY,
    email: contactSinkFailureAddress("provider-rejected"),
  });
  await submitButton(page).click();

  const outcome = deliveryOutcome(page);
  await expect(outcome).toBeVisible();
  await expect(outcome).toBeFocused();
  await expect(outcome).toContainText(labels.errorPermanent);

  // No retry is offered, because pressing it again would fail again. Offering
  // one would be the wrong advice, not merely a redundant one.
  await expect(submitButton(page)).toHaveText(labels.submit);

  // The advice is to write directly, so the page has to carry somewhere to
  // write to — the visitor should not have to go looking for it.
  await expect(
    page.getByRole("main").locator('a[href^="mailto:"]').first(),
  ).toBeVisible();

  await expect
    .poll(() => attempts.map((attempt) => attempt.status))
    .toEqual([502]);
  expect(attempts[0].retryable).toBe(false);
  expect(attempts[0].correlationId).toEqual(expect.stringMatching(/\S/));

  expect(externalRequests).toEqual([]);
});

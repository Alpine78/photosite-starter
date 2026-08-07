import { expect, test } from "./support/fixtures";

/**
 * The contact journey: a visitor fills the form, submits it, and is told
 * accessibly what happened.
 *
 * It runs against the sink delivery adapter selected in
 * `harness-environment.ts`, so the real route, the real request boundary, the
 * real validation, and the real response contract are exercised while nothing
 * leaves the machine. No credential is configured and no real mailbox is
 * involved, which is what makes it safe to publish a failure trace.
 *
 * Fields are located by the form control names the application owns, never by
 * their labels: a clone rebrands its UI language, and a journey that asserted
 * on "Name" would fail the moment it ran in another one. The synthetic values
 * use the reserved `.test` domain, so a retained screenshot contains no
 * address that could belong to a person.
 *
 * Deliberately a smoke test. Delivery-failure responses, retry behavior, and
 * the full accessible error contract belong to AB#89, which extends this file
 * as its own story.
 */

const CONTACT_PATH = "/contact";

const SYNTHETIC_ENQUIRY = {
  name: "Harness Visitor",
  email: "visitor@harness.test",
  message: "Automated public-journey check. No reply is expected.",
};

test("a visitor can submit the contact form and is told it was sent", async ({
  page,
  externalRequests,
}) => {
  await test.step("the contact route renders a labelled form", async () => {
    await page.goto(CONTACT_PATH, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Every control a visitor fills has to carry an accessible name, whatever
    // language the deployment renders it in.
    for (const field of ["name", "email", "message"]) {
      await expect(page.locator(`[name="${field}"]`)).toHaveAccessibleName(
        /\S/,
      );
    }

    // The hidden field is reachable by neither sight nor keyboard, which is
    // what makes a value in it evidence rather than a guess.
    await expect(page.locator('[name="company"]')).toBeHidden();
  });

  await test.step("an incomplete submission is reported before it is sent", async () => {
    // Scoped to the form: the compact layout also renders a menu button, and a
    // journey that runs on both viewports must mean the same control in each.
    const submit = page.locator("form").getByRole("button", { name: /\S/ });
    await submit.click();

    // Scoped to the page's own content: Next.js keeps a route announcer in the
    // document that also carries `role="alert"`.
    const summary = page.getByRole("main").getByRole("alert");
    await expect(summary).toBeVisible();
    // Focus moves to the summary, so the reason is the next thing announced.
    await expect(summary).toBeFocused();
  });

  await test.step("a complete submission reports success accessibly", async () => {
    await page.locator('[name="name"]').fill(SYNTHETIC_ENQUIRY.name);
    await page.locator('[name="email"]').fill(SYNTHETIC_ENQUIRY.email);
    await page.locator('[name="message"]').fill(SYNTHETIC_ENQUIRY.message);

    await page.locator("form").getByRole("button", { name: /\S/ }).click();

    const outcome = page.getByRole("main").getByRole("status");
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText(/\S/);

    // A sent message is cleared, so the next visitor to this tab does not
    // resend it and a retained screenshot holds no submitted content.
    await expect(page.locator('[name="message"]')).toHaveValue("");
  });

  // The endpoint is the site's own. Delivery happens server-side, so the
  // browser reaches no third-party origin even while sending an enquiry.
  expect(externalRequests).toEqual([]);
});

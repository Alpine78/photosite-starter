# Proof selection data flow

What a proof gallery and its customer's selection hold, where the data goes, who can
see it, how long it lives and how it is deleted. Written for the person who has to
answer those questions about a running deployment — the site owner, a customer who
asks, and the AB#117 launch review. It is the operational record behind the
customer-facing privacy notice, not the notice itself and not legal advice.

It records the **reference deployment**. A clone configures its own accounts and owns
its own version of this file. Decisions: [ADR-0038](adr/0038-proof-selection-in-existing-sanity.md)
(accepted 2026-10-22, with its amendments and implementation notes). Work item: AB#130.

**Status, 2026-10-23:** every part below is implemented and **default-off**. Nothing is
active until the owner's activation decision and the pre-activation checks in
[Before activation](#before-activation).

## What is stored

Everything lives in the deployment's existing Sanity dataset. There is no other
database and no cookie; the customer is identified only by holding the selection link.

| Record | ID | Contents | Visibility |
| --- | --- | --- | --- |
| Proof gallery | `<id>` (and `drafts.<id>` while edited) | Title, availability and deadline, the watermarked web proofs, each proof's **complete original filename**, alt text, proof numbers, the permanent link handle, an optional weak link to the replacing delivery gallery | **Public document and public image files**, like delivery galleries (ADR-0034). The site shows no filename, but the document and the files' own stored names and metadata are readable through the public API |
| Private terms | `proofTerms.<id>` | Job reference, prices (included count, additional-image price, currency), first publication and later publication times, the selection key's hash and an AES-256-GCM copy of the key, reminder settings (delay, **customer email address and language** while reminders are on, who stopped them, resume cutoff), write and claim timestamps | Private ID: readable only with an authenticated request |
| Working selection | `proofSelection.<id>` | State (open or confirmed), latest confirmed version, the selected proof numbers | Private |
| Confirmed versions | `proofSelection.<id>.v<n>` | Confirmation time, the gallery revision confirmed against, the terms and totals at confirmation, each selected proof's number and **complete original filename** | Private |
| Photographer notices | `proofNotice.<id>.v<n>` | Email state, times, a closed failure class; a weak link to the version | Private |
| Reminders | `proofReminder.<id>.<n>` | Step number, due/created/attempted times, state, a closed failure class — never the address | Private |
| Reminder cursor | `proofReminderCursor.daily` | The ID where the next daily run continues | Private; shared by all galleries |

**Who can read the private records:** every member of the Sanity project, as the owner
decided (ADR-0038 owner answers 1), and the site's server credentials described in
[sanity-setup.md](sanity-setup.md#proof-gallery-publication-ab130-adr-0038). The browser
receives only the gallery's display data and, on a page opened with a valid key, the
customer's own working selection and the price terms — never the job reference, the
address or key material.

**The selection key** travels in the link's fragment (`#select=…`), which browsers do not
send in requests; the page sends it in a same-origin POST body. The site stores only its
hash and the encrypted copy, which needs the server-only `PROOF_SELECTION_KEY_SECRET` to
open. The encrypted copy stays after reminders are switched off; rotating the key replaces
both.

## The customer's email address

- Stored only when the photographer switches reminders on, at first publication or later
  in **Reminder settings**.
- Removed, with the language, when the photographer switches reminders off or the
  customer uses the stop link in a reminder.
- **Not removed by a confirmation.** A confirmed version stops reminders for good, but
  the address stays in the terms until reminders are switched off or the gallery is
  deleted. Switch reminders off after a confirmation to remove it sooner.

## Where it goes

| Party | Role | Data it sees | Retention |
| --- | --- | --- | --- |
| **Sanity** (content store) | Processor for every record above | All of it, including document history and backups | Active records until deleted (below). Document history and backups follow Sanity's own retention for the project's plan; deletion does not purge them |
| **Vercel** (hosting) | Processor for the site and the daily reminder cron | Requests transiently in memory; request metadata (path including the gallery handle, status, IP address, user agent); application logs below | As in [contact-data-flow.md](contact-data-flow.md#processors) |
| **Resend** (delivery) | Processor for both emails | The photographer notice (gallery ID, job reference, version, time, counts, prices, proof numbers and original filenames) and the customer reminder (address, gallery title, publication date, the selection and stop links **including the key**) | Provider policy as in [contact-data-flow.md](contact-data-flow.md#processors) |
| **Recipient mailboxes** | The owner's mailbox (notices, reminder replies) and the customer's own mailbox | The whole email | The owner's mailbox follows the owner's own retention; the customer's is outside the deployment's control |

## Application-emitted logs

Each line carries a random correlation ID and a closed state or outcome class:
`proof.publication`, `proof.selection`, `proof.notice`, `proof.reminder`, and
`[proof-gallery] malformed-content`. No address, key, link, filename, job reference,
price or provider response is written. Sanity and Vercel keep their own request and audit
metadata, outside the application's control.

## Retention and deletion

The owner set the retention on 2026-10-22: **confirmed versions and the other private
records are kept until the proof gallery is deleted** (ADR-0038 decision 7, owner answers
3). There is no automatic deletion and no deletion schedule; page availability and the
deadline only stop access and writes.

**Deleting a proof gallery** is a Studio action on the gallery: **Delete proof gallery and
its records / Poista vedosgalleria ja sen tiedot**, available when the Studio has proof
galleries enabled. Native delete stays removed, because it would leave the private
records behind.

1. Opening the action reads, fresh from the Doc API with the editor's own session, the
   terms first, then the gallery and its draft, the working selection, every version and
   notice up to the latest version, every reminder step any clock could have reached, and
   the image assets the gallery and its draft use. It lists counts only.
2. It refuses rather than guesses when a record cannot be read, a record is malformed,
   any record has a draft or a release version, the query index shows a record of the
   gallery outside the list, or other content references a record in it.
3. The editor types the gallery's document ID to confirm. A reload clears it.
4. One transaction deletes every listed document at the revision shown, guarded by the
   terms revision read first, and asserts that an absent gallery, draft, terms or selection
   is still absent. The same transaction then deletes the gallery's image assets — which
   deletes the files — except an asset the query index shows another document using; that
   one is kept and counted separately (owner decision 2026-10-24). A customer confirmation, reminder claim, publication or new draft that
   lands in between makes the deletion conflict and delete nothing; one that lands after
   it fails, because its own guarded terms write finds no terms. The transaction is sent
   once with retries off: a conflict asks for a fresh review, and a lost answer is an
   unknown outcome to check by reloading, not to retry blindly.
5. Afterwards the customer page and selection route treat the handle as unknown. The
   reminder-stop page is generic and still renders, but its button is refused. The shared
   reminder cursor is left as it is.

**What deletion does not do:**

- **Copies of the images stay where they are.** Images already downloaded, forwarded or
  copied are outside the deployment's reach, and Sanity's CDN may serve a deleted file from
  its cache for a while. An image another document uses is kept (the ADR-0034 shared-use
  check); if such a use appears after the review, Content Lake refuses to delete the still
  referenced asset, so the whole transaction fails and nothing is deleted.
- **History and backups stay.** Sanity keeps earlier revisions of deleted documents for
  its history retention; purging history is a separate, higher-permission operation that
  this action does not perform.
- **Emails cannot be withdrawn.** A notice or reminder already handed to Resend — or being
  sent at the moment of deletion — is delivered; its later status write fails instead of
  recreating a record. Resend's and the mailboxes' own retention apply.

## Before activation

Owner actions, recorded so they are not lost; none is performed by the code:

- The customer-facing privacy notice names the proof page, the selection, the optional
  reminder email and its address, the processors above and the retention above.
- The hosted-Studio checks in [sanity-setup.md](sanity-setup.md#proof-gallery-publication-ab130-adr-0038),
  including reading private dotted IDs and
  [running this deletion on a test gallery](sanity-setup.md#deleting-a-proof-gallery-ab130-adr-0038-decision-7).
- Live Resend delivery and one live cron run, as listed in
  [deployment.md](deployment.md).

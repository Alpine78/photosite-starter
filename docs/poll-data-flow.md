# Article poll voting data flow (AB#162)

This is the reference deployment's processing record. Each clone owns its own
Sanity project, credentials and copy of this record. The storage and request
boundary are recorded in [ADR-0018](adr/0018-article-poll-voting-storage-and-dedup.md),
including its dated implementation-review amendment.

## Data and processors

The POST accepts exactly `pollId` and `optionId`, both bounded identities. It
accepts no name, email or free text. A poll-specific random cookie associates
retries with the same vote. There is no login, fingerprint, analytics or
cross-poll visitor identifier.

The application on Vercel reads this deployment's own Sanity project and sends
one transaction containing a plain receipt `create`, lazy tally creation, and
a `setIfMissing` + atomic `inc` on the selected count. A receipt conflict aborts
the entire transaction. A tally failure also rolls back the receipt.
**Vercel and Sanity are service providers in this flow**; customer ownership of
the Sanity account does not make Sanity cease to be an external processor.

## Stored records and retention

| Record | Contents | Retention |
| --- | --- | --- |
| `poll` | Question, language, stable option IDs/labels and close date | For as long as the owner keeps the authored content |
| `pollTally` | Poll ID and aggregate per-option counts | For as long as the owner keeps the poll |
| `pollVoteReceipt` | Poll ID and an ID derived by SHA-256 over the poll ID and random token | Indefinitely; automatic cleanup is not implemented |

The receipt carries **neither the raw cookie nor the chosen option or timestamp**.
Poll tokens are independent; receipt IDs cannot be used to link votes across
polls. They are pseudonymous duplicate-prevention records, not proof of a
person's identity. Counts and receipts in a **public dataset are readable
through its API**, even though their types have no Studio schema. Studio
invisibility is an authoring constraint, not access protection.

## Poll-specific cookie

| Property | Contract |
| --- | --- |
| Name | `poll_voter_` plus a deterministic 32-hex digest of the poll ID |
| Value | Independent 256-bit CSPRNG token, canonical unpadded base64url |
| Attributes | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/poll-vote`, no `Domain` |
| Duration | Up to one year after preparation or a successful vote/retry |
| Set | Only after the visitor activates Vote: a protected preparation GET establishes it before the POST, and a successful POST refreshes it |
| Read | GET/POST on `/api/poll-vote` for this poll only |

Ordinary page views and result reads **set no cookie**, nor does viewing a
closed historical poll. Preparation requires `prepare=1` plus a non-simple
`X-Poll-Prepare: 1` header; browsers need a CORS preflight to send that header
across origins, and this route grants no CORS access. Sec-Fetch-Site also
rejects cross-site preparation when supplied.

The engineering necessity basis is the **one-vote interaction the visitor
explicitly requested**: establish a stable token before recording an anonymous
vote and recognize its retries after a response is lost. The token is not used
to follow browsing or relate separate polls. This is the project's basis for
using a necessary functional cookie without a banner, rather than a claim that
all functional cookies are exempt. [Traficom's guidance](https://kyberturvallisuuskeskus.fi/fi/toimintamme/saantely-ja-valvonta/evasteet)
limits the exception to storage necessary for a service the user explicitly
requested. The launch review must assess the actual deployment and lifetime.

## Request, rendering and logging boundaries

- POST requires same-origin JSON, a closed two-field allow-list, a body no
  larger than 1 KiB, validated IDs and an established poll cookie. No cookie
  means `409 voter-not-ready`, with **no vote written**.
- Poll existence, option membership and `now >= closeDate` are checked before
  writing. Malformed or ambiguous CMS content fails closed.
- GET returns fresh counts, percentages and cookie-specific receipt state.
  Responses and Sanity poll reads use `no-store`, without CORS headers.
- A separate best-effort **process-local** limiter bounds vote traffic; the
  result-read limiter is also local. Neither guarantees a deployment-wide
  rate limit (the same limit described by `contact-rate-limit.ts`).
- The runtime-only `SANITY_POLL_VOTE_TOKEN` is distinct from read, build, seed
  and migration credentials. A `NEXT_PUBLIC_` mirror is refused. Plan-dependent
  credential scope is described in [Sanity setup](sanity-setup.md).
- Server-rendered results, including historical counts, work without script.
  Voting requires hydration; the shared submission guard disables native
  submission and synchronously prevents a second in-flight submission.
- Operational vote events contain a random correlation ID, state and a closed
  error class. They carry no poll/option IDs, token or provider response.

## Limits and owner-run checks

Clearing the cookie or changing browsers permits another vote. These are
informal reader polls; anonymous dedup cannot establish one vote per person.
Cookie expiration has the same effect on a poll still open after one year.
Independent first-time preparations from separate forms or tabs can establish different
tokens before either round-trips; the guard protects one form, not every tab.
Eligibility is checked after reading the poll and before writing; concurrent
editor changes between that read and the transaction are not revision-locked.

Before launch, provision the actual runtime credential, verify its permissions
and the atomic create/conflict behavior against the owner's dataset, and audit
the imported historical poll pairs. Receipt cleanup remains a recorded follow-up;
no retention worker or cross-instance throttle is claimed here.

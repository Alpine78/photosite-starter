# Single-photographer operations requirements

Refinement worksheet for AB#196 under AB#28 and Feature AB#93. This is a
separate, disabled post-MVP product decision for one photographer deployment.
It is outside the reusable-template commercialization baseline. No shared SaaS,
multi-tenant database, customer account, financial document or provider is built
or approved by this worksheet.

Before implementation, a dedicated ADR must receive approval for business,
security, privacy, legal, hosting and maintenance obligations. Seller-specific
terms, tax treatment, retention periods and document rules require verified
owner information and qualified advice; this document selects none of them.

## Parent-criteria traceability and decision register

The numbers below follow AB#28's current fifteen acceptance bullets.

| Parent AC | Decision ID | Required question or evidence |
| --- | --- | --- |
| 1 — create/update customer | O1 | Which relationship, contract and billing fields are required, who can edit them, and how are corrections/history and duplicate customers handled? |
| 2 — customer-linked job | O2 | Define customer association, date/date-range timezone, description, agreed price/currency and permitted job statuses/transitions. |
| 3 — customer submits request | O3 | Define the customer's identity/access proof and submission/refusal path. A gallery capability proves possession of a link, not a customer's identity. |
| 4 — administrator records request | O4 | Define administrator authorization and recording after email, telephone or other conversation without pretending the customer submitted it. |
| 5 — request provenance | O5 | Define origin, creator, creation time, linked customer/job and relevant notes; decide permitted source evidence and avoid unnecessary conversation copies. |
| 6 — approved template/delivery/print | O6 | Who approves templates and terms, how are job data and template version bound, and which delivery/print outputs preserve that version? |
| 7 — retained versions/statuses | O7 | Decide approval, signing, amendment and cancellation rules and what version/status evidence is retained before any contract workflow is implemented. |
| 8 — invoice/email/print | O8 | Define required issuer/customer data and the issue/delivery/print lifecycle with owner and qualified reviewers. No invoice or tax format is selected. |
| 9 — advance versus final invoice | O9 | Decide booking-fee and payment-status semantics, how an advance relates to a final invoice and how corrections remain traceable. |
| 10 — cash receipt/email/print | O10 | Define authorized recording, receipt content, correction and delivery/print behavior; do not assume a payment processor is required. |
| 11 — stable numbering/history | O11 | Decide numbering ownership, concurrency, audit trail and correction/cancellation rules. Cross-check AB#95 so image sales cannot define conflicting financial-document rules. |
| 12 — access/retention/deletion | O12 | Define roles, access review, storage/backup/processors, retention and deletion for customer, request, contract and billing data separately. Select no duration or legal basis without evidence. |
| 13 — e-invoice spike first | O13 | A separate technical/commercial spike must verify operator/API, formats, identifiers, costs, delivery tracking and error handling before implementation. |
| 14 — signing clarification first | O14 | A separate spike must clarify legal, identity-verification, audit-trail, provider and cost requirements before selecting a signing path. |
| 15 — disabled/outside MVP | O15 | Decide an explicit enablement mechanism only after prioritization and ADR approval. An environment gate is an option, not a selected design. |

## Additional scope boundaries

Customer accounts do not reuse private-gallery sessions as identity. The existing
private-gallery draft's optional external customer/job references are not domain
records or a relational CRM. [ADR-0014](adr/0014-private-gallery-security-delivery-retention-boundary.md)
keeps private storage behind its own authorization boundary; it does not approve
using that store for operations. Hosting, storage, credentials, operational
recovery and owner maintenance remain O12/O15 decisions, including whether an
external owner-operated tool satisfies the business need better.

Accounting replacement is excluded. Payment processing and automatic bank
reconciliation require separate prioritization. No invoice, e-invoice or signing
provider is chosen. Financial-document and retention questions overlap AB#95's
image-sales decision and [commercial-policy requirements](commercial-policy-requirements.md);
resolve them once at the correct owner boundary before either feature adopts them.

## Unapproved, disabled candidate slices

1. **Business/domain decision:** validate O1–O15 and the separate-product boundary,
   including whether to build it at all; obtain the required ADR approvals.
2. **Customer and job records:** only after approval, one restricted administrator
   workflow with agreed O1/O2/O12 criteria and no customer access assumed.
3. **Request and contract preparation:** separately establish O3–O7 provenance,
   templates, versions, access and delivery/print acceptance criteria.
4. **Financial-document workflow:** define O8–O12 before implementing invoice,
   advance or receipt issuance; retain numbering and auditable corrections.
5. **Separate integration spikes:** O13 and O14 do not inherit approval from any
   earlier slice, and neither starts with a provider integration.

These proposals leave AB#28's runtime requirements unimplemented. The worksheet
is ready for owner refinement; it is not acceptance of contracts or billing code.

# Support and maintenance service proposal (AB#47)

**Status:** proposed scope for validation and owner review; no service agreement or response guarantee exists yet.

## Ownership and operating boundary

A photographer owns the repository fork, domain, CMS project and content, host, mail provider, billing, and backups. A maintainer can receive limited, revocable access to diagnose or perform agreed work. Use named accounts and the least privileges supported by each provider; do not move customer secrets into this repository. The customer's account owner can remove the maintainer and recover operation using the deployment and handoff documents.

| Work | Proposed service responsibility | Customer responsibility |
| --- | --- | --- |
| Routine updates | Review upstream releases, dependencies, build and test result, and deployment plan | Approve changes and pay provider charges |
| Incidents | Triage application failures, recommend rollback or fix, document outcome | Maintain account ownership and emergency access; approve material changes |
| CMS/content | Explain authoring and diagnose schema failures | Author, approve, and own text/media and publication |
| Backups and restore | Check agreed backup evidence and rehearse restore if contracted | Own backup destination and retention choice |
| Domain, DNS, billing | Advise during incidents | Retain registrar, DNS, payment methods, and provider contracts |

## Request and incident path

Use one customer-controlled contact channel and an agreed backup channel. Log the time received, affected URL/function, impact, correlation ID if available, and response. Never paste form content, tokens, signed URLs, or private gallery links into a ticket. Classify severity by customer impact: unavailable public site or broken enquiries; degraded content/editorial flow; cosmetic or advisory issue. A response target, coverage hours, holidays, and any emergency surcharge must be agreed in writing before sale. No unstated 24/7 coverage is implied.

For an outage, first check deployment and provider status, then redacted application events, then recent changes. If a last-known-good deployment exists, follow the customer's rollback runbook and confirm the contact path and public content after recovery. Escalate suspected privacy or credential exposure separately and rotate affected credentials using customer-owned accounts.

## Prerequisites, exclusions, and customization

The base service assumes a supported upstream release, passing repository checks, documented deployment settings, and customer-granted access. It does not include unlimited content entry, custom feature development, third-party provider outages, domain renewal, legal advice, or emergency support outside agreed hours. Core edits in a customer fork can require extra merge and regression work (AB#41); record these patches and quote their maintenance cost before accepting them into coverage.

## Handoff and end of service

Return a current list of access grants, deployment configuration, upstream version, local patches, open incidents, and backup/restore location. The customer revokes maintainer access and retains the site, content, and accounts. No service termination disables MIT Free Core. A separately licensed theme or asset follows its own actual terms (AB#42). The last supported version and any transition period must be stated in the signed offer.

## Validation needed

AB#45 must test which tasks customers actually want to delegate and their budgets. Price, service hours, response targets, liability, refund terms, and account access procedure remain owner decisions. This document is a service-design draft, not a contract.

# Mail recovery evidence worksheet (AB#202)

Copy this blank worksheet into ignored private operator evidence before filling it.
Keep addresses, account identities, backup locations and raw messages there; never
include credentials, recovery codes or API keys even in the completed worksheet.
The worksheet prepares AB#131/118 evidence; it is not proof of a completed restore.

Use two separate rows for the two independent mailbox accounts. An alias or a second
From address does not establish independent login, storage, export or recovery.

| Evidence item | Account A | Account B | Date UTC / source | Owner report or exercised verification | Private evidence reference / unresolved action |
| --- | --- | --- | --- | --- | --- |
| Independent account, login and recovery control | Pending | Pending | Pending | Pending | Pending |
| Folder tree, message counts, flags, timestamps, non-ASCII samples | Pending | Pending | Pending | Pending | Pending |
| Local message copy: durable location, export format, integrity digest | Pending | Pending | Pending | Pending | Pending |
| Restore into an isolated target: folder/message comparison and outcome | Pending | Pending | Pending | Pending | Pending |
| External inbound/outbound, received authentication headers, desktop/mobile | Pending | Pending | Pending | Pending | Pending |
| Current full authoritative DNS zone: export time and integrity digest | Pending | Pending | Pending | Pending | Pending |
| DNS restoration: controlled target, delegation checks, mail record comparison | Pending | Pending | Pending | Pending | Pending |
| Account recovery exercise: approved method, owner access, result | Pending | Pending | Pending | Pending | Pending |
| Remaining legacy SMTP/client/forwarder dependencies | Pending | Pending | Pending | Pending | Pending |
| Quota, recurring cost/VAT, retention, data location, support/export terms | Pending | Pending | Pending | Pending | Pending |

## Independent recovery paths

Message restoration, DNS routing restoration and account access recovery are three
separate checks. Successful delivery and a backup's existence do not prove any of them.
The reference owner reports working migrated mail and saved old messages; record those
as dated owner reports until an isolated restore and comparison have been exercised.
The alternate mailbox/domain's legacy SMTP dependency remains unresolved in AB#131.
The historical partial DNS notes are not a current full-zone export.

Web cutover changes only explicitly approved web records. Preserve MX, SPF, DKIM,
DMARC, verification and mail-access records; check address-dependent SPF authorization
and external received headers independently. Domain registration, authoritative DNS,
mail and web hosting have separate owners and recovery paths.

| Non-mail asset | Durable private location / digest | Export date / source | Restore result / unresolved action |
| --- | --- | --- | --- |
| Complete current DNS zones, before and after approved changes | Pending | Pending | Pending |
| Joomla archive and database | Pending | Pending | Pending |
| Legacy customer-gallery archive | Pending | Pending | Pending |
| Both local mailbox copies (separate references) | Pending | Pending | Pending |

Follow the [deployment and handoff runbook](deployment.md) and
[promotion and rollback runbook](deployment.md#promotion-and-rollback) for commands and
responsibilities. Record missing evidence and a responsible operator explicitly;
do not close AB#131 from this form or assume provider contracts, costs or retention.

## AB#131 operational handoff checkpoint — 2026-10-15

AB#131 remains Active. This reconciles the authoritative discussion through
October 4; it is not a fresh mailbox/DNS/account check. Keep completed evidence
private and use separate Account A/B records above. Do not repeat imports or
change DNS merely because a historical checklist says they were pending.

| Area | Dated evidence in AB#131 | Remaining owner verification |
| --- | --- | --- |
| Separate target mailboxes | October 4: two separate Infomaniak organizations/mailboxes shown; owner reported both imports complete and the first mailbox's transition messages copied. | Inventory both logins, folder trees, counts, flags, timestamps and non-ASCII samples; preserve final reconciliation receipts. An import-complete report is not an isolated restore. |
| Authoritative DNS | October 4: parent delegation for the migrated zone and 16 preservation records verified at DigitalOcean; subsequent provider MX/SPF/DKIM and DMARC publication recorded. | Export complete current zones for both domains to durable private storage; compare every required record, including autodiscover and unrelated records. The original staging set was not a full-zone restore test. |
| Message authentication | October 4: owner-supplied Gmail received headers for both domains show SPF, DKIM and DMARC passing; DMARC was monitoring-only (`p=none`). | Fresh delivery across the required external providers and both desktop/mobile clients, with private received-header receipts. Do not equate published DNS with authentication on a message. |
| Device delivery | October 4: owner reported phone and Windows Thunderbird sending/receiving for the second mailbox; first-mailbox Thunderbird sending was reported. | Complete the per-account device/provider matrix; first-mailbox mobile outbound evidence is not supplied by the two Thunderbird/Gmail checks. |
| Local mail recovery | Existing owner reports describe copies/imports. | Locate both durable local exports, record format/digest, then exercise an isolated restore and compare folders/messages. No fresh restore was performed by this reconciliation. |
| Other SMTP dependencies | October 4 investigation found a third-domain account submitted through the old provider; relationship to the expiring contract remains unknown. | Inventory remaining clients, identities, forwarders and the contract boundary before treating the legacy provider as dispensable. |
| Ownership and contract | Provider selection progressed to actual Infomaniak accounts. | Record actual plan/renewal cost, VAT, quota/headroom, data location, support/export, owner recovery and backup operator privately. Historical candidate prices are not a selected-plan quote. |
| Legacy web hotel | Owner's September 15 decision specifies non-renewal and the October 15 end date, with local-data and owner-controlled-DNS recovery. | Confirm actual service status, cancellation mechanism and deletion date; preserve current Joomla/gallery/mail recovery evidence. The date alone proves neither termination nor data deletion. |

For a current read-only DNS check, run these with owner-selected values in a
private operator terminal; retain answers privately rather than copying raw zones
or addresses into a PR:

```sh
dig NS "$mail_domain"
dig +short MX "$mail_domain"
dig +short TXT "$mail_domain"
dig +short TXT "${dkim_selector}._domainkey.${mail_domain}"
dig +short TXT "_dmarc.${mail_domain}"
```

Query each intended authoritative nameserver directly as well, using
`dig @"$authoritative_nameserver" ...`. Record the observation time and compare
against the actual approved provider records; placeholders are not DNS values.
A DNS read is not an instruction to change MX, tighten DMARC or remove old records.
Do not increase the monitoring-only DMARC policy without a separately reviewed
sender inventory and owner decision.

Recover message data into an isolated target, routing through the owner-controlled
DNS, and account access through the provider's recovery process as separate
exercises. Do not rely on continued legacy hosting as rollback after its scheduled
end. A recovered code deployment cannot restore missing mail or deleted files.

The [AB#250 availability readback](audits/ab250-release-verification-2026-10-12.md#production-readback--2026-10-15)
establishes retained gallery page availability only; it does not replace the
backup, byte-integrity or restore checks required for legacy-host retirement.
No mail was sent, mailbox opened, DNS/provider setting changed or retirement
accepted by this documentation slice.

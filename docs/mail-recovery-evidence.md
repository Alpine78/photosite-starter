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

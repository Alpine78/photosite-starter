# Commercial licence and sales-policy requirements (AB#49)

**Status:** requirements draft for owner, legal and tax review; not legal advice,
operative terms or permission to start selling.
**Evidence checked:** 2026-10-05. Recheck law and guidance before offering payment.

AB#45 has not validated a segment or offer; its existing
[offer-validation plan](offer-validation.md) supplies the interview/evidence process. ADR-0024's Free Core/Premium split is
Proposed. This worksheet prepares the questions and evidence needed for AB#49;
it does not choose prices, seller identity, customer classification or a payment
provider. AB#49 stays Active until qualified review and the other acceptance work
are actually complete. A reviewed draft is not a completed legal launch gate.

## Classify the actual offer first

Record the buyer's purpose and country, seller's establishment and tax status, and
each separately priced deliverable. Do not assume that being a photographer or
having a business name proves B2B status; hobbyist, mixed-purpose and uncertain
purchases need professional classification before choosing a contract flow.

| Offer | Required classification and decision |
| --- | --- |
| Separately licensed downloadable theme/software | Assess digital-content rules, compatibility, statutory conformity/updates, delivery consent and licence scope |
| Setup, migration or implementation | Define service milestones, acceptance, change control, customer cooperation, early-start request and applicable cancellation treatment |
| Theme plus setup/service bundle | Classify each component and the overall agreement; no blanket digital-download waiver for all services |
| Optional maintenance | State duration, renewal/termination, supported scope and access; classify ongoing obligations separately |
| Hosting/reselling infrastructure | Separate product/processor and tax review; not implicitly included in setup or maintenance |

**Verified guidance:** EU distance-selling guidance requires clear pre-order trader,
price, delivery and contract information and durable confirmation. Digital-content
functionality and compatibility need disclosure. These are inputs to professional
review of the actual offer, not ready-made terms.
[Your Europe](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm)
(checked 2026-10-05).

For Finnish consumer digital delivery, KKV describes explicit advance consent to
delivery during the withdrawal period, acknowledgment of losing withdrawal rights,
and durable confirmation. A download alone is not this consent record. Services
have a separate early-start/cancellation analysis; do not copy the digital-content
exception to a migration service.
[KKV withdrawal guidance](https://www.kkv.fi/kuluttaja-asiat/verkkokauppa/peruuttamisoikeus-verkkokaupassa/)
(checked 2026-10-05).

Directive (EU) 2023/2673 adds an online withdrawal function for relevant distance
contracts through online interfaces; its application date is 2026-06-19. Ask counsel
to confirm current Finnish implementation and applicability to the chosen channel,
then verify the flow and durable acknowledgment where required. Do not treat a
manual sales process as automatically exempt.
[Directive, Article 11a and Article 2](https://eur-lex.europa.eu/eli/dir/2023/2673/oj/eng)
(checked 2026-10-05).

## Documents and evidence to prepare

The owner supplies facts; qualified reviewers supply legal/tax conclusions. Actual
policy wording is written only after those decisions. Keep customer data and signed
documents outside this public repository.

| Document / evidence | Must state or resolve before sale | Current owner / blocker |
| --- | --- | --- |
| Commercial software/theme licence | Identify proprietary files; source access/modification, deployment count, per-site/per-photographer scope, agency/client use, redistribution, update access and exit rights; name/brand use | Owner + lawyer; AB#42 / AB#45 |
| Free Core and third-party notices | Preserve MIT `LICENSE`/notices; separate proprietary packaging and terms; audit fonts, photographs and dependencies in each paid artifact, including any binary/copyleft obligations | Owner; AB#43 and actual artifact |
| Sale/order terms | Seller legal/trading identity, registration/tax information as applicable, address/contact, product scope, compatibility, total price/tax/currency, payment/delivery timing, confirmation and version of terms | Owner + lawyer/tax adviser; actual segment/channel and AB#45 |
| Service agreement / statement of work | Milestones, scope/exclusions, dependencies, content approval, migration risks/backups, changes, acceptance, provider ownership, access responsibilities and handoff | Owner + lawyer; selected service |
| Support/maintenance schedule | Support contact, covered versions, response expectations, paid scope, renewal/termination and security response; distinguish statutory duties from optional commercial support | Owner + lawyer; [AB#47 scope proposal](support-service-proposal.md) exists (story Closed), actual offer remains open |
| Withdrawal/refund/cancellation process | Consumer/business classification, digital delivery and service start separately, required consent/acknowledgment evidence, statutory remedies versus optional refund promises, withdrawal function if applicable | Lawyer + owner; channel/classification |
| Privacy notice and processing agreements | Own order/customer data controller; classify migration/maintenance access to customer data separately, processor/DPA where applicable, purposes/legal bases, recipients/transfers, retention and rights | Owner + privacy/legal reviewer; processors and service scope |
| Customer handoff / exit | Customer repository/source baseline, hosting/CMS/domain account ownership, notices, export/backup/restore instructions, custom patches, independent rebuild and end-of-service access | Owner; actual delivery/update agreement |
| Complaints / disputes | Trader complaint channel and current applicable Finnish/EU redress information, governing law/jurisdiction reviewed for buyer type; never remove mandatory consumer rights | Lawyer + owner; buyer/country |
| Professional signoff | Review date, qualified reviewer, exact offer/document versions, outstanding conditions and next review trigger; no fictional signoff | Pending legal and tax reviews |

**Verified guidance:** KKV's digital-content guidance distinguishes agreed updates
and statutory conformity obligations. Expiring commercial update access must not
be described as extinguishing mandatory consumer rights.
[KKV digital content](https://www.kkv.fi/kuluttaja-asiat/digitaaliset-sisallot-ja-palvelut/)
(checked 2026-10-05).

## Privacy, credentials and retention questions

Separate the seller's customer/order records from data processed while migrating or
maintaining a customer's site. Determine controller/processor roles for each actual
service and subcontractor. GDPR Article 28 requires an appropriate processor
contract where processing is on a controller's behalf; a general customer privacy
notice is not a substitute.
[GDPR, Article 28](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)
(checked 2026-10-05).

Require a reviewed secure access/share method, least privilege, expiry and revocation
at handoff. Do not put credentials or customer exports in source, sales emails or
this worksheet. Record where operational evidence is kept and who can access it.
Have the tax/legal reviewers determine bookkeeping and invoice retention separately
from support/contact-data minimization; no retention period is guessed here.

## Tax and dispute review questions

Verohallinto distinguishes electronic services principally by automation and limited
human involvement; cross-border treatment depends on buyer status and location.
Do not classify manually delivered implementation services as automated electronic
services solely because communication is online.
[Verohallinto electronic services](https://www.vero.fi/yritykset-ja-yhteisot/yritystoiminta/uusi-yritys/kasvuyritykset/sahkoiset-palvelut-arvonlisaverotuksessa/)
(checked 2026-10-05).

The tax adviser must resolve seller VAT registration, any small-business rules,
place of supply, buyer/VAT-ID evidence, OSS applicability, B2B reverse charge where
applicable, invoice contents, retention and treatment of mixed offers. A Merchant
of Record is not selected by this worksheet and does not resolve the seller's own
service, income-tax or bookkeeping duties by implication (AB#48).

The lawyer must provide the current complaint/redress route, including whether
Finnish consumer advice and the Consumer Disputes Board apply. Do not paste an old
EU ODR-platform clause from a template; verify the current regime. Also assess
applicable digital-content, software update/security, product-liability and
accessibility obligations against the actual artifact/channel and launch date.
This is an applicability question, not a claim that every regime applies.

## Review package and launch gate

Send the actual offer/classification, document drafts, artifact inventory and
proposed order/delivery/withdrawal screens to the lawyer; send those facts plus
buyer countries, pricing/invoice examples and selected payment/provider flow to
the tax adviser. Record their decisions and unresolved questions against the exact
versions. Recheck on changes to segment, artifact, licence, channel, processors,
support scope, buyer country or law.

Before accepting payment, verify the consent and durable-confirmation evidence,
refund/complaint paths, any applicable withdrawal function, notices and access/exit
handoff with synthetic data. Review the separate paid artifact's `LICENSE`/`NOTICE`
boundaries and confirm this repository's MIT notices remain intact. No checkout,
licence enforcement or commercial policy is implemented by this draft.

# Image sales boundary discovery (AB#95)

**Status:** decision preparation; no checkout or sales contract selected.

## Evidence the owner must supply

Record at least one real proposed sale before choosing a platform: who buys (public visitor, event participant, existing client), what is sold (print, processed JPEG, licence, or package), where buyer and seller are located, who fulfils it, and whether the photographer has the rights and releases to offer it. Record expected volume, currency, tax/invoice responsibility, cancellation/refund needs, and whether delivery must be automated. A generic “sell photos” requirement is insufficient to choose a checkout or asset boundary.

## Current boundary

ADR-0002 gives a media identity and placement model. ADR-0005 permits only public web derivatives on public pages; originals and sales/fulfilment assets remain behind a server-only adapter. ADR-0014 grants short-lived protected delivery only to its own private client-gallery capability; it does not authorize sale downloads. An enquiry is a human contact path, not payment or fulfilment.

Keep these independent states in any future model:

| Axis | Examples | Why independent |
| --- | --- | --- |
| Discoverability | Public listing, unlisted, private | Search visibility is not a sale right |
| View permission | Public derivative, capability-protected preview | A visible preview is not a purchased file |
| Sellability | Not offered, offer active, offer retired | A public image may have no sale rights |
| Fulfilment | Manual, print vendor, protected digital delivery | Purchase does not make a master public |

A future offer needs a stable offer/SKU identity, media and product reference, rights/territory/term, price and currency, tax handling, availability, and delivery rule. A transaction needs an auditable payment/fulfilment state without exposing provider payloads or buyer data to public pages. Retention and deletion must be decided for buyer details, receipts, fulfilment files, and abandoned orders before implementation.

## Candidate paths

| Path | Appropriate evidence | Main cost or boundary |
| --- | --- | --- |
| Enquiry-only, manual invoice/delivery | Few bespoke sales or rights checks per order | Human work; no instant checkout |
| Hosted checkout with manual fulfilment | Standard offers, small catalog, provider handles payment UI | Need validated payment callback and order reconciliation |
| Hosted commerce plus fulfilment integration | Repeatable catalog and enough volume to justify integration | More providers, state sync, returns, data retention |
| Own cart/payment flow | Only if hosted paths fail a measured requirement | Highest security, tax, accessibility, and operations burden |

For any provider path, document where buyer data and assets go, who is controller/processor, account ownership, exportability, fees, and how an open order completes after provider exit. The customer must own provider accounts; a clone must be able to omit the sales feature without breaking the public site.

## Decision gate

Start with the real sale cases and compare the four paths against them. Select a path only after rights, tax, refund, invoice, accessibility, privacy, and fulfilment responsibilities have named owners. If no repeated standard sale exists, keep enquiry-only and revisit when evidence changes. A selected checkout/asset contract would need its own ADR because it is costly to reverse. This note makes no provider recommendation and does not extend ADR-0014's private-gallery exception.

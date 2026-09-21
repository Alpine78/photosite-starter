# ADR-0021: Localized static service routes and service hierarchy

**Status:** Accepted
**Date:** 2026-09-20
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#164

## Context

The existing service catalog is intentionally small and generic, but it is
unlocalized: `/services` and `/services/<slug>` are only served in the default
route space. A `service` document consequently has one slug and one set of
authored strings. This was sufficient for the template's first static pages,
but it cannot give a visitor a same-language destination for production
Joomla service URLs such as `/haakuvaus` and `/en/wedding`.

The production migration has three distinct wedding-service intents: a
wedding-photography overview, portraits on location, and a ceremony plus
portrait offering. Sending those visitors to a wedding-gallery category would
preserve neither the service intent nor the language. Keeping one
unlocalized page would publish a Finnish or English visitor into content that
may belong to the other language.

ADR-0003 already reserves localized static routes outside the story namespace,
but it does not define service route segments, service-language identity, or
hierarchical service paths.

## Decision

### Route ownership

Each configured locale owns a deployment-configured static service namespace.
The reference deployment uses `/palvelut` in its unprefixed Finnish route
space and `/en/services` in English. A clone chooses equivalent segments in
its own locale configuration; service route labels are not hard-coded into
generic components or schemas.

The listing is the namespace root. A service detail is addressed by its
published ancestor slug path below that root. Thus a parent service can own
both its own detail page and child detail pages without sharing the story
namespace. Static service namespaces, locale prefixes, and story namespaces
are mutually reserved and validated at startup.

### Localized service identity

A service has an immutable, locale-independent `serviceId`. Every published
locale version carries its own language, slug, text, optional cover and
pricing. A version may be absent in another configured locale; the route,
listing, metadata alternate, language switch, and sitemap then omit that
missing version rather than falling back across languages.

An optional `parentServiceId` establishes the service hierarchy. It references
the parent service identity, not a locale document, so every locale can use
its own localized parent slug. The read boundary rejects a missing parent,
cycle, duplicate sibling slug, or an unpublished ancestor rather than
guessing a path.

### Legacy migration

The initial production targets are:

| Legacy source | Canonical target |
| --- | --- |
| `/haakuvaus` | `/palvelut/haakuvaus` |
| `/haakuvaus/miljoomuotokuvaus` | `/palvelut/haakuvaus/miljoomuotokuvaus` |
| `/haakuvaus/vihkiseremonia-muotokuvaus` | `/palvelut/haakuvaus/vihkiseremonia-ja-miljoomuotokuvat` |
| `/en/wedding` | `/en/services/wedding-photography` |
| `/en/wedding/portraits` | `/en/services/wedding-photography/portraits` |

Each is a direct permanent redirect only after its target is published. The
Joomla inventory contains additional wedding-package URLs; they remain pending
until their reviewed target service is authored. No source is redirected to a
gallery category merely because it is nearby in the old navigation.

### Public presentation

Service cards link through their resolved locale path, not a string assembled
inside the component. Detail pages render same-language breadcrumbs, canonical
metadata, `hreflang` alternates for published translations, the existing
identity-based language switch, service JSON-LD with the resolved canonical
path, and sitemap entries. The Sanity adapter retains the existing public
media projection and rejects malformed CMS values at its server-only boundary.

Production-specific wedding copy and media enter only through the approved
import plan and customer-owned dataset. Fixture services remain generic.

## Options Considered

| Option | Outcome |
| --- | --- |
| Localized, hierarchical static services (selected) | Preserves visitor intent and language while keeping services separate from the editorial content tree. |
| Redirect every old service URL to one unlocalized `/services/weddings` page | Rejected: loses the distinct service offerings and cannot provide an English destination. |
| Redirect service URLs to wedding galleries | Rejected: a gallery is evidence of past work, not a description of a service a visitor may enquire about. |
| Put services into the public content tree | Rejected: services have pricing and enquiry semantics and are not articles or curated galleries; folding them into the tree would blur both models. |

## Consequences

- The current `/services` route is no longer the canonical service namespace
  for the reference deployment. Its pre-launch handling is an implementation
  migration, not a reason to preserve English-only service slugs forever.
- The service schema, adapter, route layer, metadata, navigation and sitemap
  need one coordinated change. A partial implementation must not publish a
  locale path whose content or language switch cannot be resolved.
- Authoring a child requires publishing its localized ancestor first. This is
  deliberate: an orphan detail route would otherwise create a URL whose
  breadcrumb and hierarchy disagree.

## Action Items

1. Add locale service namespaces to deployment configuration and reserve them
   against static and story routes.
2. Replace the unlocalized service document contract with the localized,
   parent-aware contract and its bounded Sanity reads.
3. Implement reference-locale routes, metadata, language switching,
   navigation and sitemap integration.
4. Extend the Joomla import plan with the approved wedding service documents
   and add redirects only after their targets are verifiably served.

## Implementation status

The locale route configuration, localized service contract, route resolution,
metadata, language switching, navigation, and sitemap integration are
implemented in this change. The Joomla import plan and owner-approved copy
identify six wedding-service documents, but pricing and cover media remain
intentionally unfilled until they are approved for publication. The five
permanent redirect rows are therefore pending the plan's Sanity-write and
publication checks; they are not present in the runtime registry yet.

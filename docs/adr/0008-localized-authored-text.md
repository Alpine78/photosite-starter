# ADR-0008: Localized authored text in content schemas

**Status:** Accepted
**Date:** 2026-08-13
**Amended:** 2026-08-14 — see Amendments
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#82

## Amendments

This record remains accepted as a whole. A scoped clause is amended in place only when
implementation produces evidence the original text did not have, and each partial
amendment preserves the old rule and records its date, reason, replacement, and affected
sections as required by the ADR convention (`docs/adr/README.md`).

### 2026-08-14 — A validated sibling type for a field kind decision 3 does not cover (AB#112)

Decision 3 resolves a missing translation by what the text is *for*, in two rows:
accessible text a page cannot do without falls back, and editorial prose a visitor reads
is omitted. Action item 2 expected every later schema story to reuse the `localizedText`
object "rather than inventing a second localized shape." Building the category schema
(AB#112) found a field kind that fits neither row and cannot honestly reuse that object:
a path segment. [ADR-0003](0003-public-content-tree-and-url-structure.md) decision 6
requires `slug` to be language-keyed exactly like `alt` and `caption` are, but a slug is a
structural identifier constrained to a specific shape (lowercase words and hyphens), not
free-form prose — and `localizedText`'s `value` field is `text`, unconstrained beyond
"required," by design (this ADR never needed a second constraint before). A Sanity object
type's field validation is fixed where the type is defined; it cannot be tightened per
call site, so satisfying decision 3's own shape-validation habit (every other authored
value in this codebase is checked, not trusted) was impossible without either weakening
`localizedText` for every existing consumer or adding a type that carries the constraint
`localizedText` cannot.

The decision now reads that a field kind whose value must satisfy a format constraint
beyond "is text" gets its own object type — same `{ language, value }` array shape, same
one-entry-per-language rule (decision 4), same "content, not code" property (decision
2) — rather than being forced through `localizedText` or given a bespoke shape of its own.
`sanity/schemas/localized-slug.ts` is the first: it is not Option B (a field per
configured language) and does not reopen that rejection, since the array shape, the
subtag key, and the no-schema-edit-to-add-a-language property are all unchanged. What
happens when a slug is missing in the requested language is not decided here either: it
follows from ADR-0003 decision 6 (a category may exist in one locale before another) and
is documented at the adapter that reads it, because it is a consequence of what a slug
*is*, not a third row this ADR needs to add to decision 3's table.

Changed text: action item 2, split below to record which stories reused `localizedText`
unchanged and which added a validated sibling type. Decisions 1, 2, 4, and 5, the
fallback-versus-omit rule for prose fields, and every other section are unaffected.

## Context

[ADR-0003](0003-public-content-tree-and-url-structure.md) makes locale-aware public
routing a first-launch requirement: the default locale owns the unprefixed routes, every
other configured locale owns a prefixed route space, and language versions of one thing
are associated by stable identity rather than by slug. The mock layer already behaves
that way — `getMockImages("fi")` returns the same photographs described in Finnish, and
the built-in interface labels ship one set per language subtag.

AB#82 is the first schema story, so it is the first time authored text has to be
localized in the content store rather than in a fixture. A photograph needs alternative
text and may need a caption, and both are sentences a visitor reads. If the schema
carries one `alt` string, the Finnish and English pages announce the same sentence to a
screen reader inside pages that declare different languages — a regression against the
fixture layer this story is supposed to replace.

The shape chosen here is not a one-field decision. AB#80 (settings and home), AB#81
(services, articles, shared blocks), AB#112 (categories) and AB#113 (galleries) all carry
authored text, and every one of them will copy whatever this story does. Changing it
afterwards means migrating content in a customer's dataset, which is the expensive kind
of change.

Two project rules constrain the answer more than convenience does:

- **Keep it generic.** A clone rebrands and redeploys. Its languages are configuration
  (`SITE_LOCALE`, `SITE_LOCALE_ROUTES`), not something the product knows.
- **Minimal dependencies**, extended to the customer's Studio: a schema that only works
  with a plugin makes that plugin part of the handover.

## Decision

**Authored text that varies by language is an array of `{ language, value }` entries,
keyed by language subtag, on the same document as the thing it describes.**

```ts
alt: [
  { language: "fi", value: "Kivinen rantaviiva tyynen veden äärellä" },
  { language: "en", value: "Rocky shoreline beside calm water" },
]
```

### 1. The subtag is the language, not the locale

Entries are keyed by the language subtag (`fi`, `en`), not by the configured locale
(`en-GB`, `en-US`). Two regional route spaces sharing a language read one entry, exactly
as `getBuiltInLabels` already resolves one label set per subtag. A deployment that
genuinely needs different British and American wording has a content problem this schema
does not pretend to solve.

### 2. Adding a language is content, not code

No field is named after a language, so publishing in Swedish means adding entries and a
locale route — never editing a schema, and never a deploy of the product. This is the
whole reason the shape is an array rather than an object with per-language fields.

### 3. Missing text: alternative text falls back, prose does not

Resolution is per field kind, and the rule is decided once here rather than per story:

| Kind of text | Missing in the requested language |
| --- | --- |
| Accessible text a page cannot do without — alternative text | falls back to the deployment's own language |
| Editorial prose a visitor reads — captions, leads, descriptions | omitted |

An image announced in the wrong language is still usable; an image announced not at all
is not. Which language is the deployment's own is configuration, so a schema cannot check
that the right one was authored — the schema requires at least one entry, and the
boundary refuses a photograph described in neither the requested language nor the
fallback rather than serving it undescribed. Editorial prose is the opposite: publishing a Finnish caption inside an English
page is presenting untranslated content as translated, which is the same judgement
`page-metadata.ts` already makes when it omits a site description in a locale it was not
authored in.

**Blank counts as absent.** An entry whose text is whitespace resolves as though it were
not there. A deliberately empty value — a decorative occurrence with no alternative text —
is a property of the *placement*, not of the media (ADR-0002 §3), and is expressed there.

### 4. One entry per language

Two entries for one language would make the rendered text depend on array order, which
reads as a bug and is invisible in a Studio. The schema rejects it.

### 5. This decides fields, not documents

A photograph is one document in every language: its bytes, its dimensions, and its
`mediaId` are language-neutral, and duplicating the document per language would duplicate
the identity ADR-0002 exists to keep single.

Whether a *page* — an article, a gallery — is one document with localized fields or one
document per language version is **not decided here**. That question involves per-locale
slugs, differing body structure, and independent publication, and it belongs to AB#81 and
AB#113. Whatever they choose must associate versions by stable identity (ADR-0003) and
must use the shape above for any field-level text it localizes.

## Options Considered

### Option A (chosen): array of `{ language, value }`

| Dimension | Assessment |
| --- | --- |
| Generic across clones | High — languages are data |
| Studio dependencies | None |
| Query cost | One array projection per field |
| Editing experience | Plain, unassisted |

**Pros:** adding a language is content. The schema stays dependency-free. One document
per photograph, so identity and dimensions cannot fork. GROQ projects it directly.

**Cons:** an unassisted editing experience — an author sees an array and must add the
right subtag, with no side-by-side view and no "missing translation" report. Resolution
is code, in one place, rather than a `coalesce` in every query.

### Option B: an object with a field per configured language

```ts
alt: { fi: "…", en: "…" }
```

**Pros:** the simplest possible read (`alt.fi`), and Sanity's own documentation uses this
shape in its `coalesce` examples. A missing translation is one `coalesce` away.

**Cons:** it writes this deployment's languages into the product. A clone publishing
Swedish edits the schema of every text field, and a repository whose hard rule is that no
photographer-specific value reaches a schema would be carrying `fi` and `en` in a dozen
of them. **Rejected on the generic-clone rule.**

### Option C: one document per language, linked by identity

**Pros:** the right answer for whole pages whose structure and publication genuinely
differ by language, and the shape most document-internationalization tooling expects.

**Cons:** wrong for a language-neutral entity. A photograph would become N documents
sharing one `mediaId`, so "one media entity reused everywhere" — the thing ADR-0002 is
for — would hold in prose and not in the data. Dimensions, credit, and the asset itself
would be stored N times and could drift. **Rejected for media; deliberately left open for
pages (§5).**

### Option D: a Studio internationalization plugin

**Pros:** a real editing experience — side-by-side fields, translation status, bulk
operations — which is what Option A gives up.

**Cons:** it makes a plugin part of the customer's Studio and of the handover, and the
storage shape becomes the plugin's rather than the project's. Adopting one later is an
editing decision the owner can make; if it stores languages differently it costs a data
migration, which is a bounded, known cost. **Rejected now, not forever.**

## Trade-off Analysis

**Editing comfort against portability.** Option D is plainly nicer to author in, and
Option B is plainly nicer to query. Both trade away the property this project is built
around: a clone should be able to change what it publishes, and in which languages,
without a code change. The array is the only shape where that holds, and the discomfort
is bounded — one array widget per text field, and a resolution rule implemented once.

**Falling back against staying silent.** Falling back on everything would publish
untranslated prose under a translated page. Falling back on nothing would ship images
with no alternative text the moment a translation is late. Splitting the rule by what the
text is for costs one line of documentation per field kind and gets both right, and it
matches a rule the metadata layer already follows.

**A rule set by the smallest story.** This is decided by the media story because media is
first, not because media is the important case. The risk is that articles later want
something this shape cannot express — a body whose block structure differs by language.
§5 keeps that door open by scoping the decision to fields; the cost is that "how a page is
translated" is still undecided going into AB#81.

**Where this could be wrong.** If authoring in two languages turns out to be unworkable
without tooling — the likeliest failure, since nothing in the array tells an author a
translation is missing — the answer is Option D over this data shape, not Option B.

## Consequences

**Easier**

- A clone adds a language by configuring a locale route and authoring entries.
- One photograph stays one document: identity, dimensions, and asset cannot fork per
  language.
- Every later schema story inherits a decided shape and a decided fallback rule.

**Harder**

- Authors get no translation-status view, and a missing translation is only visible on
  the rendered page.
- Every adapter resolves text rather than reading a field, so resolution has to stay in
  one place per boundary instead of being spread through queries.
- Adopting a Studio plugin later may cost a content migration.

**To revisit — migration triggers**

- **Authoring two languages proves unmanageable** → adopt a Studio plugin (Option D) over
  this shape, migrating only if its storage differs.
- **A page needs per-language structure, not just per-language sentences** → AB#81 decides
  document-level translation; this field-level shape is unaffected.
- **A deployment needs regional wording** (`en-GB` ≠ `en-US`) → key entries by full locale
  rather than by subtag, which is a widening of the same shape.

## Action Items

1. [x] Implement the shape and the resolution rule in the media schema and adapter
       (AB#82).
2. [x] AB#112 reused `localizedText` for `label` and added the validated sibling type
       `localizedSlug` for `slug` (see Amendments, 2026-08-14) — not a second shape for
       prose, but the first field kind this ADR's two rows did not cover.
3. [ ] AB#80 reused `localizedText`; AB#81 and AB#113 must do the same — or, for a
       format-constrained field, use `localizedSlug` or a validated sibling type following
       the same amendment — rather than inventing an unrelated shape.
4. [x] AB#112 moved the resolution and raw-value helpers into
       `src/lib/sanity-values.ts` when the category adapter became the second consumer;
       neither provider adapter imports the other.

## What this ADR did not establish

- **How a page is translated.** §5 scopes this to fields. Document-level translation is
  AB#81's and AB#113's decision.
- **Machine or AI translation.** A roadmap item, deliberately untouched: this decides
  where a translation is stored, not where it comes from.
- **Localized routing.** Already decided by ADR-0003; this record neither extends nor
  narrows it.

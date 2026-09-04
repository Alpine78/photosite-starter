# Theme contract

The site's brand-sensitive styling — page and surface colours, text roles, the
accent, borders, the focus indicator, the type families, and the corner
treatment — is a small set of **semantic tokens** defined once in
[`src/app/globals.css`](../src/app/globals.css). Shared components consume the
tokens; they never write a raw `black`/`white`/colour-scale utility for anything
a preset might want to change.

A theme preset (AB#37) or a clone rebrands by overriding the token values. It
does not fork a component, a route, or a content type.

This document is the contract: the tokens, where a preset may override them, and
what deliberately stays outside the system. `src/lib/theme-contract.test.ts`
(browser-free) and `e2e/theme.spec.ts` (production build) enforce the parts a
reviewer cannot eyeball.

---

## The tokens

Every token is registered as a Tailwind theme value (`@theme inline`), so it is
used through an ordinary static utility class — `bg-surface`, `text-muted`,
`border-border-strong`, `text-danger`, and so on.

### Page and surface

| Utility | Custom property | Role | Light | Dark |
| --- | --- | --- | --- | --- |
| `bg-background` | `--background` | the page canvas | `#ffffff` | `#0a0a0a` |
| `bg-surface` | `--surface` | a raised panel (menu dropdown, sticky section bar) | `#ffffff` | `#0a0a0a` |
| `bg-surface-muted` | `--surface-muted` | a resting subtle fill (image placeholder) | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.05)` |
| `bg-surface-hover` | `--surface-hover` | the wash a control takes on hover | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.1)` |

`--surface` defaults to `--background`; it exists so a preset can give raised
panels a distinct fill without touching a component. `--surface-hover` is a
separate role from `--surface-muted` on purpose — in dark mode the hover wash is
heavier (`/0.1` vs `/0.05`), and folding them together would erase the hover
affordance.

### Text roles

| Utility | Custom property | Role | Value (both palettes) |
| --- | --- | --- | --- |
| `text-foreground` | `--foreground` | headings, strong text, the active nav item | `#171717` / `#ededed` |
| `text-body` | `--body` | body copy, leads, list items | `--foreground` at 80% |
| `text-muted` | `--muted` | secondary text, field labels, metadata | `--foreground` at 70% |
| `text-subtle` | `--subtle` | captions, fine print, the breadcrumb trail | `--foreground` at 60% |

The three subordinate roles are `color-mix(in oklab, var(--foreground) N%,
transparent)` — exactly what `text-foreground/N` already compiled to — so they
track whatever `--foreground` a preset sets and need no dark override of their
own.

### Borders

| Utility | Custom property | Role | Light | Dark |
| --- | --- | --- | --- | --- |
| `border-border` | `--border` | a hairline: a divider, a card edge | `rgb(0 0 0 / 0.1)` | `rgb(255 255 255 / 0.15)` |
| `border-border-control` | `--border-control` | a form field, chip, or info-panel edge | `rgb(0 0 0 / 0.2)` | `rgb(255 255 255 / 0.25)` |
| `border-border-strong` | `--border-strong` | a hover or emphasis border | `rgb(0 0 0 / 0.4)` | `rgb(255 255 255 / 0.4)` |

### Accent, danger, focus

| Utility | Custom property | Role | Light | Dark |
| --- | --- | --- | --- | --- |
| `bg-accent` / `border-accent` | `--accent` | the primary action fill; the active-state border | `--foreground` | `--foreground` |
| `text-accent-foreground` | `--accent-foreground` | text/icon on an accent fill | `--background` | `--background` |
| `text-danger` / `border-danger` | `--danger` | an error message, an invalid field | `oklch(50.5% 0.213 27.518)` (Tailwind `red-700`) | `oklch(70.4% 0.191 22.216)` (`red-400`) |
| `outline-focus` | `--focus` | the keyboard focus ring's colour | `--foreground` | `--foreground` |

`--accent` / `--accent-foreground` / `--focus` default to the site's ink/paper
inversion. A preset gives them a brand colour here; a component keeps using
`bg-accent` / `outline-focus` unchanged.

The focus colour is applied by **one base rule** —
`:focus-visible { outline-color: var(--color-focus) }` — because Tailwind's
`outline` / `outline-2` utilities set the ring's width and style but not its
colour. A control that needs a different ring (the hero CTA over the photo
scrim) sets its own `outline-*` colour utility and still wins.

### Type and corners

| Utility | Custom property | Notes |
| --- | --- | --- |
| `font-sans` | `--font-family-sans` | Geist Sans + a full fallback stack. |
| `font-mono` | `--font-family-mono` | Geist Mono + a full fallback stack. |
| `rounded-sm` / `rounded-md` / `rounded-lg` | `--radius-sm` / `--radius-md` / `--radius-lg` | `0.25` / `0.375` / `0.5 rem` — Tailwind's defaults, redeclared here so the scale is one owned override point. |

`rounded-full` is deliberately **not** themeable — a pill is a shape, not a
radius. Overriding `--font-family-*` chooses the CSS family; **loading** a
different web font (via `next/font` or an `@font-face`) is a separate step a
preset has to do itself.

---

## Light and dark

Light and dark are explicit, not an accidental `prefers-color-scheme` override:

- **`:root`** holds the complete light palette and `color-scheme: light`.
- **Dark** is reached two ways, and the two blocks hold identical values
  (`theme-contract.test.ts` fails CI if they drift):
  - `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` —
    the OS preference, unless a light pin opts out;
  - `:root[data-theme="dark"]` — an explicit choice that wins even under a light
    OS.
- Both dark blocks also set `color-scheme: dark`, so native controls, form
  fields, and scrollbars render dark to match rather than staying light on a
  dark page.

`<html>` ships with **no `data-theme` attribute**, so the default behaviour is
unchanged from before this refactor: follow the OS. Setting
`data-theme="light"` or `data-theme="dark"` on `<html>` is the documented hook
for a preset, a clone, or a future in-page toggle. No toggle UI ships today.

---

## Overriding for a preset (AB#37) or a clone

A preset is selected by **`data-preset` on `<html>`**, and redefines the
primitives in up to three blocks — mirroring the default's own light / OS-dark /
pinned-dark structure:

```css
:root[data-preset="editorial"] {
  color-scheme: light;
  --background: #f7f4ef;
  --foreground: #14100e;
  --accent: #1d4ed8;          /* a real brand colour, not the ink inversion */
  --accent-foreground: #ffffff;
  --focus: #1d4ed8;
  --font-family-sans: ui-serif, Georgia, "Times New Roman", Times, serif;
  --radius-sm: 0;             /* square corners */
  --radius-md: 0;
  --radius-lg: 0;
}

@media (prefers-color-scheme: dark) {
  :root[data-preset="editorial"]:not([data-theme="light"]) { /* dark values */ }
}

:root[data-preset="editorial"][data-theme="dark"] { /* the same dark values */ }
```

**`data-preset`, not `data-theme` — corrected by AB#37.** This document
previously described a preset as `:root[data-theme="<name>"]`. That does not
work: `data-theme` already carries the *mode* pin (`light` / `dark`), and one
attribute cannot hold both an identity and a mode. A preset selected that way is
neither `light` nor `dark`, so the default palette's own dark block still
matches underneath it, and the preset has no way to express a dark palette at
all. Splitting identity from mode keeps them orthogonal — verified in
`e2e/theme.spec.ts`, where the preset's dark palette and the `data-theme` pin
are exercised together.

Overridable: every palette primitive (`--background`, `--foreground`,
`--surface`, `--surface-muted`, `--surface-hover`, `--border`,
`--border-control`, `--border-strong`, `--danger`), the semantic
`--accent` / `--accent-foreground` / `--focus`, the two `--font-family-*`
families, and the three `--radius-*` steps.

Not overridable per component: there is no per-component colour hook, and there
should never need to be one. A surface a preset cannot reach through these
tokens is a **missing extension point** — AB#37 records it and this contract
absorbs it, rather than the preset copying the component.

### What AB#37 found

The `editorial` preset in `globals.css` is an **internal validation asset**:
nothing in the application selects it and no control ships that would. It exists
to be deliberately unlike the default in every dimension this contract claims is
reachable, so that a claim which was never true would fail rather than sit
unread. Two things came out of building it.

**1. The selection mechanism was wrong** — corrected above. Worth noting *how* it
was wrong: the old form could express a light-only preset perfectly well, so the
gap would not have surfaced until someone shipped a preset and then wanted a dark
palette for it.

**2. The derived text roles cannot be re-weighted, and that constrains a
preset's palette.** `--body`, `--muted` and `--subtle` are fixed 80/70/60 %
mixes of `--foreground` on `:root`; they are deliberately *not* in the
overridable list, so a preset inherits those weights whatever its ink. The
consequence is concrete rather than theoretical: this preset's first warm-paper
palette (`#f7f4ef` ground, `#1f1a17` ink) cleared AA for `--body` and `--muted`
and missed it for `--subtle` at **4.41:1**, and the preset could not fix that by
loosening the weakest role. The ink was darkened to `#14100e` instead.

That is a real constraint on preset authors — **the weakest derived role, not the
body text, is what a palette has to be chosen against** — and it is left as a
constraint rather than an extension point on purpose: making the percentages
overridable would let a preset weaken text contrast as easily as strengthen it,
and nothing has yet needed it. If a real preset does, this contract absorbs it
then, with the AA gate extended to cover the new freedom.

Both presets are held to AA by `src/lib/theme-contract.test.ts`, which parses
this CSS and computes the contrast itself; adding a preset means adding its
blocks to that test's palette list, and a preset that misses AA fails the build.

---

## What stays explicit (and why)

Three surfaces keep raw `black`/`white` values on purpose. They are deliberate
photographic or media treatments, not brand decisions a palette should reach:

- **The hero scrim** — the `from-black/80 via-black/40 to-transparent`
  gradient and its overlaid white title (plus, where authored, a tagline or
  lead description and a CTA). It has to stay legible over *any* photograph
  regardless of the site palette. Originally the home hero's alone; AB#149
  extended it to the article and gallery content-page heroes (a curated
  gallery's own lead description renders on it too, per that story's AC2),
  through one shared component (`src/components/hero-overlay.tsx`) rather than
  a second colour surface — the same explicit-colour exception, applied at a
  second and third call site, not a new one. The gradient utility itself is
  unchanged by AB#148/ADR-0016: what changed is the size and anchor of the box
  it paints into — a viewport-clamped band anchored to the top of the hero
  (`min(image height, 100dvh - HERO_CHROME_RESERVE_PX)`) rather than a box
  always as tall as the (uncapped) photograph — so the darkest stop still sits
  directly behind the text regardless of how tall the photograph itself
  renders. A content page with no authored cover renders no hero and no scrim
  at all (AB#149 AC10), the same as it always could.
- **The YouTube embed backdrop** — the `bg-black` behind a loaded player, like a
  video letterbox.
- **The PhotoSwipe lightbox** (`src/components/gallery-lightbox.css`) — an
  always-black surface layered over the page, not part of its type flow. It
  re-points `--color-focus` to `#fff` for its own subtree so the shared focus
  rule still draws a visible ring there.

---

## Constraints

- **No dynamic Tailwind class names** (AB#36 AC6). Every utility is a static
  literal. A variant is chosen by swapping whole class strings in a ternary,
  never by interpolating a token name into a class.
- **Contrast** (AC5). `text-body`, `text-muted`, `text-subtle`, and `text-danger`
  clear WCAG 2.1 AA (≥ 4.5:1 for normal text) over `--background` in both
  palettes; the focus ring clears ≥ 3:1. Enforced by both test suites above.
- **Known limitation — non-text control borders.** `--border-control` (form
  fields, chips, info panels) is ~2.1:1 against the page in light, below WCAG
  1.4.11's 3:1 for non-text UI. This is the pre-AB#36 appearance, kept
  deliberately: AC2 forbids a site-wide restyle of every form and chip inside a
  token refactor, and AC5 scopes AA to text and focus. Strengthening it is a
  tracked follow-up.
- **Fidelity** (AC2). Dividers and resting control borders keep their existing
  dominant values; the few one-off weights fold into the nearest role and never
  get fainter (hover borders unify at `/0.4`). `text-foreground/65` folded into
  `text-subtle` (`/60`), a 5% step. The YouTube backdrop and the lightbox are
  byte-for-byte unchanged since AB#36. The hero's scrim *colour values* are
  unchanged too, but its surrounding markup is not — AB#148/ADR-0016 resized
  and re-anchored the box the gradient paints into (a fold-safety fix, outside
  AB#36's own scope), so "byte-for-byte" no longer describes the hero as a
  whole, only its colours.

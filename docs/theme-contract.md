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

A preset is a `:root[data-theme="<name>"] { … }` block that redefines the
primitives, plus whatever sets `data-theme` on `<html>`:

```css
:root[data-theme="studio-mono"] {
  color-scheme: light;
  --background: #faf7f2;
  --foreground: #1a1a1a;
  --surface: #ffffff;
  --accent: #7c5cff;          /* a real brand colour, not the ink inversion */
  --accent-foreground: #ffffff;
  --focus: #7c5cff;
  --radius-sm: 0;             /* square corners */
  --radius-md: 0;
  --radius-lg: 0;
}
```

Overridable: every palette primitive (`--background`, `--foreground`,
`--surface`, `--surface-muted`, `--surface-hover`, `--border`,
`--border-control`, `--border-strong`, `--danger`), the semantic
`--accent` / `--accent-foreground` / `--focus`, the two `--font-family-*`
families, and the three `--radius-*` steps.

Not overridable per component: there is no per-component colour hook, and there
should never need to be one. A surface a preset cannot reach through these
tokens is a **missing extension point** — AB#37 records it and this contract
absorbs it, rather than the preset copying the component.

---

## What stays explicit (and why)

Three surfaces keep raw `black`/`white` values on purpose. They are deliberate
photographic or media treatments, not brand decisions a palette should reach:

- **The home hero scrim** — the `from-black/80 via-black/40 to-transparent`
  gradient and its overlaid white title, tagline, and CTA. It has to stay
  legible over *any* photograph regardless of the site palette.
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
  `text-subtle` (`/60`), a 5% step. The hero, the YouTube backdrop, and the
  lightbox are byte-for-byte unchanged.

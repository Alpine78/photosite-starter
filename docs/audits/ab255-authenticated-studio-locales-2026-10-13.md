# AB#255 — Authenticated Studio FI/EN check, 2026-10-13

AB#255 remains Active. The owner signed in themselves to a native Windows Chrome
test window while the repository and local Studio ran in WSL. The VS Code
embedded browser and the earlier Linux Chromium profile were separate sessions.
The combined, ignored local preview uses the two Studio PRs, #370 and #371.
No CMS content was edited, reset, created or published during this check. No
credentials, cookies, browser profiles, authored text or screenshots enter this
public receipt or CI artifacts.

## Observed behavior and corrections

- The installed Sanity 6.18.0 package disables both built-in locale menus. The
  registry tarball and the installed compiled module were compared byte for byte;
  this was not a local dependency modification. PR #371 now supplies a labelled
  navbar select through the Studio components extension, using the pinned SDK's
  exported, internally marked `useLocale` bridge. It uses the SDK's existing
  preference store and leaves custom tool titles intact.
- Actual FI → EN → FI switching works for the ten editorial entries and the
  home/settings, service, article, gallery, gallery-placement, shared-media,
  category, article-end-gallery-placement and poll forms. Sample field titles,
  help and normal field-action controls follow the chosen language. The HTML
  language changes as well. The home form's four authored controls were compared
  before/after switching and remained unchanged.
- The native select has an associated label. Native Chrome ArrowDown input changed
  English to Finnish. A reload retained Finnish and the authenticated session.
- A boolean input rendered its description from `schemaType.description`, outside
  the field-wrapper override. PR #370 now translates that description as well;
  the service visibility help was rechecked in both languages. Six Finnish help
  strings were clarified/corrected, without changing their English keys or
  canonical schema definitions.
- An existing article draft rendered an invalid-array-value error for an existing
  `null`. The complete built-in error panel followed FI/EN. Its reset action was
  not used. This data condition and pending localization review prevent treating
  the draft as ready to publish.

## Limits and remaining work

The authenticated check does **not** establish a completely bilingual Studio.
The default document form's schema type label and its description tooltip still
read the compiled schema directly, outside the field/input adapters: for example,
Article and the article-type description remain English in the Finnish UI.
Array drag-and-drop screen-reader instructions also remain English in the
rendered accessibility region. The document-list placement previews also keep
the English `Image N` prefix in Finnish. Sample list thumbnails request
`fit=crop`, despite contained CSS rendering; the schema preview component does
not establish full-frame delivery for that list path. These require a separate,
supported presentation solution; changing CMS content or the installed SDK bundle is not a fix.

Not every one of the 159 additions was exercised in a live view: variants and
other tools not used by this editorial workflow remain covered by the resource
and interpolation tests, rather than an authenticated UI claim. Custom
publication validators and missing-value preview fallbacks retain their existing
SDK/source tests; the observed live error above is a built-in invalid-value
panel, not proof of every custom publication message. Owner wording acceptance,
remaining UI fixes, final committed-head CI and Studio deployment remain pending.
Both Studio PRs stay Draft.

## Validation and integration

- Schema branch: full deterministic suite, 247 files / 5,835 tests; lint and
  Studio typecheck pass. The final wording catalog rerun also passes.
- Core branch: full deterministic suite, 246 files / 5,829 tests; lint, Studio
  typecheck and static build pass.
- Final combined preview: Studio typecheck, zero-error schema validation and
  static build pass, with the existing installed-package notices.
- Published heads ba2063f (#370), 09a928e (#371) and 25280fc (#374) each had a
  successful required pipeline at the read-only check. This does not validate
  the newer uncommitted corrections.
- After #373 merged, main 27d7252 was integrated with `--no-commit` in the three
  existing worktrees. The two Studio documentation conflicts retain both histories;
  the sitemap branch integrates cleanly. There are no unresolved conflict entries.
  On the owner's renewed request, the previously confirmed, task-specific commit/push
  exception applies to the #370/#371 correction batch (AB#255 discussion 62254/62299).
  Publish these two repairs one at a time. The default editor-only commit rule
  remains in force for other work; no PR merge or deployment is inferred.

No merge, Studio deployment, public-site activation or authoring approval is
inferred from signing in or from these checks.

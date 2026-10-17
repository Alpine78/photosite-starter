# Inactive protected-gallery removal readiness — 2026-10-17

**Work item:** AB#313, Active. **Result:** source/dependency audit complete;
operational clearance and approval of any deletion remain open. No code,
configuration, CMS content, storage, deployment or protected branch is changed.

## Authority and immutable baseline

The current descriptions, acceptance criteria, complete discussions and relevant
relations of AB#313, AB#29, AB#145, AB#130 and AB#95 were read from Azure Boards.
[ADR-0034](../adr/0034-ongoing-unlisted-client-delivery.md) selects existing
Sanity/unlisted delivery for this owner and defers the protected alternative.
AB#29/145 remain Active, AB#130 remains New pending a compatible proof-write
boundary, and AB#95 grants no sales/fulfilment implementation or asset exposure.
This audit does not close those items or accept new public-file eligibility.

The source baseline is merged main
`6389a9293a331142e7c71ed54c51b23eab4e5f3a`, tree
`3ae59b4027b3e701b1b8f36b1af4c89ecc0ff3d6`. The one-time Claude plan review used
`f218aaf437100879d670a8b219dd5703df09d97f`; normal authorized merges changed HEAD,
but `git rev-parse <commit>^{tree}` returned the identical tree for both commits.
This known reassessment carries the reviewed plan forward; it is not an
unexplained concurrent source change. Counts below describe that tree only.

Architecture/security review of this **audit** considered the existing ADRs,
[boundary diagrams](../architecture/README.md),
[data-flow record](../private-gallery-data-flow.md),
[deployment runbook](../deployment.md) and
[security review](../security-privacy-review.md). Future deletion patches require
their own actual architecture/security and Claude diff reviews. No new ADR is
needed to inventory the already accepted direction.

## What was checked

Tracked source/configuration/public assets, reverse source imports, route
handlers, configuration guards, explicit call sites, scripts, test discovery,
CI and maintained documentation were inspected. The appendix reproduces the
conservative source graph, including type references and JS configuration files.
Tracked text searches supplement it with strings, static URLs and non-import
references. No untracked `.env` file, credential value, customer data or cloud
configuration was read.

| Source evidence | Result at the baseline |
| --- | --- |
| First-party tracked TS/TSX/MTS/JS/MJS/CJS, excluding declarations and vendored code | 903 files, including 900 TypeScript files |
| External import occurrences | 418 Node builtins, 646 declared root/Studio dependency imports, 6 locked transitive Studio test imports (`i18next`, `@sanity/schema`) |
| Unknown package names / unresolved local code imports / opaque dynamic imports or requires | 0 / 0 / 0 |
| `client-gallery-access.ts` conservative reachability | 74 source modules; only private-family module is `private-gallery-deployment.ts` |
| `/client-gallery/[handle]` page reachability | 87 source modules; same private-family module; `gallery-lightbox.css` is a reported asset edge |
| Non-test incoming references into the protected family from outside it | `generate-admin-secret.mts` → credential format (runtime); `contact-log.ts` → facade (type-only); `deployment-config.ts` → deployment settings (runtime) |

The 6 transitive imports are present in `studio/package-lock.json`, not direct
package declarations. The graph reports CSS/JSON separately, conservatively
includes type-only edges, and does not execute source. It does **not** establish
emitted bundle contents, all runtime call paths, package internals, reflective
strings, `require.resolve`, `new URL`/filesystem reads or use outside this repo.
Those are separate evidence classes, not silently counted as analyzed imports.
In particular, the public facade graph alone does not cover `contact-log.ts`'s
protected **type** dependency or `next.config.ts`'s CSP dependency.

## Entry points and dependencies

### Customer and administrator routes

External prefixes default to `/private` and `/admin`, but remain configurable.
[Proxy](../../src/proxy.ts) rewrites them to the literal App Router roots below,
handles internal-path rejection and namespace hygiene independently of the store
mode. The following are source-inspected handlers, not live endpoint probes.

| Files below `src/app/` | Explicit methods / current off-mode behavior |
| --- | --- |
| `private-gallery/[handle]/page.tsx` | Page calls `notFound()` before store lookup |
| `private-gallery/[handle]/exchange/route.ts` | POST; generic 403 |
| `private-gallery/[handle]/asset/route.ts` | POST; generic 403 |
| `private-gallery/[handle]/items/route.ts` | GET; generic 403 |
| `private-gallery/[handle]/proof/route.ts` | GET, POST, PUT; generic 403 |
| `private-gallery-admin/page.tsx` | Page calls `notFound()` |
| `private-gallery-admin/login/route.ts` | POST; generic 401 |
| `private-gallery-admin/logout/route.ts` | POST; 404 when off |
| `private-gallery-admin/delivery/route.ts` | GET, POST, PATCH; 404 when off |
| `private-gallery-admin/proof/route.ts` | GET, POST, PATCH, PUT; 404 when off |
| `private-gallery-admin/proof/[handle]/route.ts` | GET, POST; 404 when off |

Both trees also own `layout.tsx` and `error.tsx`; route-adjacent tests exercise
these interfaces. `public/private-gallery-bootstrap.js` and
`private-gallery/layout.tsx` form the fragment-scrubbing startup contract.
Protected-only UI includes `src/components/private-gallery-*.tsx`,
`use-private-gallery-draft-list.ts` and the differently named
`admin-sign-in-form.tsx` (its only non-test source importer is the administrator
page). Do not infer public reuse from filenames or delete shared child components.

The protected facade is
[`private-gallery-access.ts`](../../src/lib/private-gallery-access.ts).
`getPrivateGalleryStores()` and `getPrivateGalleryAdminStores()` return fixture
stores only for `memory`; both **throw for `enabled` because production adapters
are unimplemented**, and for inappropriate calls while off. Memory is rejected
outside development by the build-safe configuration. Default-off and missing
adapters are source facts; neither proves the flags or consumers of every active
clone or deployed build. Some disabled APIs return 401/403 rather than 404.

### Shared configuration, namespaces and response policy

| Files | Preserve or explicitly replace before removing protected behavior |
| --- | --- |
| `src/lib/private-gallery-deployment.ts`, `deployment-config.ts` | Public configuration imports the former; keep prefix validation/reservations, development-fixture refusal and `NEXT_PUBLIC_` secret-mirror refusal. The current parser accepts `enabled`; its store factories then refuse. Do not silently ignore stale mode settings. |
| `src/proxy.ts`, `src/lib/request-path.ts` and their tests | Distinguish customer/admin/internal paths, rewrite passes, slash redirects, locale headers and no-store/noindex/no-referrer. Preserve selected unlisted/legacy branches and unrelated public request headers. |
| `src/lib/public-routes.ts`, locale validation in `deployment-config.ts` | Keep configured customer/admin prefix reservations and literal `private-gallery`, `private-gallery-admin`, `private-gallery-bootstrap.js` reservations until an explicit URL decision replaces them. Otherwise dynamic routes could capture old namespaces. |
| `src/lib/legacy-gallery-redirects.ts`, `src/lib/robots.ts`, `src/app/robots.ts` | Keep reserved-source rejection, legacy redirect behavior and crawl-policy boundaries. `/client-gallery` pages must still expose noindex rather than being blocked from reading that response. |
| `next.config.ts`, `src/lib/private-object-store-origin.ts`, `src/lib/next-config.test.ts` | Separate build-time private-origin/CSP handling; do not remove shared Sanity optimizer/security-header policy. Only `enabled` asks for the S3 origin. |
| `eslint.config.mjs` | Protected import restrictions are separate from public adapter, signing-secret and server-only restrictions. Remove a stale protected entry only alongside its deleted module. |

Studio schema imports do not share the application's `RESERVED_ROOT_SEGMENTS`
constant. Category/story schema validation and `studio/sanity.config.ts`
therefore cannot substitute for application locale/URL collision guards. Preserve
the latter even if a CMS editor accepts a token. Neither protected route tree
exports `generateStaticParams` or `generateMetadata`; unlisted layout metadata
and the independent sitemap path builder remain selected-path concerns.

### CLI, worker, domain and transport

`package.json` exposes `plan:private-gallery-upload`,
`verify:private-upload-sources` and `admin:secret`. Their exact implementation
files appear in slice A below. `scripts/private-gallery-retention-workflow.mts`
exports `runPrivateGalleryRetention` against injected metadata/object ports;
no non-test source import or package command invokes it. No concrete protected
Postgres adapter or S3 upload/retention runner is wired by this baseline.

`src/lib/private-gallery-*.ts` covers capability/session/admin credentials,
signing, object keys, upload planning/completion/readiness, delivery/proof domain,
retention rules, fixture stores, draft paging and browser response parsing.
The appendix emits the exact file set. Its build-safe deployment leaf is shared.

`src/lib/gallery-notification{,-transport,-resend,-sink}.ts` and associated tests
are additional protected-model candidates despite their generic filenames.
`getGalleryNotificationTransport()` has no non-test source caller. Do **not**
remove `resend-email.ts`: `contact-delivery-resend.ts` also uses it. Current
optional notification requirements in AB#145 do not select or activate this old
transport, but a later notification design may deliberately reuse reviewed parts.

`contact-log.ts` has protected event types/wrappers and type-only facade imports,
while its common writer and contact/enquiry/poll events remain live shared code.
The private credential-format module is used by the generator and private admin
credential verifier, not the public contact redaction boundary. Removing that
module later must wait for both callers; preserve unrelated redaction.

There are **no AWS SDK or PostgreSQL packages in root `package.json`** to remove.
SigV4 signing uses Node builtins. Do not describe source retirement as canceling
an existing paid service or uninstalling dependencies that are absent.

### Tests, CI and documentation

`vitest.config.mts` discovers `src`, `sanity`, `studio` `.test.ts` and
`scripts/*.test.mts`; its server-only stub and separate excluded live suites stay.
It sets no coverage threshold or unused-export checker. `tsconfig.json` includes
TS/TSX/MTS and generated Next types and excludes `node_modules`, `temp`, `studio`.
The separate Studio typecheck/build is independent. No root/Studio package `bin`
or install/prepare lifecycle hook calls this protected model.

`playwright.config.ts` builds and serves the harness environment, also applying it
to the runner. `e2e/support/harness-environment.ts` explicitly sets
`PRIVATE_GALLERY_STORE=memory`; that is the real test coupling to remove/retarget.
The eleven `e2e/private-gallery-*.spec.ts` files are protected journeys.
`private-route-hygiene.spec.ts` and `restricted-page-locales.spec.ts` require
case-level review: preserve shared response/public regressions and the latter's
legacy file/locale tests, rather than deleting mixed suites as a group.
`e2e/client-gallery.spec.ts`, `studio/client-gallery-composition.test.ts` and
`src/lib/client-gallery-*.test.ts` guard the selected no-private-services path.

`azure-pipelines.yml` invokes generic lint, unit, diagram, build and public-journey
gates plus a separate Studio job. It contains no named protected provisioning or
retention job and does not set `PRIVATE_GALLERY_*`; this is not an external
scheduler audit. The `photosite-starter-vercel-preview` variable-group reference
is visible, but its actual values and Vercel runtime settings were not inspected.

Maintained references to reconcile alongside later removals: `README.md`,
`AGENTS.md`, `.env.example`, `docs/deployment.md`,
`docs/private-gallery-data-flow.md`, `docs/security-privacy-review.md`,
`docs/feature-status.md`, `docs/contact-data-flow.md`, `docs/theme-contract.md`,
`docs/bilingual-page-coverage.md`, `docs/photographer-operations.md`,
`docs/production-failure-triage.md`, `docs/image-sales-discovery.md`,
`sanity/README.md` and `studio/README.md`. The tracked search below finds the
additional historical audit/ADR references; those remain dated history.
`docs/architecture/{application-boundaries,system-context,deployment-flow}.d2`
and their generated SVGs remain the boundary/deployment record; future edits use
`npm run diagrams` and `npm run diagrams:check`, never hand-edited SVGs.

## Conditional removal slices

**None is cleared for deletion.** These are bounded follow-up proposals, ordered
by dependency. Rerun the appendix and tracked-string search on each actual patch;
do not treat today's candidate list as tomorrow's unused-code proof.

| Slice | Exact scope / dependency and replacement | Regression and recovery |
| --- | --- | --- |
| A1: old offline source commands | Remove `scripts/plan-private-gallery-upload.mts`, `verify-private-gallery-sources.mts`, `private-gallery-source-{plan,files,verification}.mts`; remove `plan:private-gallery-upload` and `verify:private-upload-sources` commands. Remove their four matching test modules plus `private-gallery-source-streaming.test.mts`. No change to selected unlisted/legacy tools or shared private-file IO. | Prove no operator invokes these commands; source reverse imports must be confined to this set/tests. Run remaining script unit tests, lint/build; retain old commit/command instructions as history. Revert the normal removal commit if needed. |
| A2: isolated worker and generator (separate small PRs if needed) | `scripts/private-gallery-retention-workflow.mts` + matching test; separately `scripts/generate-admin-secret.mts` and `admin:secret`. Keep its credential-format dependency while private admin still imports it. No replacement scheduler or secret required for native Studio. | External schedulers/manual secret use unverified. Remaining unit/lint/build gates; never run a real cleanup or generate/share an operational credential for this check. Normal commit revert restores source, not any deleted remote object. |
| B1/B2: customer/admin surfaces, independently reviewable | Retire each corresponding `src/app/private-gallery*/` tree and its protected-only UI/callers; customer slice also owns `public/private-gallery-bootstrap.js` and its bootstrap test. Preserve shared layout/lightbox/locale/form helpers. Replace obsolete surface handling with deliberately reviewed unavailable namespace behavior, keeping reservations and hygiene; 404 tombstones would change current API statuses. | Before retirement verify no real capability/session/admin or clone caller depends on either namespace. Update only protected cases/harness memory setting when no remaining fixture needs it. Run root gates and production-build method/path/custom-prefix/header/locale/legacy/client-gallery journeys. Revert the exact slice commit to restore source, never reopen customer access automatically. |
| C: now-unreferenced domain/fixture/notification cleanup | After A/B, recompute reverse edges to select individual `src/lib/private-gallery-*.ts` groups, excluding shared deployment leaf. Include their adjacent tests, now-unused `gallery-notification*` modules/tests, private event types/wrappers/imports in `contact-log.ts` and private ESLint bans. Remove facade type references together with private event wrappers; retain shared closed writer and contact/enquiry/poll events. Keep `resend-email.ts`, public rate-limit/request helpers and private-file IO. | Each selected group needs a zero remaining non-test importer/caller check. Retain public privacy, media projection, enquiry and poll tests; run root gates and selected public journeys. No package change unless a newly demonstrated actual dependency becomes unused. Revert bounded commits; do not restore rejected storage deployment. |
| D: remaining configuration/CSP/copy/runbooks | Only after route/domain retirement, simplify obsolete store mode/origin handling in `private-gallery-deployment.ts`, `private-object-store-origin.ts`, `next.config.ts`, proxy/request-path, deployment labels/config, robots and `.env.example` with their tests/docs/diagram sources. Keep a small reservation/secret-mirror/stale-config refusal boundary or explicitly reviewed equivalent; never delete the shared leaf wholesale. | Require an explicit unknown/obsolete `PRIVATE_GALLERY_STORE` refusal policy rather than silently accepting stale deployment settings. Test public locale/slug collisions, internal/custom prefixes, redirects, headers/CSP, robots/sitemap and selected unlisted flow; root + Studio + relevant browser gates and diagrams check. Revert slice commits with original configuration compatibility; historical ADRs remain unchanged. |

A1's tests are `plan-private-gallery-upload.test.mts`,
`verify-private-gallery-sources.test.mts`, `private-gallery-source-plan.test.mts`,
`private-gallery-source-verification.test.mts` and
`private-gallery-source-streaming.test.mts`. Runtime domains used by A1/A2 remain
until those consumers have retired. B1/B2 component ownership must follow the
actual remaining importers: an admin draft editor shared by proof/delivery is
removed with its last caller, not the first route PR.

Every proposed slice requires the following **separate** clearance before
implementation, recorded privately by environment/build and date, with only a
redacted verdict in its PR. No secret values belong in the audit or a ticket.

| Slice | App/build settings and live route consumers — deployment owner | Azure groups/pipeline callers — pipeline owner | Schedulers/manual CLI/local `.env` references — operator | Other active clone/custom consumers — clone owner | Actual patch architecture/security + Claude review |
| --- | --- | --- | --- | --- | --- |
| A1 | OPEN: confirm no deployed external tool invokes removed commands | OPEN | OPEN: command/export usage and private artifacts | OPEN | OPEN |
| A2 | OPEN: worker/secret generator use | OPEN | OPEN: cron/platform schedules, ad hoc jobs and credential recovery | OPEN | OPEN |
| B1/B2 | OPEN: actual protected flags, routes, issued sessions and links | OPEN | OPEN: admin/customer handoff and local development use | OPEN | OPEN |
| C | OPEN: no runtime/custom adapter import of each recalculated group | OPEN | OPEN: script/module imports outside this repository | OPEN | OPEN |
| D | OPEN: actual stale settings, configured prefixes and CSP consumers | OPEN | OPEN: local settings and old runbook dependencies | OPEN | OPEN |

This audit supplies source evidence for those checks, not their operational
answers. Owner rejection of S3 establishes product direction; it does not prove
an inventory of cloud resources, every clone, a scheduler or current credentials.
Do not request broad secret dumps to fill the rows. If a slice needs unavailable
operational facts, keep it conditional and continue independent selected-path
work. Never drop `privateOnly`/sales restrictions, relax CMS projections, create
public proof writes, split ZIPs, mutate retained legacy bytes/metadata or silently
reactivate protected delivery as a recovery action.

## Retained work and recovery limits

GitHub PRs [#446](https://github.com/Alpine78/photosite-starter/pull/446) through
[#451](https://github.com/Alpine78/photosite-starter/pull/451) were read as CLOSED,
with no merge timestamp. Their final branch heads are retained; none is an
ancestor of this baseline main. ADR-0034 explicitly retains their branches and
worktrees. This audit removes neither those checkouts nor local ignored data.
A future protected alternative would need separate prioritization and a fresh
integration review; removals increase the work needed to revive those branches.

| PR | Retained branch | Head |
| --- | --- | --- |
| 446 | `feature/145-delivery-publication-transaction` | `723fb978472c413cc8a32178f8773cb7599e7a3a` |
| 447 | `feature/29-s3-upload-metadata-reader` | `45fec16cde0280b1f66c376e75bb6afb51269ec2` |
| 448 | `feature/145-capability-envelope-rotation` | `0f5dc879377900dfb40e65a15bb6a5bd3a002fe0` |
| 449 | `feature/145-delivery-access-revocation` | `c5c070ea0fa620edbfe28ae506e7ab9872dcf360` |
| 450 | `feature/145-delivery-notification-worker` | `77d28ebaa545a9edefad22c7b925d3da08750404` |
| 451 | `feature/145-delivery-preparation-status` | `a353c1dd303b94631e7a5343a38df69d8fb21583` |

## Reproduce the source inventory

Run in a clean checkout of the baseline with its locked root/Studio dependencies
available on pinned Node 24. This reads only tracked project files; no source is
executed, no dependency is installed and no file/network write is performed.
The resolver asserts the one declared `@/*` mapping. CSS/JSON edges are reported
separately; vendored JavaScript, package internals and declaration files are
outside this source graph. Named imports marked `type` inside a mixed import may
be conservatively classified as runtime; that can overstate, never remove, an
edge. Rerun and inspect actual import syntax before any deletion.

```bash
git rev-parse HEAD HEAD^{tree}
git grep -l -E 'private-gallery|PRIVATE_GALLERY|privateGallery' -- ':!*.svg' ':!package-lock.json' ':!studio/package-lock.json' ':!vendor/**'
git ls-files 'src/app/private-gallery*' 'src/lib/private-gallery*' 'src/components/*private-gallery*' 'scripts/*private-gallery*' 'e2e/*private*' 'public/private-gallery-bootstrap.js'
node --input-type=module <<'JS'
import { createRequire, isBuiltin } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd(), require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const tracked = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
const files = tracked.filter(f => /\.(?:ts|tsx|mts|js|mjs|cjs)$/.test(f) && !f.endsWith('.d.ts') && !f.startsWith('vendor/'));
const known = new Set(files), edges = {}, opaque = [], unresolved = [], unknownBare = [], assets = [];
const declared = new Set(['package.json', 'studio/package.json'].flatMap(f => {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Object.keys({...p.dependencies, ...p.devDependencies});
}));
const paths = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')).compilerOptions.paths;
if (JSON.stringify(paths) !== JSON.stringify({'@/*': ['./src/*']})) throw new Error('Reassess alias resolver');
const locked = new Set(['package-lock.json', 'studio/package-lock.json'].flatMap(f => Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).packages).filter(k => k.includes('node_modules/')).map(k => k.split('node_modules/').at(-1))));
const externalCounts = {builtin: 0, dependency: 0, lockedTransitive: 0};
function target(from, specifier) {
  const local = specifier.startsWith('.') || specifier.startsWith('@/');
  if (!local) {
    const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    if (isBuiltin(specifier)) externalCounts.builtin++;
    else if (declared.has(pkg)) externalCounts.dependency++;
    else if (locked.has(pkg)) externalCounts.lockedTransitive++;
    else unknownBare.push({from, specifier});
    return;
  }
  const stem = specifier.startsWith('@/') ? 'src/' + specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const base = stem.replace(/\.(?:js|mjs|cjs|ts|tsx|mts)$/, '');
  const result = [stem, ...['.ts','.tsx','.mts','.js','.mjs','.cjs','/index.ts','/index.tsx','/index.js'].map(s => base + s)].find(f => known.has(f));
  if (result) return result;
  const record = {from, specifier};
  if (/\.(?:css|json)$/.test(stem) && tracked.includes(stem)) assets.push(record);
  else unresolved.push(record);
}
for (const file of files) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = [];
  function walk(node) {
    let specifier, typeOnly = false;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text; typeOnly = Boolean(node.isTypeOnly || node.importClause?.isTypeOnly);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) { specifier = node.argument.literal.text; typeOnly = true; }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) specifier = node.moduleReference.expression.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      else opaque.push({file, line: ast.getLineAndCharacterOfPosition(node.pos).line + 1});
    }
    if (specifier) imports.push({specifier, target: target(file, specifier), typeOnly});
    ts.forEachChild(node, walk);
  }
  walk(ast); edges[file] = imports;
}
const reach = start => { const seen = new Set(), todo = [start]; while (todo.length) { const f = todo.pop(); if (seen.has(f)) continue; seen.add(f); for (const e of edges[f] ?? []) if (e.target) todo.push(e.target); } return [...seen].sort(); };
const protectedFile = f => f.startsWith('src/lib/private-gallery') || f.startsWith('src/app/private-gallery') || f.startsWith('src/components/private-gallery') || f === 'src/components/use-private-gallery-draft-list.ts' || f === 'src/components/admin-sign-in-form.tsx' || f.startsWith('scripts/private-gallery') || ['scripts/plan-private-gallery-upload.mts','scripts/verify-private-gallery-sources.mts'].includes(f);
const isTest = f => /\.(?:test|spec)\./.test(f);
console.log(JSON.stringify({files: files.length, tsFiles: files.filter(f => /\.(?:ts|tsx|mts)$/.test(f)).length, externalCounts, unknownBare, unresolved, assets, opaque,
 roots: Object.fromEntries(['src/lib/client-gallery-access.ts','src/app/client-gallery/[handle]/page.tsx'].map(f => { const reached = reach(f); return [f, {count: reached.length, protected: reached.filter(protectedFile), assets: assets.filter(e => reached.includes(e.from))}]; })),
 incoming: Object.entries(edges).filter(([f]) => !protectedFile(f) && !isTest(f)).flatMap(([from, ee]) => ee.filter(e => e.target && protectedFile(e.target)).map(e => ({from, ...e}))),
 protectedFiles: files.filter(protectedFile).sort()
}, null, 2));
if (unknownBare.length || unresolved.length || opaque.length) process.exitCode = 1;
JS
```

The output's `protectedFiles` list makes each family exact at the inspected
snapshot. `incoming` reports non-test source edges from outside that family;
`roots` reports full conservative transitive reachability. Complement it with
tracked searches for each named export, package command and namespace. Graph
success alone never authorizes a file deletion.

## Validation of this audit

The embedded graph command was executed against the baseline; tracked path/link
checks and `git diff --check` passed. The two existing diagram-tool/rendering
test files passed all 29 tests, and all three committed diagrams passed
`npm run diagrams:check`. Root/Studio runtime, schema, dependency,
configuration and diagrams are unchanged, so their complete suites are not rerun
for this documentation-only patch; normal PR CI still applies. No live operator,
cloud, authenticated Studio or customer browser test is claimed. The final
Claude diff review is recorded with this PR; operational clearance remains open.

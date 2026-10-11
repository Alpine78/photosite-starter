# AB#18 — Protected Production candidate, 2026-10-11

Status: staged and checked; public activation and domain cutover are pending.
AB#18, AB#117, AB#137, AB#250 and AB#252 remain Active. This is a preparation
slice, not their completion or a launch decision.

## Source and artifact

PR #329 merged at `050298c28e97a2594d1902144d99108547e2ff17`; Azure Pipelines
main build #778 succeeded for that revision. A fresh worktree built that exact
source with Production's allowlisted public settings, Next.js 16.3.8, Node
24.20.0 on Linux x64, and Vercel CLI 61.0.0. No private dotenv files or credential
values were supplied to the build. Production Sensitive runtime settings remain
provider-managed. Their presence is configuration evidence, not a new successful
contact-delivery test.

The build and upload were manual operator actions, not an Azure Production job
or the CI Preview artifact. Source equality with green CI is established;
artifact equality with a CI-built Production release is not claimed.

The READY Production-target candidate is `dpl_Ct2Dw5DgYcWoSyg8qVFKi8mUMzAG`,
at `photosite-starter-i94sxt3rp-ilkka-rytkonens-projects.vercel.app`. It was uploaded
with `--prebuilt --prod --skip-domain --archive=tgz`. The provider's original
archive matched every local manifest member: 330 physical output entries,
including function-directory symlinks, plus 405 mapped runtime inputs, 735
members in total. No extra, missing or mismatched members were found. Archive
SHA-256: `d29fbe20a1075c01b8c6776ac99e8b6a4e7ff93dbf4547d40e539d7244164bc8`.
The five physical functions use Node.js 24 on x86_64 with empty embedded
environment objects; private environment files were absent from the archive.

Both existing Production aliases still point at `dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU`,
source `8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. The Production target,
attached domains and existing protection bypass inventory were unchanged.
The candidate remains access-protected: anonymous GET received the 302 SSO
challenge; authorized GETs carried `X-Robots-Tag: noindex`.

## Verification

- Thirteen current-content GET cases returned 200, including home, contact,
  service list and packages, housing service, story root, portfolio, English
  stories and services, sitemap and robots.
- The visible home latest-stories section matched an independent published
  `_updatedAt desc, contentId asc` query, and its two story links returned 200.
- Current CMS content selects the portfolio and supplies covers for all eleven
  published Finnish/English service documents. The wedding overview's listing
  flag remains absent in both languages, so it is still listed; its separate
  guarded activation preparation is not a completed CMS mutation.
- The approved service prices were visible. Header and footer marks preserved
  their native 256 × 249 ratio in light and dark themes. Desktop Chromium and
  mobile WebKit showed the language choice and latest stories, without horizontal
  overflow. Portfolio lightbox opening, navigation, closing and reopening passed.
  These are emulated browser checks, not a new physical iPhone acceptance test.
- The complete legacy registry check covered 415 cases and 131 unique redirect
  targets with zero failures among decided mappings: 189 redirects, 174 gone,
  48 pending, three excluded and one already live. Pending cases returned 47
  HTTP 404s and one HTTP 308; those observations do not resolve their decisions.
- Invalid empty contact and revalidation POST probes returned 403 and 400,
  respectively. No email was sent and no genuine cache invalidation was attempted.

Unknown-route and refused-cursor scriptless GETs still returned HTTP 404 and
noindex without a main landmark, heading or recovery link. The exact-candidate
AB#132 check therefore reproduces the known semantic failure. Upstream issue
[Next.js #62228](https://github.com/vercel/next.js/issues/62228) and pull requests
[#98455](https://github.com/vercel/next.js/pull/98455) and
[#98583](https://github.com/vercel/next.js/pull/98583) were still open on 2026-10-11;
neither pull request was merged. ADR-0007 records the completed 8 October recheck
and preserves the owner's bounded 7 October acceptance. This new observation
does not extend that acceptance, close AB#132, or supply a launch decision.

The current enabled Production Sanity webhook targets the existing Production
alias and the `production` dataset; Preview also reads that dataset. Their
identity-only event rules and the earlier genuine-delivery evidence are recorded
in AB#137. No hook or secret was changed here. A genuine event reaching the
activated candidate remains a post-activation check.

## Remaining release gates

The public default Vercel alias currently answers 200 without `X-Robots-Tag`;
the generated team alias challenges anonymous access. Their protection and
indexing policy after activation must be resolved and verified. The canonical
custom domain still serves Joomla. No Production alias was moved by this slice.

An exact alias restore target was recorded, but a rollback exercise was not run.
Activation still needs the release/security checks and exact binding checks;
then the wedding overview listing change needs a fresh complete CMS baseline,
guarded write, genuine webhook check and temporary-key revocation. Retained
customer galleries still need a supported whole-ZIP transfer method and their
remaining import gates. Custom-domain DNS, HTTPS, canonical redirects and final
contact-delivery acceptance remain cutover checks. Infomaniak mail records must
be preserved.

Private snapshots, deployment metadata, operator helpers, manifests and browser
captures stay in the ignored owner evidence directory. They are not public
content or committed backup material. No customer-gallery upload, CMS write,
credential rotation, public activation or DNS change was performed here.

Refs AB#18 AB#117 AB#137 AB#250 AB#252 AB#132 AB#19

# AB#18 — site and Studio publication, 2026-10-18

The owner requested publication for phone and desktop testing after merging
PRs #495–#504. The existing production site and Studio now use the accepted
main source `33cb41ac44b3a395263fe5710ee78a238fb3e9e9`. This records that
publication; AB#18, AB#117 and AB#137 remain **Active** because their broader
launch, security and operational acceptance criteria are not complete.

## Published source and provider evidence

| Surface | Before | Published |
| --- | --- | --- |
| Vercel production | `dpl_2MT9Myy1cXRFTFCVTpGhMdbaLGLo`, source `6cdc231272fb9f1258bc5cf01f5c33c5df281ff8` | `dpl_Hzr1PEYsXPMKMmVXtKJG5KrGo9wv`, source `33cb41ac44b3a395263fe5710ee78a238fb3e9e9` |
| Hosted Studio | `xlnkjs1wuujouo8qccy0r5bf`, 2026-10-11 | `g7gul7gnkadxlna70rzgr7ah`, 2026-10-18 08:40:07 UTC |

- [Public website](https://www.ilkansivu.net), with the apex redirecting to `www`.
- [Existing Studio entry](https://ilkansivu.sanity.studio/), redirecting to the
  existing Sanity Dashboard application and its authentication boundary.
- [Exact-source Azure CI #1230](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=1230&view=results)
  passed the complete definition: lint, unit tests, production build, Playwright,
  Studio, and protected Preview publication/verification. It completed at
  08:37:40 UTC before production promotion and Studio publication.

The local production build used fifteen allowlisted public settings. Its source
and physical output were fingerprinted; all 873 members of the original
provider-upload archive matched the local artifact. The same protected, verified
Vercel deployment was promoted without rebuilding or changing its source.
All four existing production aliases resolve to that deployment. CI legitimately
refreshed the stable Preview alias to another READY deployment of the exact same
main SHA; its project, team and non-production ownership were checked and that
fresh alias was preserved. Environment, deployment protection and domain
configuration remained unchanged; no DNS or mail record was edited.

To let the complete current-source CI run proceed, only verified superseded
main runs #1223–#1228 and duplicate #1229 were cancelled. Each source was checked
against the accepted main history. Their logs and existing PR checks were
preserved; no quality job in #1230 was bypassed.

## Verification performed

- Studio typecheck, schema validation and build passed. Publication used the
  existing app, project and Production dataset, required schema deployment and
  disabled automatic updates. Registry readback confirms the new active
  deployment, version 6.18.0 and unchanged project/dataset identity.
- A fresh hosted Studio manifest and the referenced versioned JavaScript and CSS
  matched the local published bytes. An initial unversioned manifest request hit
  an older cache entry; a cache-busting read returned the new manifest. Anonymous
  Studio HTML redirects to Dashboard authentication, so it is not a comparable
  uploaded `index.html`. Authenticated editor flows still require owner testing.
- Before promotion, five FI/EN HTTP routes and six desktop Chromium / phone-size
  WebKit page checks passed. The protected candidate returned the expected
  authentication redirect without bypass; its bypassed response retained
  `noindex` and the security headers.
- The actual public rally gallery passed 24 → 48 → 72 image loading, opening
  appended image 25, zoom, close/reopen and focus/viewport restoration on both
  engines against that same candidate. No `object-fit: cover` was found on the
  initially rendered images or the restored lightbox item.
- After promotion, six production HTTP checks passed for FI/EN home/contact,
  robots and sitemap, including canonical origin, public indexability, security
  headers, no response cookies, DNS resolution and the apex 308 redirect.
- Five production route reads and six public browser page checks then passed
  without a deployment-protection bypass, horizontal overflow or runtime errors.
- The existing signed public-cache refresh completed successfully using the
  current webhook credential. This is cache evidence, not proof of a new CMS
  publication webhook delivery. No contact or photo-enquiry email was sent.

The actual rally page for the owner's device check is
[here](https://www.ilkansivu.net/tarinat/moottoriurheilu/wrc/neste-rally-finland-2017).
Load two more batches, open an appended image, zoom/pan, close and reopen it,
and confirm the same thumbnail and page position remain usable. Automated
WebKit is not a physical iPhone 16 Pro Max Safari test (AB#251).

## Recovery and remaining acceptance

The previous known production deployment remains identified for Vercel rollback.
The exact old Studio schema and all 339 old build files were recovered, byte
checked and archived with a same-application restore procedure. That procedure
was not executed against production; this publication does not claim a new
live rollback rehearsal or complete handoff acceptance.

Operational evidence, provider snapshots, source/output fingerprints and private
rollback artifacts are retained under the ignored
`temp/work-batch-2026-10-18-day/release/` and `client-gallery/` directories.
Credentials and private content are not committed with this audit.

The new Sanity-native client-gallery reader remains at its existing default-off
production setting. A named test gallery and concrete activation/content scope
are still required. No S3 or separate database was provisioned, and the 21
retained legacy galleries were not changed by this release. The separately
approved AB#172 content operation has its own execution and recovery record;
its approval is not a blanket CMS-change authorization for this publication.

AB#132's scriptless matched-route 404 limitation remains open. The temporary
acceptance is preserved; its 2026-10-08 review date has passed. This publication
does not renew it. The owner still needs to set the next review date. The owner also needs
to verify authenticated Studio editing, the physical iPhone journey and the
specific AB#289 photo-enquiry inbox/Reply-To receipt. These are not replaced by
successful homepage checks or another contact message's receipt.

## Review workflow

Claude Sonnet 5.5 at high effort reviewed the operational plan once before work.
The verified dispositions tightened public build settings, exact-source CI,
cache freshness, Studio identity/recovery, DNS readback and the AB#132 residual
record. Codex inspected the resulting provider receipts and publication scope.
The evidence-only documentation receives its final bounded diff review before
commit and PR publication.

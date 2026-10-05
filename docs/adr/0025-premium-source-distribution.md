# ADR-0025: Separate Premium source distribution and updates

**Status:** Proposed
**Date:** 2026-10-05
**Deciders:** Project owner, pending acceptance
**Work item:** AB#44

## Context

The public starter is MIT source. No paid artifact or entitlement service exists.
[ADR-0024](0024-free-core-and-premium-boundary.md) proposes separately licensed
themes and services; [ADR-0023](0023-customer-customization-and-upstream-updates.md)
and the [release policy](../release-policy.md) are also proposals. This record
compares delivery options so the owner can review them without building Premium
infrastructure before AB#42 or treating AB#45's unvalidated offer as demand.

A GitHub template-generated repository starts with a new history. Adding its
template as a remote does not establish a common merge base for ordinary updates.
An actual fork retains history. This distinction must appear in onboarding.
[GitHub template documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)
(checked 2026-10-05).

## Decision

**Proposed initial method:** manually deliver a versioned source ZIP through an
owner-controlled, recipient-authorized download channel. The owner verifies the
order and entitlement outside the customer's site and sends download instructions
through the agreed customer contact channel. Selecting and exercising that secure
channel is a pre-sale action, not an existing feature or a promise that an ordinary
public link is private. No customer production site calls an entitlement server.

Each artifact contains separately identified proprietary files, its license and
third-party notices, an exact core compatibility revision/range, release and
migration notes, and a per-file SHA-256 manifest. Keep prior releases and the
customer's exact installation baseline available under the agreed access terms;
deliver a baseline copy at handoff so exit does not depend on continued access.
Exclude credentials, customer content, build output and installed dependencies.
Do not copy paid files into this repository or imply that its MIT license covers
them. This proposal sets no price, site limit, refund rule or update term; AB#49
and owner acceptance supply those before sale.

**One migration path:** move the same ZIP artifacts to releases in a private
distribution repository when manual delivery becomes burdensome. Customers gain
read access only for the agreed update entitlement; the archive format and
installation baseline stay unchanged. Record the actual hours spent on delivery,
update requests and access support before choosing the threshold. Rehearse access
removal, download, Windows onboarding and customer exit before relying on it.
Read permission grants visibility to that repository's history and releases, so it
cannot implement different per-customer version entitlements inside one repository.
Keep customer-specific files outside the shared distribution repository.

Removing channel/repository access stops future downloads. It cannot recall source
already downloaded or disable an installed site. Continued use follows the actual
license and agreement. SHA-256 detects changed bytes; a digest delivered through
the same channel does not independently authenticate the publisher. Do not market
it as a signature. No runtime locks, watermarking or customer tracking is proposed.

## Options Considered

| Dimension | Private repository / releases | Downloadable source archives | Private npm packages |
| --- | --- | --- | --- |
| Onboarding | Customer GitHub account, access grant and repository instructions | Authorized delivery, unzip and baseline instructions; no registry credentials | Registry setup and credentials on each development/build environment |
| Updates | Versioned releases; Git merges only with an established common base | Compare installed baseline, local changes and next archive | Pin a package version; needs a stable integration boundary and migration notes |
| Revocation | Remove read access for future downloads; existing copies remain | Revoke download entitlement; existing copies remain | Revoke registry access for future installs; caches and installed copies remain |
| Source access | Entire shared repository/history unless separated | Exact licensed source snapshot | Source only if deliberately included; package packaging can omit source |
| Windows | Git for Windows or browser ZIP; commands need PowerShell verification | Native ZIP handling; preserve case and path names, no POSIX-only installer | Node/npm and registry auth; CI configuration still needed |
| Cost | Account-plan limits plus access administration; verify plan before sale | Delivery service storage/transfer plus manual effort; provider unselected | Plan-dependent private storage/transfer and credential support |
| Exit | Customer keeps downloaded baseline/source under its terms | Customer keeps installed snapshot, baseline, notices and notes | Customer needs cached source/package and a rebuild path without registry access |

GitHub releases are tied to tags, and readers can access releases; automatic source
ZIPs are available. Uploaded source artifacts can have a deliberately scoped
manifest rather than relying on a whole-repository ZIP.
[Release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
(checked 2026-10-05).

For GitHub's npm registry, current documentation requires classic PAT authentication
for local use, with workflow-specific token options. Private package storage and
transfer consume plan-dependent quotas. This is an onboarding/build burden, not a
requirement for visitors to authenticate.
[Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)
(checked 2026-10-05). No price or unlimited private service is assumed.

## Trade-off Analysis

Archives require deliberate update review, but avoid choosing a package API before
repeated customer evidence. Private releases later automate discovery and preserve
the same artifact. Private packages are deferred until a stable theme API and enough
customers justify registry credential support; that would require a new decision.

Updates are not blanket extraction over a customized checkout. Retain the baseline
snapshot and compare three versions: baseline, customer's current file, next release.
An untouched file can be replaced after checking its baseline hash. Text changed on
both sides needs a three-way review. A missing baseline or digest is a refusal to
automatically replace a file, not a reason to assume it is unchanged.

| Change | Review rule |
| --- | --- |
| Upstream deletes a locally changed file | Keep the local file until the owner resolves the deletion |
| Upstream renames a file | Treat as explicit migration; never infer ownership from a similar filename |
| Both sides add the same path | Conflict, even without a baseline |
| Binary asset changes on both sides | Choose deliberately; no text merge or image conversion |
| LF/CRLF differences | Preserve originals; inspect an agreed normalization in staging only |
| Any unresolved conflict | Apply nothing; discard staging or keep it for review |

For customers already using a history-preserving fork, normal Git merge/review is
the appropriate core update path. A template clone needs a deliberately established
baseline or a reviewed patch process; `--allow-unrelated-histories` is not an updater.

### Small local proof of concept

This synthetic text-only experiment is independent of Git history. With Git
installed, create three files outside the repository:

```text
baseline.txt        local.txt           next.txt
accent=default      accent=customer     accent=default
focus=old           focus=old           focus=accessible
```

Run in Bash or PowerShell (redirection encoding must be checked on Windows):

```sh
git merge-file --stdout --diff3 local.txt baseline.txt next.txt
```

These adjacent edits can conflict: a tool's conflict is useful evidence, not
permission to choose one side. For a clean case, separate the edits with unchanged
context lines. Review the merged output in a new staging file; never redirect it
over `local.txt`. A zero exit means the tool found no conflict, not that the theme
is compatible. Any nonzero exit requires manual review (Git describes errors as negative; a shell
may expose them as a wrapped exit code).
[Git merge-file manual](https://git-scm.com/docs/git-merge-file)
(checked 2026-10-05).
Test one deliberate overlapping edit too and confirm neither input changes.

The 2026-10-05 WSL experiment used separated edits, preserved both changes, rejected
an overlapping edit, and compared the original input bytes afterward. It also
preserved CRLF inputs in a clean merge. No repository or commit was created.
Native Windows/PowerShell execution, binary migration and a full customer update
remain unverified; this experiment does not claim an implemented installer.

## Consequences

Customer source, CMS and provider ownership remain separate from delivery access.
Manual entitlement records must minimize customer data and have their own retention
policy. Every paid artifact needs a separate licensing inventory (AB#43). A release
and an update entitlement do not create an automatic deployment or a support SLA.

## Action Items

1. Owner accepts AB#42's boundary, validates the offer (AB#45), then accepts or revises
   this proposal. AB#44 remains Active pending acceptance.
2. Review the paid license and sales/support terms (AB#49), verify the delivery
   provider's privacy/cost/access controls and exercise actual authorized delivery.
3. Test Windows download/extraction, the baseline/update process, conflicts and exit
   on synthetic artifacts before first sale. No customer files are needed.
4. Revisit private releases when recorded manual work warrants it; revisit packages
   only when a stable theme API is established.

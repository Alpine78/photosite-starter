# AB#255 — Bilingual release preparation, 2026-10-13

This is a preparation checkpoint, not permission to publish CMS content or
deploy Studio/the public site. AB#255 remains Active. PR #375 merged as f58be98;
the approved article authoring correction is now on main. Studio corrections
remain in their own PRs, with #371 preceding #370.

## Current content target

Two matching authenticated GET-only metadata reads completed at
2026-10-13T12:02:27.829Z (15:02 Europe/Helsinki). They used the owner's Viewer
credential, API v2025-02-19 and raw perspective against the configured production
Content Lake target. Drafts and published records were counted separately.
No body text, image bytes, private-gallery data or credentials were fetched.

| Family | Published FI | Published EN | Missing published EN | EN editing drafts |
| --- | ---: | ---: | ---: | ---: |
| Articles | 28 | 10 | 18 | 18 |
| Public galleries | 32 | 32 | 0 | 0 |
| Services/packages | 8 | 3 | 5 | 0 |

The 12 published shared category documents have 12 FI label/slug pairs and
11 EN pairs. All 18 EN article drafts still have pending editing-review fields.
Declared gallery language pairs do not establish accepted translation quality.

The prepared English additions for the missing category and five services were
reconciled by exact source ID/revision: all six source revisions still match the
retained proposal packet. Their owner wording/slug acceptance is still pending.
The private category/service review workbook is copied into this worktree's
ignored temp/release directory; hashes, read receipts and source metadata stay
private. Recheck revisions immediately before any later authorized write.

## Order of work

1. Finish CI and normal review for #371, then #370. #370 includes the tested
   #371 parent changes so its configuration conflict is resolved once, before
   publication. Keep the same commit heads under review; rerun checks if changed.
2. Build/deploy the combined Studio only after source merge and deployment
   authorization. Its existing npm run deploy command builds notices and deploys
   the schema; do not treat a local build or authenticated local UI as hosting.
3. Review the exact category/service wording and slugs. Create only separately
   approved editing versions after fresh source/target/variant checks. The
   existing category/service seed CLIs are not generic patch adapters: retain
   the shared category identity and every service's current cover/pricing/parent
   fields. No unreviewed replacement or automatic publication is implied.
4. Complete the EN canonical category before publishing its 18 dependent article
   versions. Review the existing drafts in Studio: approved text and slugs,
   category references, blocks, source-only poll omission, end-gallery placement
   bindings and remaining required editing fields. Do not recreate existing drafts.
5. Review gallery document wording/section labels and existing home/contact copy.
   General album-image caption/alt authoring is deferred after MVP; this checkpoint
   does not generate descriptions or remove existing text/media contracts.
6. After content approval, publication and a separately authorized site deployment,
   verify real FI/EN destinations, equivalent language links, canonical/hreflang,
   sitemap entries, contact form/service retention and failure states. Check
   customer/admin locale queries under existing authorization and cache policies.
   Fixture journeys alone do not accept real content or activate a release.

## Prepared source evidence

#371 has a localized language selector, the 159 core resource additions and
localized keyboard-drag instructions/announcements. #370 completes compiled type
headings/help, document-list text and full-frame list media. The combined
authenticated check sees 31 Kuva/Image prefixes in the corresponding language,
31 fit=max image requests and no fit=crop requests in each list view, and unchanged
editor values across language switching. Private receipts remain in the Studio
worktrees; their public implementation audits describe the exact test limits.

The source publication order is #371 → #370 → this documentation PR. Current
final-head CI and owner review must pass before merge. Studio configuration uses
pinned internal SDK bridges, which need a compatibility check on SDK upgrades.
Existing dependency audit advisories are unchanged; no force upgrade is included.

Already merged #372 supplies restricted/customer/admin/error FI/EN UI selection
through ADR-0032's validated query without a new preference cookie. #373 supplies
default-service sibling links. Preserve their security, URL and media contracts.

This checkpoint issues no CMS mutation, content publication, hosted deployment,
alias promotion or PR merge. Complete-page acceptance and the broader production
release remain owner decisions; the current live deployment revision was not
re-read by this content inventory. Retained ZIP transport and other migration
release work remain separate from these localization branches.

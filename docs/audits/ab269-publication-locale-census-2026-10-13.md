# AB#269 — bilingual publication census, 2026-10-13

AB#269 moved New → Active before implementation under AB#255. A fresh authenticated
GET-only `raw` capture completed at `2026-10-13T14:15:58.754Z`: 17,609 documents,
5,158 assets, and matching complete sorted revision manifests before/after paging.
Raw SHA-256: `379ff9e99232bd8ad73475b0bff62e5616b10b4aebfdd50a8de26140e9a879cc`.
Snapshot and detailed report remain ignored, mode 600 under mode 700 directories.

| Family | Identities | Finnish published | English published | English gap | Editing drafts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Article | 28 | 28 | 10 | 18 | 18 |
| Gallery | 32 | 32 | 32 | 0 | 0 |
| Service | 8 | 8 | 3 | 5 | 0 |
| Category | 12 | 12 | 11 | 1 | 0 |

All eighteen article drafts retain pending editorial fields. They do not count as
published English coverage. The missing English category is also a prerequisite
for affected drafts. Existing body text, omitted-poll decisions, end-gallery
placements, media, reviews and revisions were not changed. No publication occurred.

Synthetic tests cover version separation, duplicate identities and raw IDs,
canonical/ancestor language prerequisites and cycles, malformed review state,
source mismatch, service identity, language syntax, UTF-8 and revision binding.
Private IO tests cover visibility, permissions, bounds, links and evidence preservation.
Local lint, strict TypeScript, all 5,977 browser-free tests and a synthetic
production build passed. No public journey changed; the mandatory PR CI still
runs the full journey and Studio gates. Security self-review checked untrusted
input bounds, private evidence and fail-closed projection; no unresolved finding
remains in this slice. This is not final owner security/privacy acceptance. This census does not establish
translation quality, all-page acceptance or permission to publish. AB#255 remains
Active, and AB#269 stays Active until its reviewed PR is accepted and merged.

See [the operator contract](../publication-locale-census.md).

Final review replaced repeated family/category scans with indexed lookups; a
1,000-identity synthetic family verifies separated language counts. All gates
and the real frozen-snapshot census were repeated after this bounded-cost change.

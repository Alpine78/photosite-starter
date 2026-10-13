# AB#255 — Studio drag accessibility completion, 2026-10-13

PR #371 now supplies Finnish and English keyboard-drag instructions and live
announcements. Sanity 6.18.0's SortableList does not forward accessibility options
to DndContext. A narrowly matched Vite alias wraps that exported component,
passes the documented accessibility options and re-exports its native module.
Sensors, sortable context, handlers, patches and caller-provided accessibility
options remain unchanged. Installed SDK files are not edited.

The already installed @dnd-kit/core 6.3.1 is declared as a direct dependency for
this API use. Comparing lockfiles confirms that only the root dependency map
changed; every installed dependency/version/integrity entry is unchanged. The
existing audit reports eight moderate advisories; this change introduces no new
package version. Recheck the exact alias and pinned SDK integration on upgrades.

The 159-key Finnish catalog received a wording check. Release-limit copy now
works for any interpolated count, and formatting terminology was clarified.
Interpolation, plural forms, markup, English fallback and license notices remain.

## Verification

- Native Windows Chrome, authenticated by the owner, displays the Finnish
  instructions in two rendered array accessibility regions. Switching to English
  displays the English instructions. The same combined preview includes #370.
- Browser-dispatched keyboard events exercised local drag activation and
  cancellation. Live-region text is Finnish; no item was moved or dropped.
  Editor values were compared without exporting their contents. Windows CDP
  key dispatch alone did not reliably reach the drag sensor, so this is not a
  physical-keyboard or spoken-screen-reader acceptance claim.
- Resource-engine and drag tests pass. Full suite: 5,832 tests; lint, Studio
  typecheck/build and the CI-mock Next.js production build pass.
- CMS document writes are guarded during the UI check. The later guard also
  blocks SDK descriptor/schema synchronization. No authored content was changed
  or published. Local UI verification is separate from hosted Studio deployment.

Final committed-head CI and normal PR/wording review remain. Unused core views
are source/resource tested rather than claimed as individually live-tested.
AB#255 remains Active; this PR does not close all-page bilingual coverage.

References: [Sanity CLI Vite configuration](https://www.sanity.io/docs/apis-and-sdks/cli-config),
[dnd-kit accessibility API](https://dndkit.com/legacy/guides/accessibility/).

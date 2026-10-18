import type { ExistingImageState } from "../studio/existing-client-web-images";
import type { ExistingImageViewProps } from "../studio/existing-client-web-images-view";
/** Synthetic markup-only keyboard fixture. No Studio session, network or customer data. */
export function existingImageViewFixture(locale = "en-GB", state?: Partial<ExistingImageState>): ExistingImageViewProps {
  return {
    id: "existing-web-image-fixture", locale, value: undefined, readOnly: false,
    state: { cutoff: "", badInput: false, selectionCleared: false, phase: "ready", selected: [], visible: 64, truncated: false, rows: [1, 2].map(n => ({
      _id: `image-${n.toString(16).padStart(40, "0")}-1600x1000-webp`, _type: "sanity.imageAsset",
      sha1hash: n.toString(16).padStart(40, "0"), extension: "webp", mimeType: "image/webp", width: 1600, height: 1000,
      restricted: false, _createdAt: "2026-10-17T00:00:00Z",
    })), ...state },
    thumbnail: () => null, onCutoffChange() {}, onSearch() {}, onOpen() {}, onClose() {}, onRetry() {}, onMore() {}, onClear() {}, onToggle() {}, onAdd() {},
  };
}

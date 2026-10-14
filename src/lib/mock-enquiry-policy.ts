/** Synthetic public action hints; no archive/provider records are exposed. */
const allowedFixtureMedia = new Set([
  "coastal-landscape", "forest-stream", "open-marsh", "misty-birch",
  "capture-sequence-0002", "boundary-portrait",
]);
export function mockMediaAllowsEnquiries(mediaId: string): boolean {
  return allowedFixtureMedia.has(mediaId);
}

/** One fixture gallery is disabled in both locales; others use the enabled default. */
export function mockGalleryEnquiryPermission(contentId: string): boolean | undefined {
  return contentId === "content-layout-single" ? false : undefined;
}

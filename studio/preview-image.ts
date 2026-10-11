/** Only asset identities enter thumbnails; authored crop/hotspot data is discarded. */
export function previewImageId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const asset = record.asset && typeof record.asset === "object"
    ? record.asset as Record<string, unknown> : record;
  const id = asset._ref ?? asset._id;
  return typeof id === "string" && /^image-[a-zA-Z0-9]+-[1-9]\d*x[1-9]\d*-[a-z0-9]+$/.test(id)
    ? id : undefined;
}

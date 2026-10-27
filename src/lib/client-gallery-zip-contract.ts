/** Public technical ZIP contract, shared by server and owner-run tooling.
 * No credential, IO, approval certificate or source filename crosses this module.
 */
export const CLIENT_GALLERY_ZIP_MAX_BYTES = 1_000_000_000;
export type ClientGalleryZipReference = Readonly<{ assetId: string; hash: string }>;
export type ClientGalleryZipAsset = ClientGalleryZipReference & Readonly<{ revision: string; bytes: number }>;
const ZIP_ID = /^file-([a-f0-9]{40})-zip$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;
function invalid(): never { throw new TypeError("Invalid client gallery ZIP"); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && Reflect.ownKeys(value).length === fields.length && fields.every(name =>
    Object.hasOwn(value, name) && Object.getOwnPropertyDescriptor(value, name)?.enumerable === true &&
    "value" in Object.getOwnPropertyDescriptor(value, name)!);
}
export function parseClientGalleryZipReference(value: unknown): ClientGalleryZipReference | undefined {
  if (value == null) return undefined;
  if (!exact(value, ["_type", "asset"]) || value._type !== "file" ||
    !exact(value.asset, ["_type", "_ref"]) || value.asset._type !== "reference" || typeof value.asset._ref !== "string") return invalid();
  const match = ZIP_ID.exec(value.asset._ref);
  if (!match || match[0] !== value.asset._ref) return invalid();
  return { assetId: value.asset._ref, hash: match[1] };
}
/** Native asset documents are public too: no authored labels, source locators or arbitrary metadata. */
export function parseClientGalleryZipAsset(value: unknown, assetId: string): ClientGalleryZipAsset {
  const match = ZIP_ID.exec(assetId);
  const fields = ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "assetId", "extension", "mimeType", "sha1hash", "size", "originalFilename", "url", "path", "uploadId", "metadata"];
  if (!match || match[0] !== assetId || !object(value) || Reflect.ownKeys(value).some(name =>
    typeof name !== "string" || !fields.includes(name) || !("value" in Object.getOwnPropertyDescriptor(value, name)!)) ||
    value._id !== assetId || value._type !== "sanity.fileAsset" || value.sha1hash !== match[1] || value.extension !== "zip" ||
    typeof value.mimeType !== "string" || !["application/zip", "application/x-zip-compressed"].includes(value.mimeType) ||
    typeof value._rev !== "string" || REVISION.exec(value._rev)?.[0] !== value._rev ||
    typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > CLIENT_GALLERY_ZIP_MAX_BYTES ||
    value.originalFilename != null && (typeof value.originalFilename !== "string" || !["delivery.zip", "photographs.zip"].includes(value.originalFilename)) ||
    value.metadata != null && (!object(value.metadata) || Reflect.ownKeys(value.metadata).length !== 0)) return invalid();
  return { assetId, hash: match[1], revision: value._rev, bytes: value.size };
}
/** No provider URL or filename is accepted; both verification and customer reads use this builder. */
export function clientGalleryZipUrl(projectId: string, dataset: string, assetId: string): string {
  const match = ZIP_ID.exec(assetId);
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.exec(projectId)?.[0] !== projectId ||
    /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u.exec(dataset)?.[0] !== dataset || !match || match[0] !== assetId) return invalid();
  return `https://cdn.sanity.io/files/${projectId}/${dataset}/${match[1]}.zip?dl=photographs.zip`;
}

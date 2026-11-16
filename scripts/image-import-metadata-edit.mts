/**
 * AB#391 / ADR-0039 decision 8: the field-level edits one owner JPEG gets before upload.
 * A JPEG of at most 2048 px keeps its compressed image data byte for byte. A larger one
 * becomes the public derivative with the kept metadata carried over. Every result is
 * checked before it is returned, so a tool surprise fails the import rather than
 * publishing a keyword. Non-JPEG public sources keep today's metadata-free derivative.
 * Client web images keep everything instead (`carryAllMetadata`, owner decision 2026-11-04).
 *
 * `exiftool-vendored` is a devDependency for owner-run tooling only (recorded in
 * `docs/asset-inventory.md`). The caller owns the process from `createImportMetadataTool`
 * and ends it.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ExifTool } from "exiftool-vendored";
import sharp, { type Metadata } from "sharp";

import { compressedImageDataSha256, importActionFor, inspectJpegImportFacts, type ImportAction } from "./image-import-metadata.mts";
import { generatePublicDerivative, type PublicDerivative } from "./joomla-image-derivative.mts";
import { PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";

/** Everything decision 8 removes. City and country stay, as does everything not named here. */
const REMOVED_TAGS = [
  "XMP-dc:Subject",
  "XMP-lr:HierarchicalSubject",
  "XMP-lr:WeightedFlatSubject",
  "IPTC:Keywords",
  "XMP-iptcCore:CreatorAddress",
  "XMP-iptcCore:CreatorRegion",
  "XMP-iptcCore:CreatorPostalCode",
] as const;

/**
 * Copied field by field, ExifTool changes values: it added a time zone to IPTC times that
 * had none and re-rounded rational EXIF numbers. It also leaves behind a JPEG comment, the
 * IPTC charset and every XMP property outside its own tables. So the blocks are copied whole
 * after `-all:all`, which still brings what they do not hold.
 */
export const COPY_ARGUMENTS: readonly string[] = ["-all:all", "-unsafe", "--ICC_Profile:all", "-exif", "-iptc", "-xmp", "-Comment"];

/**
 * Facts of the source that the derivative's pixels no longer match. Its orientation is
 * already applied, so copying the tag would rotate it twice. Its thumbnail and size fields
 * describe the source. Sharp converts it to sRGB, so the colour profile is not copied.
 */
const STALE_ARGUMENTS: readonly string[] = [
  "-IFD0:Orientation=", "-IFD0:ImageWidth=", "-IFD0:ImageHeight=", "-IFD1:all=", "-Photoshop:PhotoshopThumbnail=",
  "-ExifIFD:ExifImageWidth=", "-ExifIFD:ExifImageHeight=",
  "-XMP-tiff:Orientation=", "-XMP-tiff:ImageWidth=", "-XMP-tiff:ImageHeight=", "-XMP-exif:PixelXDimension=", "-XMP-exif:PixelYDimension=",
  // An image inside the XMP block could also exceed the public bound.
  "-XMP-xmp:Thumbnails=",
];

/**
 * Where a photograph was taken, for one the owner marks sensitive (ADR-0039 decision 8). The
 * creator's own city and country are contact details, not this, so they stay.
 */
const LOCATION_TAGS = [
  "XMP-xmpDM:ShotLocation",
  "XMP:GPS*", "XMP-iptcExt:LocationCreated", "XMP-iptcExt:LocationShown",
  "XMP-photoshop:City", "XMP-photoshop:State", "XMP-photoshop:Country", "XMP-iptcCore:Location", "XMP-iptcCore:CountryCode",
  "IPTC:City", "IPTC:Sub-location", "IPTC:Province-State", "IPTC:Country-PrimaryLocationName", "IPTC:Country-PrimaryLocationCode",
  "IPTC:ContentLocationName", "IPTC:ContentLocationCode",
] as const;
const LOCATION_ARGUMENTS: readonly string[] = [
  "-Location:all=", "--XMP-iptcCore:CreatorCity", "--XMP-iptcCore:CreatorCountry",
  "-GPS:all=", ...LOCATION_TAGS.map((tag) => `-${tag}=`),
  // Embedded images can carry their own location. Remove them whole, never recursively edit them.
  "-IFD1:all=", "-ThumbnailImage=", "-PreviewImage=", "-PhotoshopThumbnail=", "-PhotoshopBGRThumbnail=", "-XMP-xmp:Thumbnails=",
];

/**
 * Family 2 Location catches fields whose names do not name a place. ShotLocation is
 * classified as Image by ExifTool, so the name check still matters. Only the creator's
 * own contact city and country are exempt from location removal.
 */
const LOCATION_FIELD_NAME = /^(?:GPS|Location|ShotLocation$|Sub-?location|City$|State$|Province|Country|ContentLocation)/;
const isLocationField = (field: string): boolean => {
  const parts = field.split(":"), tag = parts.at(-1)!;
  if (parts[0] === "XMP-iptcCore" && (tag === "CreatorCity" || tag === "CreatorCountry")) return false;
  return parts.slice(1, -1).includes("Location") || LOCATION_FIELD_NAME.test(tag);
};
/** Anchored: Lightroom's `XMP-crs:UprightPreview` is a setting on half the archive, not an image. */
const isPreviewField = (field: string): boolean => /^(?:Thumbnail|Preview|PhotoshopThumbnail|PhotoshopBGRThumbnail)/.test(field.split(":").at(-1)!);

export const REMOVAL_ARGUMENTS: readonly string[] = REMOVED_TAGS.map((tag) => `-${tag}=`);

export class ImportMetadataError extends Error {
  readonly code: "COMPRESSED_DATA_CHANGED" | "METADATA_REMAINS" | "METADATA_NOT_CARRIED" | "PIXELS_CHANGED" | "TOOL_FAILED" | "UNDECODABLE_IMAGE";
  constructor(code: ImportMetadataError["code"]) {
    super(`[image-import-metadata] ${code}`);
    this.name = "ImportMetadataError";
    this.code = code;
  }
}

async function editCopy(bytes: Uint8Array, edit: (file: string, directory: string) => Promise<void>, extension = "jpg"): Promise<Uint8Array> {
  const directory = await mkdtemp(path.join(tmpdir(), "import-metadata-"));
  try {
    const file = path.join(directory, `image.${extension}`);
    await writeFile(file, bytes, { mode: 0o600 });
    await edit(file, directory);
    return new Uint8Array(await readFile(file));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertResult(result: Uint8Array, expectedCompressedData: string, removeLocation = false): void {
  if (compressedImageDataSha256(result) !== expectedCompressedData) throw new ImportMetadataError("COMPRESSED_DATA_CHANGED");
  const facts = inspectJpegImportFacts(result);
  if (facts.keywordMetadata || facts.creatorPostalAddress || (removeLocation && facts.gps !== "absent")) throw new ImportMetadataError("METADATA_REMAINS");
}

export type ImportMetadataTool = Pick<ExifTool, "write" | "readRaw">;

const readFields = (tool: ImportMetadataTool, file: string, removeLocation: boolean) => tool.readRaw(file, { readArgs: [removeLocation ? "-G1:2" : "-G1", "-u"] }) as unknown as Promise<Record<string, unknown>>;

/** Ignore computed location and file facts; every embedded preview must be absent. */
async function assertNoLocation(tool: ImportMetadataTool, file: string): Promise<void> {
  let fields: Record<string, unknown>;
  try { fields = await tool.readRaw(file, { readArgs: ["-G1:2", "-u"] }) as unknown as Record<string, unknown>; }
  catch { throw new ImportMetadataError("TOOL_FAILED"); }
  for (const field of Object.keys(fields)) {
    if (field.includes(":") && (isPreviewField(field) || field.split(":").includes("Preview") || (!/^(?:Composite|File|System|ExifTool):/.test(field) && isLocationField(field)))) throw new ImportMetadataError("METADATA_REMAINS");
  }
}

/**
 * `useMWG: false` is essential, and the wrapper allows it only per instance: with its
 * default a copy rewrote the IPTC and XMP creator from the EXIF artist, silently replacing
 * a name with a different one.
 */
export function createImportMetadataTool(): ExifTool {
  return new ExifTool({ maxProcs: 1, useMWG: false });
}

async function runTool(tool: ImportMetadataTool, file: string, writeArgs: readonly string[]): Promise<void> {
  try {
    await tool.write(file, {}, { writeArgs: ["-overwrite_original", ...writeArgs] });
  } catch {
    throw new ImportMetadataError("TOOL_FAILED");
  }
}

/**
 * Facts about the file or its encoding, which a new copy rightly does not share. The last two
 * of the tags are a block's own housekeeping, which ExifTool drops with the block's last real field.
 */
const NOT_COMPARED_GROUP = /^(?:System|ExifTool|Composite|File|JFIF|ICC.*|IFD1|MPF.*|MPImage.*|APP\d*|Adobe|PNG|WEBP|RIFF|QuickTime|Track.*|Meta.*|HEIF)$/;
const NOT_COMPARED_TAG = /^(?:Orientation|ImageWidth|ImageHeight|ExifImageWidth|ExifImageHeight|PixelXDimension|PixelYDimension|ThumbnailImage|ThumbnailFormat|ThumbnailWidth|ThumbnailHeight|PhotoshopThumbnail|PreviewImage.*|IPTCDigest|XMPToolkit|ApplicationRecordVersion|YCbCrPositioning)$/;
/** Print size in Photoshop's own block, which ExifTool does not copy. It described the larger source. */
const NOT_COMPARED_FIELD = new Set(["Photoshop:XResolution", "Photoshop:YResolution", "Photoshop:DisplayedUnitsX", "Photoshop:DisplayedUnitsY"]);

/**
 * Every field of the source must arrive with its value, apart from `removed`. A check of
 * whole groups passed when ExifTool had dropped one custom XMP property next to others.
 */
async function assertNothingLost(tool: ImportMetadataTool, source: string, result: string, removed: readonly string[], removeLocation: boolean): Promise<void> {
  let before: Record<string, unknown>, after: Record<string, unknown>;
  try { [before, after] = await Promise.all([readFields(tool, source, removeLocation), readFields(tool, result, removeLocation)]); }
  catch { throw new ImportMetadataError("TOOL_FAILED"); }
  for (const [field, value] of Object.entries(before)) {
    const parts = field.split(":"), group = parts[0], tag = parts.length > 1 ? parts.at(-1) : undefined;
    const namedField = `${group}:${tag}`;
    if (tag === undefined || removed.includes(namedField) || (removeLocation && (isLocationField(field) || isPreviewField(field))) || NOT_COMPARED_FIELD.has(namedField) || NOT_COMPARED_TAG.test(tag) || (NOT_COMPARED_GROUP.test(group) && namedField !== "File:Comment")) continue;
    if (JSON.stringify(after[field]) !== JSON.stringify(value)) throw new ImportMetadataError("METADATA_NOT_CARRIED");
  }
}

/** A new copy of `source`'s pixels, with its metadata except `removed`, checked field by field. */
function carryOnto(derivative: Uint8Array, source: Uint8Array, extension: string, tool: ImportMetadataTool, removed: readonly string[], removeLocation = false): Promise<Uint8Array> {
  return editCopy(derivative, async (file, directory) => {
    const original = path.join(directory, `source.${extension}`);
    await writeFile(original, source, { mode: 0o600 });
    await runTool(tool, file, ["-TagsFromFile", original, ...COPY_ARGUMENTS]);
    // A separate pass: an exclusion during the copy left the creator's address in place,
    // because ExifTool copies it inside its contact structure.
    await runTool(tool, file, [...STALE_ARGUMENTS, ...removed.map((tag) => `-${tag}=`), ...(removeLocation ? LOCATION_ARGUMENTS : [])]);
    await assertNothingLost(tool, original, file, removed, removeLocation);
    if (removeLocation) await assertNoLocation(tool, file);
  }, extension);
}

export type PreparedImportJpeg = Readonly<{ bytes: Uint8Array; action: ImportAction }>;

/** Throws `JpegAuditError` when the source is not a strict single JPEG. */
export async function prepareJpegForImport(source: Uint8Array, tool: ImportMetadataTool, options: Readonly<{ removeLocation?: boolean }> = {}): Promise<PreparedImportJpeg> {
  const removeLocation = options.removeLocation === true;
  const action = importActionFor(inspectJpegImportFacts(source));
  if (action === "keep-compressed-data") {
    // Nothing re-encodes this file, so a damaged scan would otherwise reach the upload.
    try { await sharp(source, { failOn: "error" }).stats(); }
    catch { throw new ImportMetadataError("UNDECODABLE_IMAGE"); }
    const bytes = await editCopy(source, async (file) => {
      await runTool(tool, file, [...REMOVAL_ARGUMENTS, ...(removeLocation ? LOCATION_ARGUMENTS : [])]);
      if (removeLocation) await assertNoLocation(tool, file);
    });
    assertResult(bytes, compressedImageDataSha256(source), removeLocation);
    return { bytes, action };
  }
  const derivative = (await generatePublicDerivative(source)).bytes;
  const bytes = await carryOnto(derivative, source, "jpg", tool, REMOVED_TAGS, removeLocation);
  assertResult(bytes, compressedImageDataSha256(derivative), removeLocation);
  return { bytes, action };
}

/** The public import paths. A non-JPEG source has no rule of its own in decision 8. */
export async function prepareImportImage(source: Uint8Array): Promise<PublicDerivative> {
  if (source[0] !== 0xff || source[1] !== 0xd8) return generatePublicDerivative(source);
  const tool = createImportMetadataTool();
  try {
    return { bytes: (await prepareJpegForImport(source, tool)).bytes, contentType: PUBLIC_DELIVERY_FORMATS.jpeg };
  } finally {
    await tool.end();
  }
}

/** What the field comparison cannot see: XMP that ExifTool cannot parse, and PNG text. */
function assertOpaqueMetadataCarried(before: Metadata, after: Metadata): void {
  if (before.xmp !== undefined && after.xmp === undefined) throw new ImportMetadataError("METADATA_NOT_CARRIED");
  const remaining = [...(after.comments ?? [])];
  for (const { keyword, text } of before.comments ?? []) {
    const index = remaining.findIndex((entry) => entry.keyword === keyword && entry.text === text);
    if (index === -1) throw new ImportMetadataError("METADATA_NOT_CARRIED");
    // Consume each match so repeated entries must survive with all their occurrences.
    remaining.splice(index, 1);
  }
}
const pixelDigest = async (bytes: Uint8Array): Promise<Buffer> => sharp(bytes).raw().toBuffer();

/**
 * Client web images: the client gets the photographs with their metadata, so nothing is
 * removed. Only what describes the source's pixels stays behind (`STALE_ARGUMENTS`). A
 * field the format or the tool could not take fails the image rather than losing it quietly.
 */
export async function carryAllMetadata(derivative: Uint8Array, source: Uint8Array, extension: string): Promise<Uint8Array> {
  const before = await sharp(source).metadata();
  const tool = createImportMetadataTool();
  try {
    const bytes = await carryOnto(derivative, source, extension, tool, []);
    assertOpaqueMetadataCarried(before, await sharp(bytes).metadata());
    if (!(await pixelDigest(bytes)).equals(await pixelDigest(derivative))) throw new ImportMetadataError("PIXELS_CHANGED");
    return bytes;
  } finally {
    await tool.end();
  }
}

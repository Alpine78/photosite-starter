/** Synthetic fixtures only: generated pixels and made-up metadata, no real photograph. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { compressedImageDataSha256, inspectJpegImportFacts } from "./image-import-metadata.mts";
import { carryAllMetadata, createImportMetadataTool, ImportMetadataError, prepareImportImage, prepareJpegForImport, type ImportMetadataTool } from "./image-import-metadata-edit.mts";
import { generatePublicDerivative } from "./joomla-image-derivative.mts";

const tool = createImportMetadataTool();
afterAll(() => tool.end());

// ExifTool starts a Perl process and rewrites real files, which takes seconds under the parallel suite.
const TOOL_TIMEOUT_MS = 60_000;

const FIXTURE_ARGUMENTS = [
  "-overwrite_original",
  "-XMP-dc:Subject=term-a", "-XMP-dc:Subject=term-b",
  "-XMP-lr:HierarchicalSubject=root|term-a",
  "-XMP-lr:WeightedFlatSubject=term-a",
  "-IPTC:Keywords=term-a",
  "-IPTC:CodedCharacterSet=UTF8",
  "-XMP-iptcCore:CreatorAddress=Example Street 1",
  "-XMP-iptcCore:CreatorRegion=Example Region",
  "-XMP-iptcCore:CreatorPostalCode=00000",
  "-XMP-iptcCore:CreatorCity=Exampletown",
  "-XMP-iptcCore:CreatorCountry=Exampleland",
  "-XMP-iptcCore:CreatorWorkEmail=creator@example.test",
  "-XMP-iptcCore:CreatorWorkTelephone=+000",
  "-XMP-iptcCore:CreatorWorkURL=https://example.test",
  "-XMP-dc:Creator=Dc Creator",
  "-XMP-dc:Rights=Copyright Example",
  "-XMP-xmpRights:Marked=true",
  "-IPTC:By-line=Exämple Creator",
  "-EXIF:Artist=Exif Artist",
  "-EXIF:Copyright=Copyright Example",
  "-EXIF:Make=ExampleMake",
  "-EXIF:Model=ExampleModel",
  "-EXIF:SerialNumber=SN0001",
  "-EXIF:LensSerialNumber=LS0002",
  "-EXIF:ExposureTime=1/250",
  "-EXIF:GPSLatitude=60.1", "-EXIF:GPSLatitudeRef=N",
  "-EXIF:GPSLongitude=24.9", "-EXIF:GPSLongitudeRef=E",
];

async function fixture(width: number, height: number, extra: readonly string[] = []): Promise<Uint8Array> {
  const pixels = await sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg({ quality: 80 }).toBuffer();
  const directory = await mkdtemp(path.join(tmpdir(), "import-metadata-test-"));
  try {
    const file = path.join(directory, "fixture.jpg");
    await writeFile(file, pixels);
    await tool.write(file, {}, { writeArgs: [...FIXTURE_ARGUMENTS, ...extra] });
    return new Uint8Array(await readFile(file));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function tagsOf(bytes: Uint8Array) {
  const directory = await mkdtemp(path.join(tmpdir(), "import-metadata-read-"));
  try {
    const file = path.join(directory, "read.jpg");
    await writeFile(file, bytes);
    return (await tool.read(file)) as unknown as Record<string, unknown>;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function expectKeptAndRemoved(tags: Record<string, unknown>) {
  for (const removed of ["Subject", "HierarchicalSubject", "WeightedFlatSubject", "Keywords"]) {
    expect(tags[removed], removed).toBeUndefined();
  }
  // The wrapper reads IPTC contact details as one structure, under their IPTC names.
  expect(tags.CreatorContactInfo).toEqual({
    CiAdrCity: "Exampletown", CiAdrCtry: "Exampleland", CiEmailWork: "creator@example.test",
    CiTelWork: "+000", CiUrlWork: "https://example.test",
  });
  expect(tags).toMatchObject({
    Rights: "Copyright Example", Copyright: "Copyright Example",
    Artist: "Exif Artist", Creator: ["Dc Creator"], Make: "ExampleMake", Model: "ExampleModel", SerialNumber: "SN0001", LensSerialNumber: "LS0002",
  });
  expect(tags["By-line"]).toBe("Exämple Creator");
  expect(tags.GPSLatitude).toBeDefined();
  expect(tags.GPSLongitude).toBeDefined();
  expect(tags.ExposureTime).toBeDefined();
}

const EVERY_PLACE = [
  "-XMP-exif:GPSLatitude=60.1", "-XMP-exif:GPSDestLatitude=60.2", "-XMP-exif:GPSDestLongitude=24.8",
  "-XMP-iptcExt:LocationShownCity=A city shown", "-XMP-iptcExt:LocationCreatedCity=A city created",
  "-XMP-photoshop:City=A city", "-XMP-iptcCore:Location=A place", "-IPTC:City=A city", "-IPTC:ContentLocationName=A content place",
] as const;

describe("removing a sensitive photograph's location", () => {
  it("keeps a Lightroom setting whose name only mentions a preview", async () => {
    const source = await fixture(400, 300, ["-XMP-crs:UprightPreview=False"]);
    const { bytes } = await prepareJpegForImport(source, tool, { removeLocation: true });
    const directory = await mkdtemp(path.join(tmpdir(), "setting-"));
    try {
      const file = path.join(directory, "result.jpg");
      await writeFile(file, bytes);
      const fields = await tool.readRaw(file, { readArgs: ["-G1", "-u"] }) as unknown as Record<string, unknown>;
      expect(fields["XMP-crs:UprightPreview"]).toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  const previewTags = ["IFD1:ThumbnailImage", "Photoshop:PhotoshopThumbnail", "Photoshop:PhotoshopBGRThumbnail", "XMP-xmp:ThumbnailImage"];

  async function fixtureWithPreviews(width: number, height: number) {
    const preview = await fixture(32, 24);
    const directory = await mkdtemp(path.join(tmpdir(), "location-preview-"));
    try {
      const file = path.join(directory, "preview.jpg");
      await writeFile(file, preview);
      return { preview, source: await fixture(width, height, ["-GPS:all=", ...previewTags.map((tag) => `-${tag}<=${file}`)]) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it.each([["keeping the image data", 400, 300], ["re-encoding a large one", 2400, 1600]])("removes embedded thumbnails containing their own GPS when %s", async (_name, width, height) => {
    const { source, preview } = await fixtureWithPreviews(width, height);
    expect(inspectJpegImportFacts(source).gps).toBe("absent");
    expect(inspectJpegImportFacts(preview).gps).toBe("present");
    const directory = await mkdtemp(path.join(tmpdir(), "location-preview-read-"));
    try {
      const file = path.join(directory, "image.jpg");
      await writeFile(file, source);
      const before = await tool.readRaw(file, { readArgs: ["-G1", "-b", ...previewTags.map((tag) => `-${tag}`)] }) as unknown as Record<string, unknown>;
      for (const tag of previewTags) expect(before[tag], tag).toBeDefined();
      expect(Buffer.from(String(before[previewTags[0]]).replace(/^base64:/, ""), "base64")).toEqual(Buffer.from(preview));
      const { bytes, action } = await prepareJpegForImport(source, tool, { removeLocation: true });
      expect(action).toBe(width <= 2048 ? "keep-compressed-data" : "re-encode");
      if (action === "keep-compressed-data") expect(compressedImageDataSha256(bytes)).toBe(compressedImageDataSha256(source));
      await writeFile(file, bytes);
      const after = await tool.readRaw(file, { readArgs: ["-G1:2", "-u"] }) as unknown as Record<string, unknown>;
      expect(Object.keys(after).filter((field) => /Preview|Thumbnail/.test(field))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, TOOL_TIMEOUT_MS);

  it("keeps embedded thumbnails byte for byte when location removal is disabled", async () => {
    const { source } = await fixtureWithPreviews(400, 300);
    const directory = await mkdtemp(path.join(tmpdir(), "location-preview-kept-"));
    try {
      const file = path.join(directory, "image.jpg");
      await writeFile(file, source);
      const before = await tool.readRaw(file, { readArgs: ["-G1", "-b", ...previewTags.map((tag) => `-${tag}`)] }) as unknown as Record<string, unknown>;
      const { bytes, action } = await prepareJpegForImport(source, tool, { removeLocation: false });
      expect(action).toBe("keep-compressed-data");
      expect(compressedImageDataSha256(bytes)).toBe(compressedImageDataSha256(source));
      await writeFile(file, bytes);
      const after = await tool.readRaw(file, { readArgs: ["-G1", "-b", ...previewTags.map((tag) => `-${tag}`)] }) as unknown as Record<string, unknown>;
      for (const tag of previewTags) {
        expect(before[tag], tag).toBeDefined();
        expect(after[tag], tag).toEqual(before[tag]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, TOOL_TIMEOUT_MS);

  it.each([["keeping the image data", 400, 300], ["re-encoding a large one", 2400, 1600]])("refuses a remaining embedded preview when %s", async (_name, width, height) => {
    const source = await fixture(width, height);
    for (const field of ["MakerNotes:Preview:PreviewImage", "Composite:Preview:OtherImage"]) {
      const stubborn = {
        write: tool.write.bind(tool),
        readRaw: async (file: string, options: { readArgs: string[] }) => ({
          ...await tool.readRaw(file, options), [field]: "(Binary data)",
        }),
      } as unknown as ImportMetadataTool;
      await expect(prepareJpegForImport(source, stubborn, { removeLocation: true })).rejects.toMatchObject({ code: "METADATA_REMAINS" });
    }
  }, TOOL_TIMEOUT_MS);

  it.each([["keeping the image data", 400, 300], ["re-encoding a large one", 2400, 1600]])("leaves no place behind when %s, and keeps the creator's own city", async (_name, width, height) => {
    const source = await fixture(width, height, [...EVERY_PLACE, "-XMP-iptcCore:CreatorCity=The creator's city"]);
    const { bytes } = await prepareJpegForImport(source, tool, { removeLocation: true });
    const directory = await mkdtemp(path.join(tmpdir(), "location-"));
    try {
      const file = path.join(directory, "result.jpg");
      await writeFile(file, bytes);
      const fields = await tool.readRaw(file, { readArgs: ["-G1", "-u"] }) as unknown as Record<string, unknown>;
      const text = JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith("File:") && !key.startsWith("SourceFile"))));
      expect(text).not.toMatch(/GPS|A city|A place|A content place/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses an image when a tool leaves a place behind, rather than uploading it", async () => {
    const source = await fixture(400, 300, ["-XMP-iptcExt:LocationShownCity=A city shown"]);
    const write = tool.write.bind(tool) as (file: string, tags: object, options: { writeArgs: string[] }) => Promise<unknown>;
    const stubborn = { write: (file: string, tags: object, options: { writeArgs: string[] }) => write(file, tags, { writeArgs: options.writeArgs.filter((argument) => !argument.includes("iptcExt")) }), readRaw: tool.readRaw.bind(tool) } as unknown as ImportMetadataTool;
    await expect(prepareJpegForImport(source, stubborn, { removeLocation: true })).rejects.toMatchObject({ code: "METADATA_REMAINS" });
  }, 60_000);
});

describe("JPEG import metadata", () => {
  it("edits only metadata at the 2048 px bound, keeping the compressed image data", async () => {
    const source = await fixture(2048, 1024);
    const { bytes, action } = await prepareJpegForImport(source, tool);
    expect(action).toBe("keep-compressed-data");
    expect(compressedImageDataSha256(bytes)).toBe(compressedImageDataSha256(source));
    expect(inspectJpegImportFacts(bytes)).toMatchObject({ keywordMetadata: false, creatorPostalAddress: false, gps: "present", width: 2048, height: 1024 });
    expectKeptAndRemoved(await tagsOf(bytes));
  }, TOOL_TIMEOUT_MS);

  it("leaves a source with nothing to remove decodable and unchanged in its image data", async () => {
    const plain = await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    const { bytes } = await prepareJpegForImport(new Uint8Array(plain), tool);
    expect(compressedImageDataSha256(bytes)).toBe(compressedImageDataSha256(plain));
  }, TOOL_TIMEOUT_MS);

  it("downscales a larger source and carries the kept metadata over", async () => {
    const { bytes, action } = await prepareJpegForImport(await fixture(3000, 1500), tool);
    expect(action).toBe("re-encode");
    expect(inspectJpegImportFacts(bytes)).toMatchObject({ width: 2048, height: 1024, keywordMetadata: false, creatorPostalAddress: false, gps: "present" });
    const tags = await tagsOf(bytes);
    expectKeptAndRemoved(tags);
    expect(tags.CodedCharacterSet).toBe("UTF8");
    expect(tags.ThumbnailImage).toBeUndefined();
  }, TOOL_TIMEOUT_MS);

  it("does not rotate a larger source twice, or keep a profile its pixels no longer match", async () => {
    const { bytes } = await prepareJpegForImport(await fixture(3000, 1500, ["-EXIF:Orientation#=6"]), tool);
    const facts = inspectJpegImportFacts(bytes);
    expect(facts).toMatchObject({ width: 1024, height: 2048, orientation: 1, orientedWidth: 1024, orientedHeight: 2048 });
    const metadata = await sharp(bytes).metadata();
    expect(metadata.orientation ?? 1).toBe(1);
    expect(metadata.icc).toBeUndefined();
  }, TOOL_TIMEOUT_MS);

  it("re-encodes a smaller source that needs rotating, because dimensions rely on upright pixels", async () => {
    const { bytes, action } = await prepareJpegForImport(await fixture(200, 100, ["-EXIF:Orientation#=6"]), tool);
    expect(action).toBe("re-encode");
    expect(inspectJpegImportFacts(bytes)).toMatchObject({ width: 100, height: 200, orientation: 1, keywordMetadata: false, gps: "present" });
  }, TOOL_TIMEOUT_MS);

  it("fails rather than returning a file when the tool cannot do its work", async () => {
    const failing = { write: async () => { throw new Error("no perl"); } } as unknown as ImportMetadataTool;
    const source = await fixture(200, 100);
    await expect(prepareJpegForImport(source, failing)).rejects.toBeInstanceOf(ImportMetadataError);
  }, TOOL_TIMEOUT_MS);

  it("refuses a result that still carries keywords", async () => {
    const silent = { write: async () => ({}) } as unknown as ImportMetadataTool;
    await expect(prepareJpegForImport(await fixture(200, 100), silent)).rejects.toMatchObject({ code: "METADATA_REMAINS" });
  }, TOOL_TIMEOUT_MS);

  it("gives a public import the edited JPEG, and a non-JPEG today's metadata-free derivative", async () => {
    const source = await fixture(200, 100);
    const jpeg = await prepareImportImage(source);
    expect(jpeg.contentType).toBe("image/jpeg");
    expect(compressedImageDataSha256(jpeg.bytes)).toBe(compressedImageDataSha256(source));
    expect(inspectJpegImportFacts(jpeg.bytes)).toMatchObject({ keywordMetadata: false, creatorPostalAddress: false, gps: "present" });
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).withExif({ IFD0: { Make: "Synthetic" } }).png().toBuffer();
    const converted = await prepareImportImage(new Uint8Array(png));
    expect(converted.contentType).toBe("image/png");
    expect((await sharp(converted.bytes).metadata()).exif).toBeUndefined();
  }, TOOL_TIMEOUT_MS);

  it("gives the same bytes on every run, so a dry run and a write agree", async () => {
    for (const source of [await fixture(200, 100), await fixture(3000, 1500)]) {
      const first = await prepareImportImage(source), second = await prepareImportImage(source);
      expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    }
  }, TOOL_TIMEOUT_MS);

  it("carries everything onto a client web copy: keywords, the postal address and GPS stay", async () => {
    const source = await fixture(3000, 1500);
    const derivative = (await generatePublicDerivative(source)).bytes;
    const bytes = await carryAllMetadata(derivative, source, "jpg");
    expect(compressedImageDataSha256(bytes)).toBe(compressedImageDataSha256(derivative));
    expect(inspectJpegImportFacts(bytes)).toMatchObject({ keywordMetadata: true, creatorPostalAddress: true, gps: "present", width: 2048, height: 1024 });
    const tags = await tagsOf(bytes);
    expect(tags.Subject).toEqual(["term-a", "term-b"]);
    expect(tags.Keywords).toBe("term-a");
    expect(tags.CreatorContactInfo).toMatchObject({ CiAdrExtadr: "Example Street 1", CiAdrRegion: "Example Region", CiAdrPcode: "00000", CiAdrCity: "Exampletown" });
    expect(tags).toMatchObject({ Artist: "Exif Artist", SerialNumber: "SN0001", Creator: ["Dc Creator"] });
    expect(tags["By-line"]).toBe("Exämple Creator");
  }, TOOL_TIMEOUT_MS);

  it("carries a JPEG comment", async () => {
    const source = await fixture(3000, 1500, ["-Comment=Synthetic comment"]);
    const bytes = await carryAllMetadata((await generatePublicDerivative(source)).bytes, source, "jpg");
    expect((await tagsOf(bytes)).Comment).toBe("Synthetic comment");
  }, TOOL_TIMEOUT_MS);

  it("leaves the pixels of a metadata-free client copy as they are", async () => {
    const plain = await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    const derivative = (await generatePublicDerivative(plain)).bytes;
    expect(compressedImageDataSha256(await carryAllMetadata(derivative, plain, "jpg"))).toBe(compressedImageDataSha256(derivative));
  }, TOOL_TIMEOUT_MS);

  it("carries a comment from a source that holds nothing else", async () => {
    const plain = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    const directory = await mkdtemp(path.join(tmpdir(), "import-metadata-comment-"));
    try {
      const file = path.join(directory, "comment.jpg");
      await writeFile(file, plain);
      await tool.write(file, {}, { writeArgs: ["-overwrite_original", "-Comment=Only a comment"] });
      const source = new Uint8Array(await readFile(file));
      const bytes = await carryAllMetadata((await generatePublicDerivative(source)).bytes, source, "jpg");
      expect((await tagsOf(bytes)).Comment).toBe("Only a comment");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, TOOL_TIMEOUT_MS);

  const MIXED_XMP = "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><rdf:Description rdf:about='' xmlns:dc='http://purl.org/dc/elements/1.1/' xmlns:tiff='http://ns.adobe.com/tiff/1.0/' xmlns:acme='http://example.test/acme/1.0/' tiff:Orientation='6' tiff:ImageWidth='3000' acme:DeliveryNote='Synthetic note'><dc:creator><rdf:Seq><rdf:li>Synthetic Creator</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>";

  it("carries a custom XMP property, and no XMP fact about the source's pixels", async () => {
    const source = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "red" } }).withXmp(MIXED_XMP).jpeg().toBuffer();
    for (const bytes of [
      await carryAllMetadata((await generatePublicDerivative(source)).bytes, source, "jpg"),
      (await prepareJpegForImport(source, tool)).bytes,
    ]) {
      const xmp = (await sharp(bytes).metadata()).xmp?.toString("utf8") ?? "";
      expect(xmp).toContain("Synthetic note");
      expect(xmp).toContain("Synthetic Creator");
      expect(xmp).not.toMatch(/tiff:Orientation|tiff:ImageWidth/);
    }
  }, TOOL_TIMEOUT_MS);

  it("copies IPTC times and EXIF rationals as they are, adding no time zone", async () => {
    const source = await fixture(3000, 1500, ["-IPTC:TimeCreated=12:34:56", "-IPTC:DigitalCreationTime=12:34:56", "-ExifIFD:FocalPlaneXResolution=3706.0141", "-Photoshop:CopyrightFlag=true"]);
    const read = async (bytes: Uint8Array) => {
      const directory = await mkdtemp(path.join(tmpdir(), "import-metadata-raw-"));
      try {
        const file = path.join(directory, "read.jpg");
        await writeFile(file, bytes);
        return await tool.readRaw(file, { readArgs: ["-G1", "-u"] }) as unknown as Record<string, unknown>;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    const before = await read(source), after = await read(await carryAllMetadata((await generatePublicDerivative(source)).bytes, source, "jpg"));
    for (const field of ["IPTC:TimeCreated", "IPTC:DigitalCreationTime", "ExifIFD:FocalPlaneXResolution", "Photoshop:CopyrightFlag", "IPTC:CodedCharacterSet"]) {
      expect(after[field], field).toEqual(before[field]);
    }
    expect(after["IFD1:ThumbnailImage"]).toBeUndefined();
  }, TOOL_TIMEOUT_MS);

  it("does not carry an image embedded in the XMP block", async () => {
    const preview = (await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "blue" } }).jpeg().toBuffer()).toString("base64");
    const xmp = `<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><rdf:Description rdf:about='' xmlns:xmp='http://ns.adobe.com/xap/1.0/' xmlns:xmpGImg='http://ns.adobe.com/xap/1.0/g/img/' xmlns:dc='http://purl.org/dc/elements/1.1/'><dc:creator><rdf:Seq><rdf:li>Synthetic Creator</rdf:li></rdf:Seq></dc:creator><xmp:Thumbnails><rdf:Alt><rdf:li rdf:parseType='Resource'><xmpGImg:format>JPEG</xmpGImg:format><xmpGImg:width>2400</xmpGImg:width><xmpGImg:height>1200</xmpGImg:height><xmpGImg:image>${preview}</xmpGImg:image></rdf:li></rdf:Alt></xmp:Thumbnails></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const source = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "red" } }).withXmp(xmp).jpeg().toBuffer();
    expect((await sharp(source).metadata()).xmp?.toString("utf8")).toContain("xmpGImg:image");
    const carried = (await sharp(await carryAllMetadata((await generatePublicDerivative(source)).bytes, source, "jpg")).metadata()).xmp?.toString("utf8") ?? "";
    expect(carried).toContain("Synthetic Creator");
    expect(carried).not.toContain("xmpGImg:image");
  }, TOOL_TIMEOUT_MS);

  it("refuses a copy that lost a field, whichever path made it", async () => {
    const lossy = { write: async () => ({}), readRaw: tool.readRaw.bind(tool) } as unknown as ImportMetadataTool;
    await expect(prepareJpegForImport(await fixture(3000, 1500), lossy)).rejects.toMatchObject({ code: "METADATA_NOT_CARRIED" });
  }, TOOL_TIMEOUT_MS);

  it("decodes a JPEG it will not re-encode, so a damaged scan never reaches an upload", async () => {
    const source = Buffer.from(await fixture(200, 100));
    const scan = source.indexOf(Buffer.from([0xff, 0xda]));
    for (let component = 0; component < source[scan + 4]; component++) source[scan + 6 + component * 2] = 0x33; // No such Huffman table.
    await expect(prepareJpegForImport(source, tool)).rejects.toMatchObject({ code: "UNDECODABLE_IMAGE" });
  }, TOOL_TIMEOUT_MS);

  it("still downscales a source larger than a delivered file may be", async () => {
    const small = Buffer.from(await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "red" } }).jpeg().toBuffer());
    const padding = Buffer.alloc(65_535, 0x20); padding[0] = 0xff; padding[1] = 0xe9; padding.writeUInt16BE(65_533, 2); // One APP9 segment.
    const large = Buffer.concat([small.subarray(0, 2), ...Array.from({ length: 400 }, () => padding), small.subarray(2)]);
    expect(large.length).toBeGreaterThan(25_000_000);
    const { bytes, action } = await prepareJpegForImport(large, tool);
    expect(action).toBe("re-encode");
    expect(inspectJpegImportFacts(bytes)).toMatchObject({ width: 2048, height: 1024 });
  }, TOOL_TIMEOUT_MS);

  it("refuses a source that is not a JPEG", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    await expect(prepareJpegForImport(new Uint8Array(png), tool)).rejects.toThrow();
  }, TOOL_TIMEOUT_MS);
});

/** Synthetic fixtures only, in a temporary directory. Nothing leaves this machine. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { buildReuploadPlan, classifySource } from "./legacy-image-reupload-plan.mts";
import { parseArguments, run } from "./plan-legacy-image-reupload.mts";

const pixels = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } } });
const located = () => pixels(16, 8).withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 1/1 0/1" } }).jpeg().toBuffer();

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function temp() {
  const dir = await mkdtemp(path.join(tmpdir(), "ab391-"));
  temporary.push(dir);
  return dir;
}

describe("classifySource", () => {
  it("separates kept, re-encoded, non-JPEG and unreadable sources", async () => {
    expect(classifySource("a.jpg", await pixels(16, 8).jpeg().toBuffer()).action).toBe("keep-compressed-data");
    expect(classifySource("b.jpg", await pixels(2049, 8).jpeg().toBuffer()).action).toBe("re-encode");
    expect(classifySource("c.png", await pixels(16, 8).png().toBuffer()).action).toBe("non-jpeg-no-rule");
    expect(classifySource("d.jpg", Buffer.from([0xff, 0xd8, 0xff]))).toEqual({ path: "d.jpg", action: "unreadable", code: "INVALID_JPEG" });
  });
});

describe("buildReuploadPlan", () => {
  it("lists located and unknown-location sources for review, in a stable order", async () => {
    const rows = [
      classifySource("z.jpg", await located()),
      classifySource("m.jpg", await pixels(16, 8).jpeg().toBuffer()),
      classifySource("a.jpg", Buffer.from([0xff, 0xd8, 0xff])),
      classifySource("c.png", await pixels(16, 8).png().toBuffer()),
    ];
    const plan = buildReuploadPlan(rows);
    expect(plan.gpsReview).toEqual([{ path: "a.jpg", gps: "unreadable" }, { path: "z.jpg", gps: "present" }]);
    expect(plan.rows.map(row => row.path)).toEqual(["a.jpg", "c.png", "m.jpg", "z.jpg"]);
    expect(plan.summary).toMatchObject({ total: 4, keepCompressedData: 2, nonJpegNoRule: 1, unreadable: 1 });
    expect(buildReuploadPlan([...rows].reverse())).toEqual(plan);
  });
});

describe("the report command", () => {
  it("walks nested folders, ignores other files and refuses to overwrite a report", async () => {
    const root = await temp(), output = await temp();
    await mkdir(path.join(root, "album"));
    await writeFile(path.join(root, "album", "located.JPG"), await located());
    await writeFile(path.join(root, "notes.txt"), "not an image");
    const out = path.join(output, "report"), argv = ["--image-root", root, "--out", out];
    await run(argv);
    const report = JSON.parse(await readFile(path.join(out, "legacy-image-reupload-plan.json"), "utf8"));
    expect(report.summary.total).toBe(1);
    expect(report.gpsReview).toEqual([{ path: "album/located.JPG", gps: "present" }]);
    await expect(run(argv)).rejects.toThrow(/EEXIST/);
  });

  it("refuses bad arguments and an output inside the image root", () => {
    expect(() => parseArguments(["--image-root", "/x"])).toThrow("ARGUMENTS_INVALID");
    expect(() => parseArguments(["--image-root", "/x", "--out", "/x/report"])).toThrow("OUTPUT_INSIDE_IMAGE_ROOT");
    expect(parseArguments(["--image-root", "/x", "--out", "/y"])).toEqual({ imageRoot: "/x", out: "/y" });
  });
});

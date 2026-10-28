/** Generated test-card pixels only: no input image, filesystem, network or metadata. */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildWholeDeliveryZip, type ZipSource } from "./delivery-zip-build.mts";

const WIDTH = 512, HEIGHT = 384, MAX_BYTES = 1024 * 1024;
const CORNERS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]] as const;

/** Complete 4:3 synthetic frames with a case-specific geometric tile pattern. */
export async function generateRehearsalFixtures(nonce: string, caseName: string): Promise<{ image: Buffer; jpeg: Buffer; zip: Buffer }> {
  if (!/^[a-f0-9]{32}$/u.test(nonce) || !/^[a-z][a-z-]{0,39}$/u.test(caseName)) {
    throw new Error("Invalid rehearsal fixture identity");
  }
  const seed = createHash("sha256").update(`client-gallery-rehearsal-v1\n${nonce}\n${caseName}\n`).digest();
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const at = (y * WIDTH + x) * 3;
    const column = Math.floor(x / 16), row = Math.floor(y / 16);
    const value = seed[(column + row * 32) % seed.length];
    const light = (column + row) % 2 === 0;
    pixels[at] = light ? value : 255 - value;
    pixels[at + 1] = light ? 224 : 32;
    pixels[at + 2] = light ? 32 : 224;
    // Large, distinct markers at all four corners make accidental cropping visible.
    if ((x < 32 || x >= WIDTH - 32) && (y < 32 || y >= HEIGHT - 32)) {
      const corner = (y >= HEIGHT - 32 ? 2 : 0) + (x >= WIDTH - 32 ? 1 : 0);
      pixels.set(CORNERS[corner], at);
    }
  }
  const raw = { width: WIDTH, height: HEIGHT, channels: 3 as const };
  // Raw input carries no source metadata; no metadata-preserving operation is used.
  const jpeg = await sharp(pixels, { raw }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  const image = await sharp(pixels, { raw }).resize({ width: 256, height: 192, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
    .webp({ lossless: true }).toBuffer();
  const source: ZipSource = { size: jpeg.length,
    async read(position, length) { return jpeg.subarray(position, position + length); },
    async unchanged() { /* Immutable local buffer, never exposed before packaging. */ },
  };
  const chunks: Buffer[] = [];
  await buildWholeDeliveryZip([source], { async write(bytes) { chunks.push(Buffer.from(bytes)); } });
  const zip = Buffer.concat(chunks);
  if ([image, jpeg, zip].some(bytes => bytes.length >= MAX_BYTES)) throw new Error("Rehearsal fixture exceeds byte budget");
  return { image, jpeg, zip };
}

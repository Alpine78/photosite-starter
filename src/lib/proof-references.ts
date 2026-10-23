/**
 * Permanent proof references for the server-side publication route (ADR-0038
 * decision 2, AB#130). Restated from `sanity/schemas/proof-references.ts`,
 * which the Studio validator uses: application code never imports the schema
 * package. `sanity/schemas/proof-references.parity.test.ts` runs both through
 * the same cases so they cannot drift apart.
 */

export type ProofReferenceItem = Readonly<{
  _key: string;
  originalFilename: string;
  reference?: string;
  /** The proof image's asset reference, compared to keep a number on one photograph. */
  assetRef: string;
}>;

/** What publication has already fixed. A never-published gallery has none. */
export type PublishedProofState = Readonly<{
  highWater: number;
  references: Readonly<Record<string, Readonly<{ reference: string; assetRef: string }>>>;
}>;

export const NEVER_PUBLISHED: PublishedProofState = { highWater: 0, references: {} };

/** Bound keeps every reference a safe integer and short enough to read aloud. */
export const MAX_PROOF_REFERENCE = 999_999;

const REFERENCE = /^(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})$/u;

export function formatProofReference(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PROOF_REFERENCE) {
    throw new RangeError("proof reference out of range");
  }
  return String(value).padStart(3, "0");
}

export function isProofReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}

function tokens(value: string): string[] {
  return value.normalize("NFC").match(/\d+|\D+/gu) ?? [];
}

function compareDigits(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/u, ""), b = right.replace(/^0+(?=\d)/u, "");
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Lightroom-style natural order: digit runs compare by numeric value
 * (`IMG_9` before `IMG_10`), other runs by code unit after NFC, and a digit run
 * sorts before text at the same position. Names equal by value are then ordered
 * by fewer leading zeros first, and finally by their NFC code units, so the
 * order is total and does not depend on input order.
 */
export function compareProofFilenames(left: string, right: string): number {
  const a = tokens(left), b = tokens(right);
  let zeros = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const x = a[index], y = b[index];
    const xDigits = /^\d/u.test(x), yDigits = /^\d/u.test(y);
    if (xDigits !== yDigits) return xDigits ? -1 : 1;
    const order = xDigits ? compareDigits(x, y) : compareText(x, y);
    if (order !== 0) return order;
    if (xDigits && zeros === 0) zeros = x.length - y.length;
  }
  if (a.length !== b.length) return a.length - b.length;
  if (zeros !== 0) return zeros;
  return compareText(left.normalize("NFC"), right.normalize("NFC"));
}

export type AssignedProofReferences = Readonly<{
  references: Readonly<Record<string, string>>;
  highWater: number;
}>;

/**
 * The references every item must carry after publishing against `published`.
 * Items already published keep their published number; every other item gets
 * the next number above the high-water mark, in natural filename order with the
 * item key as the final tie-break.
 */
export function assignProofReferences(
  items: readonly ProofReferenceItem[],
  published: PublishedProofState,
): AssignedProofReferences {
  if (!Number.isSafeInteger(published.highWater) || published.highWater < 0 ||
    published.highWater > MAX_PROOF_REFERENCE) throw new RangeError("invalid published high-water mark");
  const references: Record<string, string> = {};
  const fresh: ProofReferenceItem[] = [];
  for (const item of items) {
    const fixed = Object.hasOwn(published.references, item._key) ? published.references[item._key] : undefined;
    if (fixed) references[item._key] = fixed.reference;
    else fresh.push(item);
  }
  fresh.sort((a, b) => compareProofFilenames(a.originalFilename, b.originalFilename) ||
    compareText(a._key, b._key));
  let highWater = published.highWater;
  for (const item of fresh) {
    highWater += 1;
    references[item._key] = formatProofReference(highWater);
  }
  return { references, highWater };
}

export type ProofReferenceProblem = "missing" | "changed" | "replaced" | "high-water";

/**
 * The first problem with a draft about to be published, or `undefined`. A
 * published item must keep both its number and its photograph: a different
 * image is a new proof and needs a new item.
 */
export function proofReferenceProblem(
  items: readonly ProofReferenceItem[],
  highWater: unknown,
  published: PublishedProofState,
): ProofReferenceProblem | undefined {
  for (const item of items) {
    const fixed = Object.hasOwn(published.references, item._key) ? published.references[item._key] : undefined;
    if (fixed && fixed.assetRef !== item.assetRef) return "replaced";
  }
  const expected = assignProofReferences(items, published);
  for (const item of items) {
    if (!isProofReference(item.reference)) return "missing";
    if (item.reference !== expected.references[item._key]) return "changed";
  }
  if (highWater !== expected.highWater) return "high-water";
  return undefined;
}

/**
 * A draft before publication: the publication route assigns the numbers, so a
 * draft need not carry them. A number it does carry must be canonical, and a
 * published proof must keep its image.
 */
export function draftReferenceProblem(
  items: readonly ProofReferenceItem[],
  published: PublishedProofState,
): "replaced" | "malformed" | undefined {
  for (const item of items) {
    const fixed = Object.hasOwn(published.references, item._key) ? published.references[item._key] : undefined;
    if (fixed && fixed.assetRef !== item.assetRef) return "replaced";
    if (item.reference !== undefined && !isProofReference(item.reference)) return "malformed";
  }
  return undefined;
}

/**
 * ADR-0014 §8e resource ceilings for private client galleries, as data.
 *
 * These are the ADR's **default** ceilings — a deployment may lower any of them
 * in its private configuration, but never raise one to "unbounded" (ADR-0014
 * §8e). Nothing consumes them yet: the private-gallery routes, the owner-run
 * upload CLI, the signed-URL minting path, and the retention worker are later
 * slices of AB#29. They live here, pinned by their own test to the exact
 * numbers in the ADR, so those later slices inherit one agreed boundary instead
 * of each re-deriving it.
 *
 * This module is **static policy, not a credential or a store adapter**, so it
 * carries no `server-only` marker and no ESLint import boundary: request-body
 * validation in a future Route Handler will legitimately need these values, and
 * forcing that code to reach them through a server-only façade would only make
 * it copy the numbers instead.
 *
 * ## Byte units
 *
 * Every `_BYTES` value is an exact integer count of bytes, interpreted in
 * **binary** units: 1 KiB = 1024 bytes, 1 MiB = 1024 KiB, 1 GiB = 1024 MiB.
 * The ADR table writes "8 MB" / "25 GB" / "20 GB" / "64 KB"; this module fixes
 * the ambiguity one way and the test pins the resulting integers so a later
 * reader cannot silently reinterpret them.
 */

import { MAX_PUBLIC_DELIVERY_DIMENSION } from "@/lib/image-delivery";

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * Files per gallery. Comfortably above a large wedding plus engagement set, and
 * what keeps a single gallery's total bytes and its ZIP bounded.
 */
export const PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY = 1_000;

/**
 * Items per rendered page, per manifest read, and per signed-URL batch — a
 * smaller bound than the per-gallery total. The public gallery's own
 * `MAX_…_PAGE_SIZE` pattern, applied to the private read.
 */
export const PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE = 100;

/**
 * Longest edge of either private preview kind — a delivery preview or a
 * watermarked proof. Tied to the public web-delivery export policy
 * (`MAX_PUBLIC_DELIVERY_DIMENSION`, `src/lib/image-delivery.ts`), not the
 * `8192 px` contract maximum: an explicit pixel bound is what stops a
 * highly-compressed near-full-resolution proof from turning the protected
 * gallery into an individual high-resolution delivery path.
 */
export const PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX =
  MAX_PUBLIC_DELIVERY_DIMENSION;

/** Bytes of a single private derivative (delivery preview or watermarked proof). */
export const PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES = 8 * MIB;

/** Total bytes of one gallery: every derivative plus the ZIP. */
export const PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES = 25 * GIB;

/** Bytes of the one protected full-gallery ZIP. */
export const PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES = 20 * GIB;

/**
 * Concurrent object writes / multipart parts during the owner-run CLI upload,
 * per gallery. ZIP *generation* is local on the photographer's machine
 * (ADR-0014 §8c), so it has no deployment-side concurrency limit.
 */
export const PRIVATE_GALLERY_DEFAULT_MAX_CLI_UPLOAD_CONCURRENCY = 8;

/** Bytes of a proof-selection request body — a list of references, not content. */
export const PRIVATE_GALLERY_DEFAULT_MAX_PROOF_SELECTION_BODY_BYTES = 64 * KIB;

/** Signed-URL mints per session per minute. Covers a fast scroll, not a scrape. */
export const PRIVATE_GALLERY_DEFAULT_SIGNED_URL_MINTS_PER_MINUTE_PER_SESSION = 60;

/**
 * Aggregate authorized-access budget per gallery: this many times the gallery's
 * total nominal bytes, per {@link PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_DAYS},
 * charged at the authorized object's full size on every signed-URL mint across
 * all sessions of the gallery's current capability generation. A generation
 * bump resets it; clearing the cookie and re-exchanging does not.
 */
export const PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER = 10;

/** Rolling window the access budget is measured over. */
export const PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_DAYS = 30;

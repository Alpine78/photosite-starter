import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GalleryCursorConfigurationError,
  loadGalleryCursorCodec,
} from "@/lib/gallery-cursor";
import type { GalleryCursorScope } from "@/lib/gallery-pagination";

const SETTING = "GALLERY_CURSOR_SIGNING_KEY";
const VALID_KEY = "a-valid-test-gallery-cursor-signing-key";
const OTHER_KEY = "a-different-test-gallery-cursor-signing-key";

const scope: GalleryCursorScope = {
  sourceId: "content-large-archive",
  normalizedFilter: "all",
  ordering: "manual-v1",
  visibilityVersion: "mock-v1",
  pageSize: 24,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("loadGalleryCursorCodec", () => {
  it("names the setting when no key is configured", () => {
    expect(() => loadGalleryCursorCodec({})).toThrow(
      GalleryCursorConfigurationError,
    );
    expect(() => loadGalleryCursorCodec({})).toThrow(SETTING);
  });

  it("treats an empty key as unconfigured rather than as a key", () => {
    expect(() => loadGalleryCursorCodec({ [SETTING]: "" })).toThrow(SETTING);
  });

  it("refuses a key too short to sign with, naming the expected shape", () => {
    expect(() => loadGalleryCursorCodec({ [SETTING]: "too-short" })).toThrow(
      /32 to 256 printable ASCII/,
    );
  });

  it("refuses a key mirrored under a NEXT_PUBLIC_ name", () => {
    // Next.js compiles a NEXT_PUBLIC_ value into the browser bundle. A signing
    // key published to every visitor lets anyone mint cursors this deployment
    // would then accept, so it is refused outright rather than ignored.
    expect(() =>
      loadGalleryCursorCodec({
        [SETTING]: VALID_KEY,
        [`NEXT_PUBLIC_${SETTING}`]: VALID_KEY,
      }),
    ).toThrow(/NEXT_PUBLIC_/);
  });

  it("issues a cursor its own key can spend again", () => {
    const codec = loadGalleryCursorCodec({ [SETTING]: VALID_KEY });
    const boundary = {
      pinnedTier: 0 as const,
      key: 24,
      placementId: "large-archive-0024",
    };
    const cursor = codec.encode(scope, boundary);

    expect(codec.decode(cursor, scope)).toEqual(boundary);
  });

  it("retires every issued cursor when the key is rotated", () => {
    // The documented cost of rotation: continuation URLs are indexable, so
    // changing the key deliberately invalidates the ones already published. The
    // same property is what stops a forged token from being spendable.
    const cursor = loadGalleryCursorCodec({ [SETTING]: VALID_KEY }).encode(scope, {
      pinnedTier: 0,
      key: 24,
      placementId: "large-archive-0024",
    });
    const rotated = loadGalleryCursorCodec({ [SETTING]: OTHER_KEY });

    expect(() => rotated.decode(cursor, scope)).toThrow(/tampered/);
  });
});

describe("galleryCursorCodec", () => {
  it("reads no key until a cursor is actually encoded or decoded", async () => {
    // The laziness that lets a deployment whose galleries all fit inside one
    // page run without the secret at all: importing the adapter, and handing
    // the codec to the page builder, must not touch the environment.
    vi.stubEnv(SETTING, "");
    const { galleryCursorCodec } = await import("@/lib/gallery-cursor");

    expect(typeof galleryCursorCodec.encode).toBe("function");
    expect(typeof galleryCursorCodec.decode).toBe("function");
  });

  it("names the setting at the first gallery that needs a cursor", async () => {
    vi.stubEnv(SETTING, "");
    const { galleryCursorCodec } = await import("@/lib/gallery-cursor");

    expect(() =>
      galleryCursorCodec.encode(scope, {
        pinnedTier: 0,
        key: 24,
        placementId: "large-archive-0024",
      }),
    ).toThrow(SETTING);
  });

  it("signs with the deployment's configured key", async () => {
    vi.stubEnv(SETTING, VALID_KEY);
    const { galleryCursorCodec } = await import("@/lib/gallery-cursor");

    const cursor = galleryCursorCodec.encode(scope, {
      pinnedTier: 0,
      key: 24,
      placementId: "large-archive-0024",
    });

    expect(
      loadGalleryCursorCodec({ [SETTING]: VALID_KEY }).decode(cursor, scope).key,
    ).toBe(24);
  });
});

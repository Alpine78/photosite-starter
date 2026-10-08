import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGallerySlice } from "@/lib/gallery-slice-client";
import type { GallerySlice } from "@/lib/gallery-slice";
import { mockImages } from "@/lib/mock-media";

function validSlice(): GallerySlice {
  const media = mockImages.coastalLandscape;

  return {
    items: [
      {
        itemId: "placement-a",
        mediaId: media.mediaId,
        placementId: "placement-a",
        media,
      },
    ],
    slides: [
      {
        itemId: "placement-a",
        mediaId: media.mediaId,
        src: media.rendition.src,
        width: media.rendition.width,
        height: media.rendition.height,
        alt: media.alt,
        ...(media.caption === undefined ? {} : { caption: media.caption }),
        ...(media.credit === undefined ? {} : { credit: media.credit }),
      },
    ],
    nextCursor: null,
  };
}

function stubResponse(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGallerySlice", () => {
  it("accepts one complete ordered slice", async () => {
    const slice = validSlice();
    stubResponse(slice);

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).resolves.toEqual(slice);
  });

  it("refuses equal-length arrays whose entries are malformed", async () => {
    stubResponse({ items: [null], slides: [null], nextCursor: null });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });

  it("refuses grid and lightbox projections with different identities", async () => {
    const slice = validSlice();
    stubResponse({
      ...slice,
      slides: [{ ...slice.slides[0], itemId: "another-placement" }],
    });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });

  it("refuses lightbox metadata that disagrees with the grid item", async () => {
    const slice = validSlice();
    stubResponse({
      ...slice,
      slides: [{ ...slice.slides[0], alt: "A different photograph" }],
    });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });

  it("refuses an empty continuation token", async () => {
    stubResponse({ ...validSlice(), nextCursor: "" });

    await expect(
      fetchGallerySlice("/stories/portfolio/archive", "cursor-1"),
    ).rejects.toThrow("unusable slice");
  });
});

describe("gallery continuation response byte integrity", () => {
  function withAlt(text: string): GallerySlice {
    const slice = validSlice();
    return { ...slice, items: [{ ...slice.items[0], media: { ...slice.items[0].media, alt: text } }], slides: [{ ...slice.slides[0], alt: text }] };
  }
  it.each([[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]].map(bytes => ({ bytes })))("refuses corrupt but matching item/slide metadata %#", async ({ bytes }) => {
    const json = JSON.stringify(withAlt("BYTE_MARKER"));
    const parts = json.split("BYTE_MARKER");
    const buffers = parts.flatMap((part, index) => index === 0 ? [Buffer.from(part)] : [Buffer.from(bytes), Buffer.from(part)]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.concat(buffers))));
    await expect(fetchGallerySlice("/stories/portfolio/archive", "cursor-1")).rejects.toThrow("unusable slice");
  });
  it("preserves valid Unicode, literal U+FFFD and a response BOM", async () => {
    const slice = withAlt("Ää 📷 �");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`\uFEFF${JSON.stringify(slice)}`)));
    await expect(fetchGallerySlice("/stories/portfolio/archive", "cursor-1")).resolves.toEqual(slice);
  });
  it("refuses a redirect without reading the redirected response body", async () => {
    const response = new Response("private-fixture", { status: 307, headers: { location: "https://redirect.example/" } });
    const read = vi.spyOn(response, "arrayBuffer");
    const send = vi.fn<typeof fetch>(async () => response); vi.stubGlobal("fetch", send);
    await expect(fetchGallerySlice("/stories/portfolio/archive", "cursor-1")).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toMatchObject({ redirect: "manual", cache: "no-store" });
    expect(read).not.toHaveBeenCalled();
  });
  it("redacts malformed JSON and body-read exception details", async () => {
    for (const response of [new Response('{"private-fixture":'), new Response(new ReadableStream({ start(controller) { controller.error(new Error("private-fixture")); } }))]) {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      await expect(fetchGallerySlice("/stories/portfolio/archive", "cursor-1")).rejects.toThrow("Gallery continuation returned an unusable slice.");
    }
  });
});

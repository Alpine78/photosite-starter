import {
  createLocalizedDraftPlan, type LocalizedDraftInput, type LocalizedDraftPlan,
} from "../sanity/localized-draft-plan";

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");

/** Native UTF-8 SHA/HMAC, precomputed before the synchronous policy runs. No Node polyfill. */
export async function planBrowserLocalizedDraft(
  input: LocalizedDraftInput,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<LocalizedDraftPlan> {
  if (!subtle) throw new Error("crypto-unavailable");
  const { source, targetLanguage, placements } = input;
  const type = String(source._type);
  const ids = [JSON.stringify([type, source.contentId, targetLanguage, ""]), ...placements.map((placement) =>
    JSON.stringify([type === "gallery" ? "galleryPlacement" : "articleEndGalleryPlacement", source.contentId, targetLanguage, placement.placementId]),
  )];
  const hashes = new Map<string, string>();
  for (const value of ids) hashes.set(value, hex(await subtle.digest("SHA-256", encoder.encode(value))));
  const macs = new Map<string, string>();
  const seed = source.orderingSeed;
  if (source._type === "gallery" && source.orderingRule === "seeded-random" && typeof seed === "string" && seed) {
    const key = await subtle.importKey("raw", encoder.encode(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    for (const placement of placements) {
      const value = String(placement.placementId);
      macs.set(value, hex(await subtle.sign("HMAC", key, encoder.encode(value))));
    }
  }
  const requireHash = (values: Map<string, string>, key: string) => {
    const result = values.get(key);
    if (!result) throw new Error("missing-precomputed-hash");
    return result;
  };
  return createLocalizedDraftPlan(input, {
    sha256: (value) => requireHash(hashes, value),
    hmac: (key, value) => {
      if (key !== seed) throw new Error("unexpected-hmac-key");
      return requireHash(macs, value);
    },
  });
}

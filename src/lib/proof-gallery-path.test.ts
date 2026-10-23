import { describe, expect, it } from "vitest";
import { isProofGalleryNamespace, proofGalleryHandleFromPath } from "@/lib/proof-gallery-path";

const handle = "a".repeat(32);
describe("proof gallery namespace", () => {
  it("serves only the literal handle grammar", () => {
    expect(proofGalleryHandleFromPath(`/client-proof/${handle}`)).toBe(handle);
    expect(proofGalleryHandleFromPath(`/client-proof/${handle}/`)).toBe(handle);
    expect(proofGalleryHandleFromPath(`/client-proof/${handle}/reminders`)).toBe(handle);
    expect(proofGalleryHandleFromPath(`/client-proof/${handle}/reminders/x`)).toBeUndefined();
    for (const path of [`/client-proof/${"A".repeat(32)}`, "/client-proof/short", `/client-proof/${handle}/x`, "/client-proof", `/en/client-proof/${handle}`]) {
      expect(proofGalleryHandleFromPath(path)).toBeUndefined();
    }
  });

  it("recognizes encoded, cased and locale-prefixed aliases for refusal, not unrelated paths", () => {
    for (const path of ["/client-proof", "/client-proof/x", "/Client-Proof/x", "/client%2Dproof/x", "/en/client-proof/x"]) {
      expect(isProofGalleryNamespace(path, ["en"])).toBe(true);
    }
    for (const path of ["/client-proofs", "/client-gallery/x", "/fi/client-proof/x", "/"]) expect(isProofGalleryNamespace(path, ["en"])).toBe(false);
  });
});

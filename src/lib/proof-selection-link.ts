/**
 * The selection key in a proof link's fragment (ADR-0038 decision 4):
 * `/client-proof/<handle>#select=<key>`. Client-safe and pure. Only the
 * canonical base64url encoding of 32 bytes is a key — 43 characters whose last
 * one carries no stray bits — matching the server's own check.
 */
export const PROOF_SELECTION_KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

export function selectionKeyFromHash(hash: string): string | undefined {
  if (!hash.startsWith("#") || hash.length > 256) return undefined;
  const values = new URLSearchParams(hash.slice(1)).getAll("select");
  return values.length === 1 && PROOF_SELECTION_KEY.test(values[0]) ? values[0] : undefined;
}

/** The fragment that carries a validated key to another locale of the same proof page. */
export function selectionFragment(hash: string): string {
  const key = selectionKeyFromHash(hash);
  return key ? `#select=${key}` : "";
}

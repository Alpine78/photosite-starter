/** The proof gallery namespace (ADR-0038), recognized like `/client-gallery`. */
export const PROOF_GALLERY_ROOT = "client-proof";

/** Recognize aliases for refusal/hygiene; only the literal grammar is served. */
export function isProofGalleryNamespace(pathname: string, localePrefixes: readonly string[] = []): boolean {
  const segments = pathname.slice(1).split("/", 3);
  const decode = (value: string | undefined) => {
    if (value === undefined || value.length > 128) return "";
    try { return decodeURIComponent(value).toLowerCase(); } catch { return ""; }
  };
  const first = decode(segments[0]);
  const owns = (value: string) => value === PROOF_GALLERY_ROOT || value.startsWith(`${PROOF_GALLERY_ROOT}/`);
  return owns(first) || (localePrefixes.includes(first) && owns(decode(segments[1])));
}

/** The proof page and its reminder stop page (ADR-0038 amendment 2026-10-23). */
export function proofGalleryHandleFromPath(pathname: string): string | undefined {
  return /^\/client-proof\/([a-f0-9]{32})(?:\/reminders)?\/?$/.exec(pathname)?.[1];
}

export function isProofGalleryHandle(value: string): boolean {
  return /^[a-f0-9]{32}$/u.test(value);
}

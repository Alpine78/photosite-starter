/** Non-secret opaque list anchor; authorization is mandatory before decoding. */
import "server-only";
type Kind = "proof" | "delivery";
export class PrivateDraftCursorError extends Error {
  constructor() { super("[private-gallery-draft-cursor] invalid-input"); this.name = "PrivateDraftCursorError"; }
}
export function buildPrivateDraftCursor(kind: Kind, handle: string): string {
  if ((kind !== "proof" && kind !== "delivery") || !/^[A-Za-z0-9_-]{22}$/.test(handle)) throw new PrivateDraftCursorError();
  return Buffer.from(JSON.stringify(["private-draft-v1", kind, handle])).toString("base64url");
}
/** URL is supplied by the route, never a source of deployment or origin authority. */
export function readPrivateDraftCursor(url: string | undefined, kind: Kind): string | undefined {
  if (url === undefined) return undefined;
  try {
    const query = new URL(url).searchParams;
    const entries = [...query];
    if (entries.length === 0) return undefined;
    if (entries.length !== 1 || entries[0][0] !== "cursor") throw new PrivateDraftCursorError();
    const token = entries[0][1];
    if (token.length === 0 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new PrivateDraftCursorError();
    const data: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!Array.isArray(data) || data.length !== 3 || data[0] !== "private-draft-v1" || data[1] !== kind ||
        typeof data[2] !== "string" || buildPrivateDraftCursor(kind, data[2]) !== token) throw new PrivateDraftCursorError();
    return data[2];
  } catch { throw new PrivateDraftCursorError(); }
}

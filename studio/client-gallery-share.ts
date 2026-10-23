/** Pure URL handoff; no CMS client, mutations, credentials or browser globals. */
import { transactionSyncLocked } from "./editor-lock";
/** `defaultLocale`: the configured locale with the unprefixed routes. */
export type ClientGallerySite = Readonly<{ origin: string; locales: readonly string[]; defaultLocale?: string }>;
export function clientGallerySiteOrigin(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    if (value.length > 2048 || /[\s\u0000-\u0020\u007f\\]/u.test(value)) throw new Error();
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || (value !== parsed.origin && value !== parsed.origin + "/")) throw new Error();
    return parsed.origin;
  } catch { throw new Error("Invalid SANITY_STUDIO_SITE_ORIGIN"); }
}
function validHandle(value: unknown): value is string {
  return typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/u.test(value);
}
export function publishedClientGalleryHandle(state: {
  id: string; type: string; ready: boolean; published: unknown;
  version?: unknown; release?: unknown; transactionSyncLock?: unknown;
}): string | undefined {
  if (state.type !== "clientDeliveryGallery" || state.ready !== true || state.version != null ||
    state.release !== undefined || transactionSyncLocked(state.transactionSyncLock)) return undefined;
  const source = state.published;
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const document = source as Record<string, unknown>;
  return document._type === "clientDeliveryGallery" && document._id === state.id &&
    state.id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(state.id) && state.id.trim() === state.id && validHandle(document.handle)
    ? document.handle : undefined;
}
export function clientGalleryShareUrl(site: ClientGallerySite | undefined, handle: string | undefined, locale = ""): string | undefined {
  if (!site || !validHandle(handle) || locale.length > 128 || (locale !== "" && !site.locales.includes(locale))) return undefined;
  const origin = clientGallerySiteOrigin(site.origin);
  if (!origin) return undefined;
  const url = new URL(`/client-gallery/${handle}`, origin);
  if (locale) url.searchParams.set("locale", locale);
  return url.toString();
}
export async function copyClientGalleryUrl(url: string, write?: (value: string) => Promise<void>): Promise<"copied" | "manual"> {
  try { if (!write) return "manual"; await write(url); return "copied"; }
  catch { return "manual"; }
}
export function clientGalleryShareCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    action: "Kopioi asiakasgallerian linkki", close: "Sulje", copy: "Kopioi linkki", copying: "Kopioidaan…",
    language: "Asiakasnäkymän kieli", defaultLanguage: "Sivuston oletuskieli", url: "Asiakasgallerian URL",
    copied: "Linkki kopioitu.", manual: "Valitse ja kopioi URL käsin.", unavailable: "Julkaistun gallerian linkki ei ole nyt saatavilla.",
    configure: "Studion julkinen sivusto-osoite puuttuu.", publicDataset: "Linkkitoiminto edellyttää julkisen aineiston gallerianäkymää.",
    publication: "Sivun saatavuus määräytyy julkaistun version mukaan. Kopiointi ei tarkista saatavuutta eikä ota gallerianäkymää käyttöön.",
    publicAccess: "Piilotettu galleria on julkinen ilman kirjautumista. Linkin voi välittää toiselle; aineiston tiedot ja kuvat voi löytää myös ilman linkkiä.",
    retention: "Sivun sulkeminen ei estä suorien kuvalinkkien käyttöä eikä poista ladattuja tai välimuistiin tallennettuja kopioita.",
    languages: { fi: "Suomi", en: "Englanti" } as Record<string, string>,
  } : {
    action: "Copy client gallery link", close: "Close", copy: "Copy link", copying: "Copying…",
    language: "Customer interface language", defaultLanguage: "Site default language", url: "Client gallery URL",
    copied: "Link copied.", manual: "Select and copy the URL manually.", unavailable: "The published gallery link is not currently available.",
    configure: "This Studio has no public site address configured.", publicDataset: "Link sharing requires the public-dataset gallery viewer.",
    publication: "Page availability follows the published version. Copying does not check availability or enable the gallery viewer.",
    publicAccess: "The unlisted gallery is public without signing in. The link can be forwarded; dataset information and images can also be found without the link.",
    retention: "Closing the page does not revoke direct image URLs or remove downloaded or cached copies.",
    languages: { fi: "Finnish", en: "English" } as Record<string, string>,
  };
}

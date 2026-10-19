import type { DraftActionCode } from "./localized-draft-action-model";

/** Groups of copied text the author must translate, in the order the dialog lists them. */
export type ReviewGroup = "title" | "slug" | "summary" | "author" | "body" | "sections" | "placements" | "other";
const GROUP_ORDER: readonly ReviewGroup[] = ["title", "slug", "summary", "author", "body", "sections", "placements", "other"];

function reviewGroup(path: string): ReviewGroup {
  if (path === "title" || path === "slug" || path === "summary" || path === "author") return path;
  if (/^body[.[]/.test(path)) return "body";
  if (/^(sections|endGallerySections)\[/.test(path)) return "sections";
  if (path.startsWith("placements[")) return "placements";
  return "other";
}

/** Planner paths such as `body[0].text` are field identities, not something an author should read. */
export function summarizeReviewPaths(paths: readonly string[]): { group: ReviewGroup; count: number }[] {
  const counts = new Map<ReviewGroup, number>();
  for (const path of paths) counts.set(reviewGroup(path), (counts.get(reviewGroup(path)) ?? 0) + 1);
  return GROUP_ORDER.filter((group) => counts.has(group)).map((group) => ({ group, count: counts.get(group) ?? 0 }));
}

/** A configured language tag shown by name in the interface language, falling back to the tag itself. */
export function languageName(tag: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: "language" }).of(tag);
    if (name && name.toLowerCase() !== tag.toLowerCase()) return name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1);
  } catch { /* An unsupported tag or runtime keeps the raw tag. */ }
  return tag;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function localizedDraftActionCopy(locale: string) {
  return /^fi(?:-|$)/.test(locale) ? {
    action: "Luo kieliversio",
    intro: (gallery: boolean) => `Tästä ${gallery ? "galleriasta" : "artikkelista"} tehdään uusi kieliversio. Teksti kopioidaan luonnokseksi, jonka käännät itse. Mitään ei käännetä eikä julkaista automaattisesti.`,
    sourceLanguage: "Nykyinen kieli",
    stepLanguage: "1. Valitse uusi kieli", stepReview: "2. Tarkista, mitä kopioidaan", stepCreate: "3. Luo luonnos",
    loadingSource: "Luetaan tallennettua sisältöä…", loadingPreview: "Tarkistetaan kopioitavaa sisältöä…",
    chooseFirst: "Valitse ensin kieli, niin näet, mitä kopioidaan.",
    reviewIntro: "Nämä tekstit kopioidaan sellaisinaan ja merkitään käännettäviksi:",
    unchanged: "Kuvat, kuvien järjestys, osiot ja sivun rakenne säilyvät ennallaan. Mediaa ei kopioida.",
    group: (group: ReviewGroup, n: number) => ({
      title: "Otsikko", slug: "Polun osa (osoite)", summary: "Lyhyt ingressi", author: "Kirjoittaja",
      body: `Sisältö: ${count(n, "tekstikohta", "tekstikohtaa")}`, sections: `Osioiden nimet ja polut: ${count(n, "kenttä", "kenttää")}`,
      placements: `Kuvapaikkojen tekstit: ${count(n, "kenttä", "kenttää")}`, other: `Muut tekstit: ${count(n, "kenttä", "kenttää")}`,
    })[group],
    noticesTitle: "Huomioitavaa ennen julkaisua",
    createLocked: "Painike aktivoituu, kun kieli on valittu ja tarkistus on valmis.",
    createHint: (code: string) => `Luonnosta ei julkaista. Se näkyy luettelossa merkinnällä ${code}.`,
    create: (language: string) => `Luo luonnos (${language})`, creating: "Luodaan luonnosta…",
    createdTitle: (language: string) => `Luonnos luotu: ${language}`,
    createdNext: "Käännä merkityt kentät ja julkaise, kun olet valmis. Luonnos ei näy sivustolla ennen julkaisua.",
    open: "Avaa luonnos", close: "Sulje", cancel: "Peruuta", retry: "Tarkista uudelleen",
    save: "Odota, että muutokset tallentuvat. Release-versiosta ei voi luoda kieliversiota.",
    empty: "Tällä sisällöllä on jo versio kaikilla käytössä olevilla kielillä.",
    errorTitle: "Kieliversiota ei voitu luoda",
    errors: {
      source: "Valitse tallennettu artikkeli tai galleria ja eri määritetty kohdekieli.", changed: "Sisältö muuttui. Sulje ikkuna, odota tallennusta ja tarkista luonnos uudelleen.",
      conflict: "Sisältö on ristiriidassa. Tarkista olemassa oleva kohdeversio ja puuttuvat viittaukset ennen uutta yritystä.",
      exists: "Kohdekielellä on jo versio. Tarkista olemassa olevat luonnokset ja julkaisut.", bounds: "Sisältö ylittää luontitoiminnon kokorajan. Käytä erikseen tarkistettua tuontityönkulkua.",
      permission: "Käyttäjälläsi ei ole tarvittavaa luku- tai luontioikeutta.", unavailable: "Toiminto ei onnistunut. Tarkista luettelosta, luotiinko luonnos, ennen uutta yritystä.",
      crypto: "Selain ei tarjoa tarvittavaa salaustoimintoa. Käytä suojattua Studio-yhteyttä.", review: "Lähde tarvitsee tarkistuksen: tarkista aiempi kielitarkistus, viittaukset ja kuvajärjestys.",
      poll: "Lähde sisältää kielikohtaisen kyselyn. Sen viittausta ei voi kopioida toiseen kieleen.",
    } satisfies Record<DraftActionCode, string>,
  } : {
    action: "Create language version",
    intro: (gallery: boolean) => `This creates a new language version of this ${gallery ? "gallery" : "article"}. Its text is copied into a draft that you translate yourself. Nothing is translated or published automatically.`,
    sourceLanguage: "Current language",
    stepLanguage: "1. Choose the new language", stepReview: "2. Check what will be copied", stepCreate: "3. Create the draft",
    loadingSource: "Reading saved content…", loadingPreview: "Checking the content to copy…",
    chooseFirst: "Choose a language first to see what will be copied.",
    reviewIntro: "These texts are copied as they are and marked for translation:",
    unchanged: "Images, their order, sections and page structure stay as they are. No media is copied.",
    group: (group: ReviewGroup, n: number) => ({
      title: "Title", slug: "Path segment (address)", summary: "Short lead", author: "Author",
      body: `Content: ${count(n, "text item", "text items")}`, sections: `Section names and paths: ${count(n, "field", "fields")}`,
      placements: `Image placement texts: ${count(n, "field", "fields")}`, other: `Other texts: ${count(n, "field", "fields")}`,
    })[group],
    noticesTitle: "Check before publishing",
    createLocked: "The button becomes available once a language is chosen and the check is finished.",
    createHint: (code: string) => `The draft is not published. It appears in the list marked ${code}.`,
    create: (language: string) => `Create draft (${language})`, creating: "Creating the draft…",
    createdTitle: (language: string) => `Draft created: ${language}`,
    createdNext: "Translate the marked fields and publish when you are ready. The draft is not visible on the site until it is published.",
    open: "Open draft", close: "Close", cancel: "Cancel", retry: "Check again",
    save: "Wait for changes to finish saving. A release version cannot be used as the source.",
    empty: "This content already has a version in every configured language.",
    errorTitle: "The language version could not be created",
    errors: {
      source: "Choose a saved article or gallery and a different configured target language.", changed: "Content changed. Close this dialog, wait for saving, then review the draft again.",
      conflict: "Content conflicts with the operation. Check for an existing target version and missing references before trying again.",
      exists: "A target-language version already exists. Check existing drafts and releases.", bounds: "Content exceeds this action's size limit. Use a separately reviewed import workflow.",
      permission: "Your user does not have the required read or create permission.", unavailable: "The operation did not complete normally. Check the list for a created draft before trying again.",
      crypto: "The browser cannot provide the required cryptography. Use a secure Studio connection.", review: "The source needs review: check its prior localization review, references and image ordering.",
      poll: "The source contains a language-specific poll. Its reference cannot be copied into another language.",
    } satisfies Record<DraftActionCode, string>,
  };
}

/** Translate only the planner's fixed notice templates; never translate authored text. */
export function localizedDraftNotice(notice: string, locale: string, names: Readonly<Record<string, string>> = {}): string {
  const finnish = /^fi(?:-|$)/.test(locale);
  const name = (id: string) => names[id] ? `”${names[id]}”` : id;
  const category = /^(Canonical|Secondary) category (.+) lacks a published (.+) label and slug\./.exec(notice);
  if (category) {
    const [, kind, id, language] = category;
    return finnish
      ? `${kind === "Canonical" ? "Pääkategorialta" : "Lisäkategorialta"} ${name(id)} puuttuu julkaistu nimi ja polun osa kielellä ${language.toUpperCase()}. Lisää ne kategoriaan ennen julkaisua.`
      : `The ${kind === "Canonical" ? "main" : "additional"} category ${name(id)} has no published ${language.toUpperCase()} name and path segment. Add them to the category before publishing.`;
  }
  const media = /^Shared media (.+) needs a (.+) (alt|caption) entry;/.exec(notice);
  if (media) {
    const [, id, language, field] = media;
    return finnish
      ? `Kuvalta ${name(id)} puuttuu ${field === "alt" ? "vaihtoehtoinen teksti" : "kuvateksti"} kielellä ${language.toUpperCase()}. Kuvatekstit ovat kuvan omia, joten lisää ne kuvaan erikseen.`
      : `The image ${name(id)} has no ${language.toUpperCase()} ${field === "alt" ? "alternative text" : "caption"}. Image texts belong to the image, so add them there separately.`;
  }
  const missing = /^Media (.+) is missing;/.exec(notice);
  if (missing) return finnish
    ? `Kuvaa ${missing[1]} ei löytynyt, joten sen tekstejä ei voitu tarkistaa.`
    : `The image ${missing[1]} was not found, so its texts could not be checked.`;
  return finnish ? "Liittyvä sisältö tarvitsee erillisen tarkistuksen." : notice;
}

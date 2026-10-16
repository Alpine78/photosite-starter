import type { DraftActionCode } from "./localized-draft-action-model";

export function localizedDraftActionCopy(locale: string) {
  return /^fi(?:-|$)/.test(locale) ? {
    action: "Luo kieliversio", target: "Kohdekieli", preview: "Tarkista luonnos", create: "Luo luonnos", close: "Sulje",
    loading: "Luetaan tallennettua sisältöä…", intro: "Lähdeteksti kopioidaan tarkistettavaksi luonnokseksi. Mitään ei käännetä tai julkaista automaattisesti.",
    ready: "Tarkista kopioitavat kentät ja liittyvän sisällön huomiot ennen luontia.", fields: "Tarkistettavia tekstikenttiä", placements: "Kuvapaikkojen luonnoksia", notices: "Liittyvä sisältö", created: "Luonnos luotu. Löydät sen artikkelien tai gallerioiden luettelosta kohdekielellä.",
    save: "Odota, että lähteen muutokset on tallennettu. Julkaisuversiosta ei voi luoda kieliversiota.", empty: "Kaikilla määritetyillä kohdekielillä on jo versio.",
    errors: {
      source: "Valitse tallennettu artikkeli tai galleria ja eri määritetty kohdekieli.", changed: "Sisältö muuttui. Sulje ikkuna, odota tallennusta ja tarkista luonnos uudelleen.",
      conflict: "Sisältö on ristiriidassa. Tarkista olemassa oleva kohdeversio ja puuttuvat viittaukset ennen uutta yritystä.",
      exists: "Kohdekielellä on jo versio. Tarkista olemassa olevat luonnokset ja julkaisut.", bounds: "Sisältö ylittää luontitoiminnon kokorajan. Käytä erikseen tarkistettua tuontityönkulkua.",
      permission: "Käyttäjälläsi ei ole tarvittavaa luku- tai luontioikeutta.", unavailable: "Toiminto ei onnistunut. Tarkista luettelosta, luotiinko luonnos, ennen uutta yritystä.",
      crypto: "Selain ei tarjoa tarvittavaa salaustoimintoa. Käytä suojattua Studio-yhteyttä.", review: "Lähde tarvitsee tarkistuksen: tarkista aiempi kielitarkistus, viittaukset ja kuvajärjestys.",
      poll: "Lähde sisältää kielikohtaisen kyselyn. Sen viittausta ei voi kopioida toiseen kieleen.",
    } satisfies Record<DraftActionCode, string>,
  } : {
    action: "Create language version", target: "Target language", preview: "Review draft", create: "Create draft", close: "Close",
    loading: "Reading saved content…", intro: "Source text is copied into a draft for review. Nothing is translated or published automatically.",
    ready: "Review the copied fields and related-content notices before creating.", fields: "Text fields requiring review", placements: "Placement drafts", notices: "Related content", created: "Draft created. Find it in the articles or galleries list under the target language.",
    save: "Wait for source changes to finish saving. A release version cannot be used as the source.", empty: "Every configured target language already has a version.",
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
export function localizedDraftNotice(notice: string, locale: string): string {
  if (!/^fi(?:-|$)/.test(locale)) return notice;
  const category = /^(Canonical|Secondary) category (.+) lacks a published (.+) label and slug\./.exec(notice);
  if (category) return `${category[1] === "Canonical" ? "Ensisijaiselta" : "Toissijaiselta"} kategorialta ${category[2]} puuttuu julkaistu nimi ja polkutunniste kielellä ${category[3]}.`;
  const media = /^Shared media (.+) needs a (.+) (alt|caption) entry;/.exec(notice);
  if (media) return `Jaettu media ${media[1]} tarvitsee ${media[3] === "alt" ? "vaihtoehtoisen tekstin" : "kuvatekstin"} kielellä ${media[2]}. Toiminto ei kopioi mediaa.`;
  const missing = /^Media (.+) is missing;/.exec(notice);
  if (missing) return `Media ${missing[1]} puuttuu; kohdekielen tekstin omistajuutta ei voida tarkistaa.`;
  return "Liittyvä sisältö tarvitsee erillisen tarkistuksen.";
}

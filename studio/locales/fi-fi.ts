import type english from "./en-us";

const resources = {
  "structure.client-galleries.title": "Asiakasgalleriat",
  "structure.proof-galleries.title": "Vedosgalleriat",
  "structure.proof-selections.title": "Vahvistetut vedosvalinnat",
  "structure.proof-working-selections.title": "Vedosvalinnat",
  "structure.proof-notices.title": "Toimenpiteitä vaativat vedosilmoitukset",
  "structure.content.title": "Sisältö",
  "structure.home-page.title": "Etusivu",
  "structure.site-settings.title": "Sivuston asetukset",
  "structure.services.title": "Palvelut",
  "structure.articles.title": "Artikkelit",
  "structure.galleries.title": "Galleriat",
  "structure.gallery-images.title": "Galleriakuvat",
  "structure.shared-media.title": "Yhteinen media",
  "structure.categories.title": "Kategoriat",
  "structure.article-end-galleries.title": "Artikkelien loppugalleriat",
  "structure.polls.title": "Kyselyt",
} satisfies Record<keyof typeof english, string>;

export default resources;

import { defineLocaleResourceBundle } from "sanity";

export const EDITORIAL_LOCALE_NAMESPACE = "photosite-editorial";

export const editorialLocaleBundles = [
  defineLocaleResourceBundle({
    locale: "en-US",
    namespace: EDITORIAL_LOCALE_NAMESPACE,
    resources: () => import("./locales/en-us"),
  }),
  defineLocaleResourceBundle({
    locale: "fi-FI",
    namespace: EDITORIAL_LOCALE_NAMESPACE,
    resources: () => import("./locales/fi-fi"),
  }),
];

const titleKeys = {
  clientDeliveryGallery: "structure.client-galleries.title",
  clientProofGallery: "structure.proof-galleries.title",
  content: "structure.content.title",
  homePage: "structure.home-page.title",
  siteSettings: "structure.site-settings.title",
  service: "structure.services.title",
  article: "structure.articles.title",
  gallery: "structure.galleries.title",
  galleryPlacement: "structure.gallery-images.title",
  media: "structure.shared-media.title",
  category: "structure.categories.title",
  articleEndGalleryPlacement: "structure.article-end-galleries.title",
  poll: "structure.polls.title",
} as const;

export function editorialTitle(type: keyof typeof titleKeys) {
  return { title: { key: titleKeys[type], ns: EDITORIAL_LOCALE_NAMESPACE } };
}

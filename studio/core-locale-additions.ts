import { defineLocaleResourceBundle } from "sanity";
import { coreFinnishAdditions } from "./core-locales-fi";

/** Additions only. The pinned Finnish plugin supplies the remaining core text. */
export const coreLocaleAdditions = Object.entries(coreFinnishAdditions).map(([namespace, resources]) =>
  defineLocaleResourceBundle({ locale: "fi-FI", namespace, resources }),
);

import { loadStudioSettings } from "./settings";

/** Sanity replaces these static property accesses in the production browser bundle. */
export const studioSettings = loadStudioSettings({
  SANITY_STUDIO_PROJECT_ID: process.env.SANITY_STUDIO_PROJECT_ID,
  SANITY_STUDIO_DATASET: process.env.SANITY_STUDIO_DATASET,
  SANITY_STUDIO_DATASET_VISIBILITY: process.env.SANITY_STUDIO_DATASET_VISIBILITY,
  SANITY_STUDIO_TITLE: process.env.SANITY_STUDIO_TITLE,
  SANITY_STUDIO_LOCALE_ROUTES: process.env.SANITY_STUDIO_LOCALE_ROUTES,
});

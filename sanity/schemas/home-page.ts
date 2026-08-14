/** The content unique to the public home page. */

import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import { MEDIA_TYPE_NAME } from "./media";
import { HOME_ACTION_TYPE_NAME, HOME_SECTION_TYPE_NAME } from "./site-link";
import type { SchemaTypeDefinition } from "./schema-types";

export const HOME_PAGE_TYPE_NAME = "homePage";

export const homePageType: SchemaTypeDefinition = {
  name: HOME_PAGE_TYPE_NAME,
  title: "Home page",
  type: "document",
  description:
    "The home hero, introduction, and section links. Publish exactly one document.",
  fields: [
    {
      name: "heroMedia",
      title: "Hero media",
      type: "reference",
      to: [{ type: MEDIA_TYPE_NAME }],
      description:
        "A shared public media document. Its own native dimensions determine the hero ratio; the site never crops it.",
      validation: (rule) => rule.required(),
    },
    { name: "heroAction", title: "Hero action", type: HOME_ACTION_TYPE_NAME },
    {
      name: "intro",
      title: "Introduction",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    {
      name: "sections",
      title: "Section links",
      type: "array",
      of: [{ type: HOME_SECTION_TYPE_NAME }],
      validation: (rule) => rule.required().min(1),
    },
  ],
  preview: { select: { title: "intro.0.value", media: "heroMedia.image" } },
};

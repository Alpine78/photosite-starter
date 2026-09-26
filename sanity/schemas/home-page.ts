/** The content unique to the public home page. */

import { contactCallToActionFields } from "./contact-call-to-action";
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
      name: "photographerIntroduction",
      title: "Photographer introduction",
      type: "object",
      description: "Optional introduction band after the hero. Author all visible text in each published language.",
      fields: [
        {
          name: "portrait",
          title: "Portrait",
          type: "reference",
          to: [{ type: MEDIA_TYPE_NAME }],
          description: "A public portrait image shown at its native ratio, without cropping.",
          validation: (rule) => rule.required(),
        },
        ...(["eyebrow", "heading", "text"] as const).map((name) => ({
          name,
          title: name === "text" ? "Text" : name === "heading" ? "Heading" : "Eyebrow",
          type: "array",
          of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
          validation: (rule: Parameters<NonNullable<SchemaTypeDefinition["validation"]>>[0]) =>
            uniqueLanguages(rule.required().min(1)),
        })),
        {
          name: "facts",
          title: "Facts",
          type: "array",
          description: "Up to three short title-and-detail pairs.",
          of: [{
            type: "object",
            fields: [
              {
                name: "title",
                title: "Title",
                type: "array",
                of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
                validation: (rule) => uniqueLanguages(rule.required().min(1)),
              },
              {
                name: "detail",
                title: "Detail",
                type: "array",
                of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
                validation: (rule) => uniqueLanguages(rule.required().min(1)),
              },
            ],
          }],
          validation: (rule) => rule.max(3),
        },
      ],
    },
    {
      name: "contactCallToAction",
      title: "Contact call to action",
      type: "object",
      description: "Optional end band. Add a heading and text in each language where it should appear.",
      fields: contactCallToActionFields,
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

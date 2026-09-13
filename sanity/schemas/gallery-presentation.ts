import type { SchemaFieldDefinition } from "./schema-types";

/** Optional in both documents. In particular, no initialValue creates an override. */
export function galleryPresentationFields(inherit: boolean): readonly SchemaFieldDefinition[] {
  return [
    {
      name: "galleryLayout",
      title: "Gallery layout",
      type: "string",
      description: inherit ? "Clear to inherit the site layout." : "When empty, uses Grid.",
      options: { list: [
        { title: "Grid", value: "grid" },
        { title: "Masonry", value: "masonry" },
        { title: "Justified rows", value: "justified" },
      ] },
      validation: (rule) => rule.custom((value) => value == null ||
        ["grid", "masonry", "justified"].includes(value as string) || "Choose a supported gallery layout."),
    },
    {
      name: "galleryCaptionPlacement",
      title: "Gallery caption placement",
      type: "string",
      description: inherit ? "Clear to inherit the site caption placement." : "When empty, uses Below.",
      options: { list: [
        { title: "Below", value: "below" },
        { title: "Over the image", value: "overlay" },
      ] },
      validation: (rule) => rule.custom((value) => value == null ||
        ["below", "overlay"].includes(value as string) || "Choose a supported caption placement."),
    },
  ];
}

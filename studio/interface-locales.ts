import { schemaFinnish } from "./schema-locales-fi";
import { validationFinnish } from "./validation-locales-fi";

const literalTranslations: Readonly<Record<string, string>> = { ...schemaFinnish, ...validationFinnish };
const parameter = /\{\{p(\d+)\}\}/g;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(validationFinnish)
  .filter(([english]) => english.includes("{{p"))
  .sort(([a], [b]) => b.length - a.length)
  .map(([english, finnish]) => ({
    finnish,
    // Text fragments are escaped; values stay opaque and are never evaluated.
    pattern: new RegExp(`^${english.split(parameter).map((part, index) => index % 2 ? "(.*?)" : escape(part)).join("")}$`, "s"),
  }));

/** Translate only known project interface wording, never authored values. */
export function studioInterfaceText(value: string | undefined, locale: string): string | undefined {
  if (value === undefined || !/^fi(?:-|$)/.test(locale)) return value;
  if (Object.hasOwn(literalTranslations, value)) return literalTranslations[value];
  for (const { pattern, finnish } of patterns) {
    const match = pattern.exec(value);
    if (match) return finnish.replace(parameter, (_, index: string) => match[Number(index) + 1]);
  }
  return value;
}

/** Sanity's public localized-message shape keeps errors localized everywhere. */
export function studioValidationMessage(message: string): Readonly<Record<string, string>> {
  const fi = studioInterfaceText(message, "fi-FI") ?? message;
  return { "en-US": message, en: message, "fi-FI": fi, fi };
}

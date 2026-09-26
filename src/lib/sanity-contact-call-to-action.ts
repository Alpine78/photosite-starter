import "server-only";

import type { ContactCallToAction } from "@/lib/contact-call-to-action";
import { readOptionalLocalizedText } from "@/lib/sanity-site-values";
import { isRecord } from "@/lib/sanity-values";

/** Missing copy in this language omits the entire band, without a fallback. */
export function projectOptionalContactCallToAction(
  value: unknown,
  language: string,
  field: string,
  reject: (detail: string) => never,
): ContactCallToAction | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) reject(`${field} is malformed`);
  const heading = readOptionalLocalizedText(value.heading, language, `${field}.heading`, reject);
  const text = readOptionalLocalizedText(value.text, language, `${field}.text`, reject);
  return heading === undefined || text === undefined ? undefined : { heading, text };
}

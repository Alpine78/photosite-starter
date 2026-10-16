const dateFormatOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
};

/** Formats authored dates consistently in the deployment's configured locale. */
export function formatDate(value: string | Date, locale: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, dateFormatOptions).format(date);
}

/** An exact page cutoff, always UTC; the caller labels the timezone explicitly. */
export function formatUtcDateTime(value: string | Date, locale: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    ...(date.getUTCMilliseconds() ? { fractionalSecondDigits: 3 as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

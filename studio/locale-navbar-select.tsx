import { Flex, Select, Text } from "@sanity/ui";

export type LocaleNavbarSelectProps = {
  selectId: string;
  currentLocale: string;
  locales: readonly { id: string; title: string }[];
  changing: boolean;
  failed: boolean;
  onSelect(locale: string): void;
};

/** Studio-themed language control; the SDK locale bridge stays in `locale-navbar.tsx`. */
export function LocaleNavbarSelect({ selectId, currentLocale, locales, changing, failed, onSelect }: LocaleNavbarSelectProps) {
  const finnish = currentLocale === "fi-FI";
  return (
    <Flex align="center" gap={2} justify="flex-end" paddingX={3} paddingY={2} wrap="wrap">
      <Text size={1}><label htmlFor={selectId}>{finnish ? "Käyttöliittymän kieli" : "Interface language"}</label></Text>
      <Select id={selectId} value={currentLocale} disabled={changing} fontSize={1}
        onChange={(event) => { onSelect(event.currentTarget.value); }}>
        {locales.map((locale) => (
          <option key={locale.id} value={locale.id}>
            {locale.id === "fi-FI" ? "Suomi" : locale.id === "en-US" ? "English" : locale.title}
          </option>
        ))}
      </Select>
      {failed && <Text size={1}><span role="alert">{finnish ? "Kielen vaihtaminen epäonnistui. Yritä uudelleen." : "Unable to change the language. Try again."}</span></Text>}
    </Flex>
  );
}

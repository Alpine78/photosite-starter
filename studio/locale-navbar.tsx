import { useEffect, useId, useState } from "react";
import { type NavbarProps, type ToolMenuProps, useCurrentLocale, useLocale } from "sanity";
import { LocaleNavbarSelect } from "./locale-navbar-select";

/** Sanity 6.18.0 disables its built-in locale menu. Keep this bridge version-pinned. */
export function LocaleNavbar(props: NavbarProps) {
  // Exported by the pinned SDK, but marked internal upstream. Recheck on SDK upgrades.
  const { currentLocale, locales, changeLocale } = useLocale();
  const selectId = useId();
  const [changing, setChanging] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = currentLocale.id;
    return () => { document.documentElement.lang = previous; };
  }, [currentLocale.id]);

  async function selectLocale(locale: string) {
    setChanging(true);
    setFailed(false);
    try {
      // The SDK owns language loading and its existing per-project preference store.
      await changeLocale(locale);
    } catch {
      setFailed(true);
    } finally {
      setChanging(false);
    }
  }

  return (
    <div>
      {props.renderDefault(props)}
      {locales.length > 1 && (
        <LocaleNavbarSelect selectId={selectId} currentLocale={currentLocale.id} locales={locales} changing={changing} failed={failed}
          onSelect={(locale) => { void selectLocale(locale); }} />
      )}
    </div>
  );
}

/** Default tool titles are static upstream; retain its menu behavior and tool identities. */
export function LocaleToolMenu(props: ToolMenuProps) {
  const finnish = useCurrentLocale().id === "fi-FI";
  const tools = props.tools.map((tool) => {
    if (tool.name === "structure" && tool.title === "Structure") return { ...tool, title: finnish ? "Rakenne" : "Structure" };
    if (tool.name === "releases" && tool.title === "Releases") return { ...tool, title: finnish ? "Julkaisut" : "Releases" };
    return tool;
  });
  return props.renderDefault({ ...props, tools });
}

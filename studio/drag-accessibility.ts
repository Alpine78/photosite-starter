/** Copy for the pinned SDK's keyboard sensor; identifiers remain opaque. */
export function dragAccessibility(locale: string) {
  const fi = /^fi(?:-|$)/.test(locale);
  const position = (value: unknown): number | undefined => {
    if (!value || typeof value !== "object" || !("data" in value)) return;
    const data = value.data as { current?: { sortable?: { index?: unknown } } } | undefined;
    const index = data?.current?.sortable?.index;
    return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 && index < Number.MAX_SAFE_INTEGER
      ? index + 1 : undefined;
  };
  const item = (active: unknown) => {
    const n = position(active);
    return fi ? `Kohde${n === undefined ? "" : ` paikassa ${n}`}` : `Item${n === undefined ? "" : ` at position ${n}`}`;
  };
  return {
    screenReaderInstructions: {
      draggable: fi
        ? "Valitse siirrettävä kohde painamalla välilyöntiä. Siirrä kohdetta nuolinäppäimillä. Sijoita kohde uuteen paikkaan painamalla välilyöntiä uudelleen tai peruuta painamalla Esc-näppäintä."
        : "To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item. Press space again to drop the item in its new position, or press escape to cancel.",
    },
    announcements: {
      onDragStart: ({ active }: { active?: unknown }) => fi ? `${item(active)} valittu siirrettäväksi.` : `${item(active)} picked up.`,
      onDragOver: ({ over }: { over: unknown }) => over
        ? fi ? "Kohde siirretty uuden sijoituspaikan päälle." : "Item moved over a new drop position."
        : fi ? "Kohde on sijoituspaikkojen ulkopuolella." : "Item is outside the drop positions.",
      onDragEnd: ({ over }: { over?: unknown }) => {
        const n = position(over);
        return n === undefined ? fi ? "Kohteen siirto päättyi." : "Item movement ended."
          : fi ? `Kohde sijoitettu paikkaan ${n}.` : `Item dropped at position ${n}.`;
      },
      onDragCancel: () => fi ? "Kohteen siirto peruutettu." : "Item movement cancelled.",
    },
  };
}

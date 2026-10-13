import { describe, expect, it } from "vitest";
import { dragAccessibility } from "./drag-accessibility";

describe("Studio keyboard drag accessibility", () => {
  it("describes activation, movement, drop and cancellation in both languages", () => {
    const fi = dragAccessibility("fi-FI");
    const en = dragAccessibility("en-US");
    expect(fi.screenReaderInstructions.draggable).toMatch(/välilyöntiä.*nuolinäppäimillä.*välilyöntiä.*Esc/);
    expect(en.screenReaderInstructions.draggable).toMatch(/space bar.*arrow keys.*space again.*escape/);
    expect(fi.announcements.onDragStart({})).toBe("Kohde valittu siirrettäväksi.");
    expect(en.announcements.onDragCancel()).toBe("Item movement cancelled.");
  });
  it("does not expose raw document or placement IDs in live announcements", () => {
    for (const locale of ["fi-FI", "en-US"]) {
      const messages = dragAccessibility(locale).announcements;
      const over = { id: "private-identifier", data: { current: {} } };
      expect(messages.onDragOver({ over })).not.toContain(over.id);
      expect(messages.onDragOver({ over: null })).not.toBe(messages.onDragOver({ over }));
      expect(messages.onDragEnd({ over: { id: "secret", data: { current: { sortable: { index: 4 } } } } }))
        .toContain("5");
      expect(messages.onDragEnd({ over: { data: { current: { sortable: { index: Infinity } } } } }))
        .not.toContain("Infinity");
    }
  });
});
